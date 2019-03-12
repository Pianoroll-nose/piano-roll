class Sptk {
    constructor(context) {
        this.soundIndex = Util.getSoundIndex();

        this.sounds = [];
        this.fs = 16000;
        this.order = 24;
        this.win_shift = 80;

        this.isLoaded = new Array(this.soundIndex.length);

        const load = async () => {
            const parameter = ["f0", "mcep"];
            let promises = [];
            for (let i = 0; i < this.soundIndex.length; i++) {
                this.sounds[i] = {};
                for (let p of parameter) {
                    const download = async () => {
                        const index = i;
                        const parameter = p;
                        const res = await fetch('http://localhost:5500/namine_ritsu/' + p + '/' + i + '.' + p, {
                            cache: "force-cache"
                        });
                        const buf = await res.arrayBuffer();
                        let view = new DataView(buf);

                        let arr = new Float64Array(view.byteLength / 4);
                        arr.fill(0);
                        for (let i = 0, l = view.byteLength / 4; i < l; i++) {
                            arr[i] = view.getFloat32(i * 4, true);  //リトルエンディアン
                        }
                        return [parameter, index, arr];
                    }
                    promises.push(download().then(([p, i, a]) => {
                        this.sounds[i][p] = a;
                        this.isLoaded[i] = typeof this.sounds[i]["f0"] &&
                            typeof this.sounds[i]["mcep"] === "object";
                    }));
                }
            }
        }

        this.audioCtx = context;
        this.isInitialized = false;
        this.worker = new Worker('js/realtimeSptkWorker.js');

        this.worker.postMessage({
            message: 'init'
        });
        this.worker.addEventListener('message', (e) => {
            if (e.data.message === 'init')
                this.isInitialized = true;
        });

        load();
    }

    waitDownload(index) {
        return new Promise((resolve, reject) => {
            const wait = () => {
                if (!this.isLoaded[index]) {
                    setTimeout(wait, 300);
                }
                else {
                    resolve();
                }
            }
            wait();
        });
    }

    async scoreToBuffer(score, basePitch, verticalNum, bpm, beats) {
        let f0_len = 0, mcep_len = 0;
        let lastIndex = 0;
        for (let s of score) {
            let length = this.cellToMSeconds(bpm, beats, s.end - s.start + 1);
            if (s.start - lastIndex > 0) {
                length += this.cellToMSeconds(bpm, beats, s.start - lastIndex);
            }
            const time_len = Math.floor(length / 1000 * this.fs / this.win_shift);
            f0_len += time_len;
            mcep_len += time_len * (this.order + 1);
            lastIndex = s.end + 1;
        }

        let f0_buf = new Float64Array(f0_len);
        let mcep_buf = new Float64Array(mcep_len);
        let f0_offset = 0;
        let mcep_offset = 0;
        lastIndex = 0;
        for (let s of score) {
            if (s.start - lastIndex > 0) {
                //無音("あ"の0フレーム目)をセット
                /*
                const f0 = this.sounds[0].f0.slice(0, 1);
                const mcep = this.sounds[0].mcep.slice(0, this.order + 1);

                let length = this.cellToMSeconds(bpm, beats, s.start - lastIndex);
                length = length / 1000 * this.fs / this.win_shift;
                length = Math.floor(length);

                for (let i = 0; i < length; i++) {
                    f0_buf.set(f0, f0_offset + i);
                    mcep_buf.set(mcep, mcep_offset + i * mcep.length);
                }
                /*/
                let length = this.cellToMSeconds(bpm, beats, s.start - lastIndex);
                length = length / 1000 * this.fs / this.win_shift;
                length = Math.floor(length);

                f0_buf.set(Array(length).fill(0), f0_offset);
                mcep_buf.set(Array(length * (this.order + 1)).fill(0), mcep_offset);
                //*/
                f0_offset += length;
                mcep_offset += length * (this.order + 1);
            }
            const index = this.soundIndex.indexOf(s.lyric);
            await this.waitDownload(index);

            const _f0 = this.makePitch(this.sounds[index].f0, this.pitchToMidiNum(s.pitch, basePitch, verticalNum));
            const [f0, mcep] = this.alignLength(_f0, this.sounds[index].mcep, bpm, beats, s.end - s.start + 1);
            f0_buf.set(f0, f0_offset);
            mcep_buf.set(mcep, mcep_offset);
            f0_offset += f0.length;
            mcep_offset += mcep.length;
            lastIndex = s.end + 1;
        }
        return [f0_buf, mcep_buf];
    }


    makePitch(f0, pitch) {
        const targetF0 = 440 * Math.pow(2, (pitch - 69) / 12);
        const _f0 = f0.map(n => (n < Number.EPSILON) ? 0 : targetF0);

        return _f0;
    }

    pitchToMidiNum(pitch, basePitch, verticalNum) {
        const pitchList = Util.getPitchList();
        const b_pitch = basePitch.match(/[A-G]?/)[0];
        const b_octave = basePitch.match(/\d/)[0];

        const pitchOffset = (9 - pitchList.indexOf(b_pitch) + 12) % 12; //indexOf("A") = 9
        const octaveOffset = (4 - b_octave) * 12;
        return (69 - pitchOffset + octaveOffset) + (verticalNum - 1 - pitch);
    }

    alignLength(f0, mcep, bpm, beats, length) {
        const linear = (y1, y2, x) => (y2 - y1) * x + y1;
        const m_sec = this.cellToMSeconds(bpm, beats, length);
        const times = f0.length / Math.ceil(m_sec / 1000 * this.fs / this.win_shift);
        const order = this.order + 1;

        const time_length = Math.floor((f0.length - 1) / times);
        const _f0 = new Float64Array(time_length);
        const _mcep = new Float64Array(time_length * order);

        for (let i = 0, len = _f0.length; i < len; i++) {
            const newIdx = i * times;
            const x = newIdx - Math.floor(newIdx);
            for (let j = 0; j < order; j++) {
                _mcep[i * order + j] = linear(mcep[Math.floor(newIdx) * order + j], mcep[Math.ceil(newIdx) * order + j], x);
            }
            _f0[i] = linear(f0[Math.floor(newIdx)], f0[Math.ceil(newIdx)], x);
        }

        return [_f0, _mcep];
    }

    cellToMSeconds(bpm, beats, length) {
        return 1000 * 60 * length / (bpm * beats);
    }

    async synthesis(score, basePitch, verticalNum, bpm, beats) {
        console.time('score2Buf');
        const [f0, mcep] = await this.scoreToBuffer(score, basePitch, verticalNum, bpm, beats);
        console.timeEnd('score2Buf');
        if (f0.length === 0) return null;

        const startSrc = (srcs, start, end, startTime) => {
            let length = 0;
            for(let i = start; i < end; i++) {
                srcs[i].start(startTime + length, 0);
                length += srcs[i].buffer.duration;

            }
            return startTime + length;
        };


        return new Promise((resolve, reject) => {
            let startTime = null;
            let canStart = false;
            const srcs = [];

            this.worker.postMessage({
                message: 'synthesis',
                args: [f0, mcep, this.order, this.win_shift]
            }, [f0.buffer, mcep.buffer]);

            this.worker.onmessage = (e) => {
                if (e.data.message === 'finish') {
                    //startSrc(srcs, 0, srcs.length, this.audioCtx.currentTime);
                    resolve(e.data.result);
                }
                if (e.data.message === 'wav') {
                    if(!startTime)  startTime = this.audioCtx.currentTime;
                    const buffer = this.audioCtx.createBuffer(1, e.data.data.length, 16000);
                    buffer.copyToChannel(e.data.data, 0);
                    const src = this.audioCtx.createBufferSource();
                    src.buffer = buffer;
                    src.connect(this.audioCtx.destination);
                    srcs.push(src);
                    startTime = startSrc(srcs, srcs.length-1, srcs.length, startTime);
                    //console.log(e.data.data);
                }
            };
        });
    }
}