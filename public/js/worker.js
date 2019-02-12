
self.addEventListener('message', (e) => {
    const message = e.data.message;
    if (message === 'init') {
        self.context = e.data.context;
        self.subWorker = new Worker('subWorker.js');
        self.isInitialized = false;
        self.subWorker.addEventListener('message', (e) => {
            if (e.data.message === 'init') {
                self.isInitialized = true;
                self.context = e.data.context;
            }
        });
    }
    if (message === 'synthesis') {
        synthesis(...e.data.args).then(() =>
            self.postMessage({
                message: 'finish'
            }));
    }
}, false);


const waitInit = () => {
    return new Promise((resolve, reject) => {
        const _wait = () => {
            if (!self.isInitialized) {
                setTimeout(() => {
                    _wait();
                }, 30, false);
            }
            else {
                resolve();
            }
        };
        _wait();
    });
};

const waitResponse = (message) => {
    return new Promise((resolve, reject) => {
        self.subWorker.addEventListener('message', (e) => {
            if (e.data.message === message.message) {
                resolve(e.data.ptr);
            }
        }, { once: true });
        self.subWorker.postMessage(message);
    });
};

const calculateCanStart = (average, count, length, bufferSize, fs) => {
    const estimateTime = average / bufferSize * (length - count * bufferSize);   //合成にかかる残りの見積もり時間(ms), 一つ目の時間は計測していない
    const playTime = length / fs * 1000;              //再生するのにかかる時間(ms)
    const canStart = estimateTime * 2 < playTime;

    console.log(estimateTime+'[ms]', playTime+'[ms]', average/1000/bufferSize * fs+'[s]', count, length - count * bufferSize);
    if (canStart) {
        self.postMessage({
            message: 'start'
        });
    }
    return canStart;
}


const synthesis = async (f_p, fs, f0, mgc, mel_points, ap, fft_size) => {
    await waitInit();

    const f0_length = f0.length;

    const f0_size = f0_length * f0.BYTES_PER_ELEMENT;
    const f0_ptr = await waitResponse({
        message: 'malloc',
        name: 'f0',
        size: f0_size,
        buf: f0.buffer
    }, [f0.buffer]);

    const mgc_size = mgc.length * mgc.BYTES_PER_ELEMENT;
    const mgc_ptr = await waitResponse({
        message: 'malloc',
        name: 'mgc',
        size: mgc_size,
        buf: mgc.buffer
    }, [mgc.buffer]);

    const ap_size = ap.length * ap.BYTES_PER_ELEMENT;
    const ap_ptr = await waitResponse({
        message: 'malloc',
        name: 'ap',
        size: ap_size,
        buf: ap.buffer
    }, [ap.buffer]);

    //ポインタの型つき配列を作成 max:2GB
    const ap_pointers = new Uint32Array(f0_length);
    for (let i = 0; i < f0_length; i++) {
        ap_pointers[i] = ap_ptr + i * ap.BYTES_PER_ELEMENT * (fft_size / 2 + 1);
    }
    const ap_pointers_size = ap_pointers.length * ap_pointers.BYTES_PER_ELEMENT;

    const ap_pointers_ptr = await waitResponse({
        message: 'malloc',
        name: 'ap_ptr',
        name: 'ap_ptr',
        size: ap_pointers_size,
        buf: ap_pointers.buffer
    }, [ap_pointers.buffer]);

    //worldで定義されていた通り
    const out_length = Math.floor((f0.length - 1) * f_p / 1000.0 * fs) + 1;
    const out = new Float64Array(out_length);
    const out_size = out.length * out.BYTES_PER_ELEMENT;
    const out_ptr = await waitResponse({
        message: 'malloc',
        name: 'out',
        size: out_size,
        buf: out.buffer
    }, [out.buffer]);

    console.time('synthesis');

    await new Promise((resolve, reject) => {
        let lastTime = performance.now();
        let times = 0;
        let count = 0;
        let isStarted = false;

        self.subWorker.addEventListener('message', listener = (e) => {
            if (e.data.message === 'wav') {
                const audioBuf = new Float32Array(e.data.data);
                if (!isStarted) {
                    const currentTime = performance.now();
                    times += currentTime - lastTime;
                    count++;
                    lastTime = currentTime;
                    isStarted = calculateCanStart(times / (count - 1), count, out_length, audioBuf.length, fs);
                    if (count === 1) times = 0;
                }
                self.postMessage({
                    message: 'wav',
                    data: audioBuf
                }, [audioBuf.buffer]);
            }
            if (e.data.message === 'finish') {
                self.subWorker.removeEventListener('message', listener);
                resolve();
            }
        });

        self.subWorker.postMessage({
            message: 'synthesis',
            args: {
                f_p: f_p,
                fs: fs,
                f0_length: f0_length,
                mel_points: mel_points,
                fft_size: fft_size,
                out_length: out_length
            }
        });

    });

    console.log("finished");

    console.timeEnd('synthesis');
}
