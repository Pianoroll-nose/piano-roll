class World {
    constructor(context) {
        this.soundIndex = Util.getSoundIndex();

        this.sounds = [];
        this.fs = 44100;
        this.frame_period = 5;
        const f0_floor = 71.0;   //worldのライブラリで定義されていた通り
        //static_cast<int>(pow(2.0, 1.0 +
        //  static_cast<int>(log(3.0 * fs / option->f0_floor + 1) / world::kLog2))); kLog2=0.69314718055994529
        this.fft_size = Math.floor(Math.pow(2.0, 1.0 + Math.floor(Math.log(3.0 * this.fs / f0_floor + 1) / Math.log(2))));
        //world_parameters->fft_size / 2 + 1
        this.f_points = Math.floor(this.fft_size / 2) + 1;
        //this.mel_points = 10;
        this.mel_points = 25;
        this.isLoaded = new Array(this.soundIndex.length);

        const load = async () => {
            const parameter = ["f0", "bap", "mgc"];
            let promises = [];
            for (let i = 0; i < this.soundIndex.length; i++) {
                this.sounds[i] = {};
                for (let p of parameter) {
                    const download = async () => {
                        const index = i;
                        const parameter = p;
                        const res = await fetch('http://localhost:5500/namine_ritsu_float/' + p + '/' + i + '.' + p, {
                            cache: "force-cache"
                        });
                        //const res = await fetch('http://localhost:5500/gekiyaku/' + p + '/' + i + '.' + p);
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
                            typeof this.sounds[i]["mgc"] && typeof this.sounds[i]["bap"] === "object";
                    }));
                }
            }
        }
        load();
        this.worker = new Worker('worker.js');
        this.worker.postMessage({
            message: 'init',
        });
        this.isInitialized = false;
        this.worker.addEventListener('message', (e) => {
            if (e.data.message === 'init')
                this.isInitialized = true;
        });
        this.audioCtx = context;
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

    async mgc2sp(index) {
        await this.waitDownload(index);

        const mgc_size = this.sounds[index]["mgc"].length * this.sounds[index]["mgc"].BYTES_PER_ELEMENT;
        const mgc_ptr = Module._malloc(mgc_size);
        let mgc_heap = new Uint8Array(Module.HEAPU8.buffer, mgc_ptr, mgc_size);
        mgc_heap.set(new Uint8Array(this.sounds[index]["mgc"].buffer));

        const out = new Float64Array(this.sounds[index]["mgc"].length / (this.mel_points + 1) * this.f_points);
        const out_size = out.length * out.BYTES_PER_ELEMENT;
        const out_ptr = Module._malloc(out_size);
        let out_heap = new Uint8Array(Module.HEAPU8.buffer, out_ptr, out_size);
        out_heap.set(new Uint8Array(out.buffer));
        console.time('mgc2sp');
        await this._mgc2sp(mgc_ptr, this.sounds[index]["mgc"].length, this.mel_points, this.fft_size, 3, 0.544, 0, 0, 0, 0, out_ptr)
        console.timeEnd('mgc2sp');
        out_heap = new Uint8Array(Module.HEAPU8.buffer, out_ptr, out_size);
        const result = new Float64Array(out_heap.buffer, out_heap.byteOffset, out.length);
        this.sounds[index]["sp"] = new Float64Array(result);
        Module._free(mgc_heap.byteOffset);
        Module._free(out_heap.byteOffset);
        delete this.sounds[index]["mgc"];
    }

    async bap2ap(index) {
        await this.waitDownload(index);

        const fft_size = this.fft_size;
        const split = [0, fft_size / 16, 2 * fft_size / 16, 2 * fft_size / 16 + fft_size / 8, 2 * fft_size / 16 + 2 * fft_size / 8, fft_size / 2 + 1];

        console.time('bap2ap');
        const ap = new Float64Array(this.sounds[index]["bap"].length * this.f_points);
        const tmp = new Float64Array(this.sounds[index]["bap"]);
        for (let i = 0, len = this.sounds[index]["f0"]; i < len; i++) {
            for (let j = 0; j < 5; j++) {
                for (let k = split[j], last = split[j + 1]; k < last; k++) {
                    ap[i * len + k] = tmp[i * len + j];
                }
            }
        }
        console.timeEnd('bap2ap');
        return ap;
        this.sounds[index]["ap"] = ap;
        delete this.sounds[index]["bap"];
    }

    async scoreToBuffer(score, basePitch, verticalNum, bpm, beats) {
        let f0_len = 0, mgc_len = 0, ap_len = 0;
        let lastIndex = 0;
        for (let s of score) {
            let length = this.cellToMSeconds(bpm, beats, s.end - s.start + 1);
            if (s.start - lastIndex > 0) {
                length += this.cellToMSeconds(bpm, beats, s.start - lastIndex);
            }
            const time_len = Math.floor(length / this.frame_period);
            f0_len += time_len;
            mgc_len += time_len * (this.mel_points + 1);  //周波数方向1025点
            ap_len += time_len * this.f_points;
            lastIndex = s.end + 1;
        }

        let f0_buf = new Float64Array(f0_len);
        let mgc_buf = new Float64Array(mgc_len);
        let ap_buf = new Float64Array(ap_len);

        let f0_offset = 0;
        let mgc_offset = 0;
        let ap_offset = 0;
        lastIndex = 0;
        for (let s of score) {
            if (s.start - lastIndex > 0) {
                let length = this.cellToMSeconds(bpm, beats, s.start - lastIndex);
                length /= this.frame_period;
                length = Math.floor(length);
                f0_buf.set(Array(length).fill(0), f0_offset);
                mgc_buf.set(Array(length * (this.mel_points + 1)).fill(0), mgc_offset);
                ap_buf.set(Array(length * this.f_points).fill(0), ap_offset);
                f0_offset += length;
                mgc_offset += length * (this.mel_points + 1);
                ap_offset += length * this.f_points;
            }
            const index = this.soundIndex.indexOf(s.lyric);
            await this.waitDownload(index);
            const original_ap = await this.bap2ap(index);
            /*
                        if (!this.sounds[index] || !this.sounds[index]["sp"] || !this.sounds[index]["ap"]) {
                            await Promise.all([this.mgc2sp(index), this.bap2ap(index)]);
                        }
            */
            const _f0 = this.makePitch(this.sounds[index].f0, this.pitchToMidiNum(s.pitch, basePitch, verticalNum));
            const [f0, mgc, ap] = this.alignLength(_f0, this.sounds[index].mgc, original_ap, bpm, beats, s.end - s.start + 1);
            f0_buf.set(f0, f0_offset);
            mgc_buf.set(mgc, mgc_offset);
            ap_buf.set(ap, ap_offset);
            f0_offset += f0.length;
            mgc_offset += mgc.length;
            ap_offset += ap.length;
            lastIndex = s.end + 1;
        }
        return [f0_buf, mgc_buf, ap_buf];
    }


    makePitch(f0, pitch) {
        //元の信号のmidi番号を求める
        const midi_num = Math.round(12 * (Math.log10(f0[Math.floor(f0.length / 2)] + 0.1) - Math.log10(440)) / Math.log10(2)) + 69;
        const diff = Math.pow(2, (pitch - midi_num) / 12);
        const _f0 = f0.map(n => n * diff);
        return _f0;
    }

    pitchToMidiNum(pitch, basePitch, verticalNum) {
        const pitchList = ['C', 'C+', 'D', 'D+', 'E', 'F', 'F+', 'G', 'G+', 'A', 'A+', 'B'];
        const b_pitch = basePitch.match(/[A-G]?/)[0];
        const b_octave = basePitch.match(/\d/)[0];

        const pitchOffset = (9 - pitchList.indexOf(b_pitch) + 12) % 12; //indexOf("A") = 9
        const octaveOffset = (4 - b_octave) * 12;
        return (69 - pitchOffset + octaveOffset) + (verticalNum - 1 - pitch);
    }

    alignLength(f0, mgc, ap, bpm, beats, length) {
        const m_sec = this.cellToMSeconds(bpm, beats, length);
        const times = (f0.length * this.frame_period) / m_sec;
        const f_points = this.f_points;
        const mel_points = this.mel_points + 1;

        const time_length = Math.floor((f0.length - 1) / times);
        const _f0 = new Float64Array(time_length);
        const _mgc = new Float64Array(time_length * mel_points);
        const _ap = new Float64Array(time_length * f_points);

        for (let i = 0, len = _f0.length; i < len; i++) {
            const newIdx = i * times;
            const x = newIdx - Math.floor(newIdx);
            for (let j = 0; j < f_points; j++) {
                _ap[i * f_points + j] = this.linear(ap[Math.floor(newIdx) * f_points + j], ap[Math.ceil(newIdx) * f_points + j], x);
            }
            for (let j = 0; j < mel_points; j++) {
                _mgc[i * mel_points + j] = this.linear(mgc[Math.floor(newIdx) * mel_points + j], mgc[Math.ceil(newIdx) * mel_points + j], x);
            }
            _f0[i] = this.linear(f0[Math.floor(newIdx)], f0[Math.ceil(newIdx)], x);
        }
        return [_f0, _mgc, _ap];
    }

    linear(y2, y1, x) {
        return (y2 - y1) * x + y1;
    }

    cellToMSeconds(bpm, beats, length) {
        return 1000 * 60 * length / (bpm * beats);
    }

    async synthesis(score, basePitch, verticalNum, bpm, beats) {
        console.time('score2Buf');
        const [f0, mgc, ap] = await this.scoreToBuffer(score, basePitch, verticalNum, bpm, beats);
        console.timeEnd('score2Buf');
        if (f0.length === 0) return [];
        let lastTime = 0;
        return new Promise((resolve, reject) => {
            let length = 0;
            let startTime = null;
            this.worker.postMessage({
                message: 'synthesis',
                args: [
                    this.frame_period, this.fs, f0, mgc, this.mel_points,
                    ap, this.fft_size
                ]
            });
            this.worker.onmessage = (e) => {
                if (e.data.message === 'start' || e.data.message === 'finish') {
                    resolve([]);
                }
                if (e.data.message === 'wav') {
                    if(!startTime) {
                        startTime = this.audioCtx.currentTime;
                    }
                    const buffer = this.audioCtx.createBuffer(1, e.data.data.length, 44100);
                    buffer.copyToChannel(e.data.data, 0);
                    const src = this.audioCtx.createBufferSource();
                    src.buffer = buffer;
                    src.connect(this.audioCtx.destination);
                    src.start(startTime + length, 0);
                    length += buffer.duration;
                }
            };
        });
    }

}