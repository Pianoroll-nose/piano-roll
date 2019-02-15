importScripts('synthesis.js');

self.addEventListener('message', (e) => {
    const message = e.data.message;
    if (message === 'synthesis') {
        const args = e.data.args;
        synthesis(...args).then(res => {
            self.postMessage({
                message: 'finish',
                result: res
            });
        });

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



const synthesis = async (f0, mcep, order, win_shift) => {
    await waitInit();

    const f0_size = f0.length * f0.BYTES_PER_ELEMENT;
    const f0_ptr = Module._malloc(f0_size);
    const f0_heap = new Uint8Array(Module.HEAPU8.buffer, f0_ptr, f0_size);
    f0_heap.set(new Uint8Array(f0.buffer));

    const mcep_size = mcep.length * mcep.BYTES_PER_ELEMENT;
    const mcep_ptr = Module._malloc(mcep_size);
    const mcep_heap = new Uint8Array(Module.HEAPU8.buffer, mcep_ptr, mcep_size);
    mcep_heap.set(new Uint8Array(mcep.buffer));

    const out_length = (f0.length - 1) * (order + 1) < mcep.length ? (f0.length - 1) * win_shift : mcep.length;
    const out = new Float64Array(out_length);
    const out_ptr = Module._malloc(out.length * out.BYTES_PER_ELEMENT);

    console.time('synthesis');
    self._synthesis(f0_ptr, mcep_ptr, f0.length, mcep.length, out_ptr);

    const result = new Float64Array(Module.HEAPU8.buffer, out_ptr, out_length);
    const max_16bit = Math.pow(2, 16);
    const result_float = new Float32Array(result).map(e => e/max_16bit);

    console.log("finished");

    Module._free(f0_ptr);
    Module._free(mcep_ptr);
    Module._free(out_ptr);

    console.timeEnd('synthesis');

    return result_float;
}

Module.onRuntimeInitialized = () => {
    self.postMessage({
        message: 'init'
    });

    self._synthesis = Module.cwrap('synthesis', null, [
        'number', 'number', 'number', 'number', 'number'
    ]);

    self.isInitialized = true;
};
