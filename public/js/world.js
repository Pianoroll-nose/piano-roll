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
        this.worker = new Worker('js/worker.js');
        this.worker.postMessage({
            message: 'init'
        });
        this.isInitialized = false;
        this.worker.addEventListener('message', (e) => {
            if (e.data.message === 'init')
                this.isInitialized = true;
        });
        this.audioCtx = context;
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
                //無音("あ"の0フレーム目)をセット
/*
                const f0 = this.sounds[0].f0.slice(0, 1);
                const mgc = this.sounds[0].mgc.slice(0, this.mel_points+1);
                const ap = await this.bap2ap(0).then(buf => buf.slice(0, this.f_points));
*/
                let length = this.cellToMSeconds(bpm, beats, s.start - lastIndex);
                length /= this.frame_period;
                length = Math.floor(length);
/*                
                for(let i = 0; i < length; i++){
                    f0_buf.set(f0, f0_offset+i);
                    mgc_buf.set(mgc, mgc_offset+i*mgc.length);
                    ap_buf.set(ap, ap_offset+i*ap.length);
                }
*/
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

    alignLength(f0, mgc, ap, bpm, beats, length) {
        const linear = (y1, y2, x) => (y2 - y1) * x +y1;
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
                _ap[i * f_points + j] = linear(ap[Math.floor(newIdx) * f_points + j], ap[Math.ceil(newIdx) * f_points + j], x);
            }
            for (let j = 0; j < mel_points; j++) {
                _mgc[i * mel_points + j] = linear(mgc[Math.floor(newIdx) * mel_points + j], mgc[Math.ceil(newIdx) * mel_points + j], x);
            }
            _f0[i] = linear(f0[Math.floor(newIdx)], f0[Math.ceil(newIdx)], x);
        }

        return [_f0, _mgc, _ap];
    }

    cellToMSeconds(bpm, beats, length) {
        return 1000 * 60 * length / (bpm * beats);
    }

    async synthesis(score, basePitch, verticalNum, bpm, beats) {
        console.time('score2Buf');
        const [f0, mgc, ap] = await this.scoreToBuffer(score, basePitch, verticalNum, bpm, beats);
        console.timeEnd('score2Buf');
        if (f0.length === 0) return [];

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
                args: [
                    this.frame_period, this.fs, f0, mgc, this.mel_points,
                    ap, this.fft_size
                ]
            });

            this.worker.onmessage = (e) => {
                if(e.data.message === 'finish'){
//                if (e.data.message === 'start' || e.data.message === 'finish') {
                    if(!canStart) {
                        startTime = this.audioCtx.currentTime;
                        startTime = startSrc(srcs, 0, srcs.length, startTime);
                        canStart = true;
                        resolve(srcs);
                    }
                }
                if (e.data.message === 'wav') {
                    const buffer = this.audioCtx.createBuffer(1, e.data.data.length, 44100);
                    buffer.copyToChannel(e.data.data, 0);
                    const src = this.audioCtx.createBufferSource();
                    src.buffer = buffer;
                    src.connect(this.audioCtx.destination);
                    srcs.push(src);
                    if(canStart) {
                        startSrc(srcs, srcs.length-1, srcs.length, startTime);
                    }
                }
            };
        });
    }

}