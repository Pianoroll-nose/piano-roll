class World {
    constructor() {
        this.soundIndex = [
            "あ", "い", "いぇ", "う", "うぁ", "うぃ", "うぇ", "うぉ", "え", "お", "か", "が", "き", "きぇ", "きゃ",
            "きゅ", "きょ", "ぎ", "ぎぇ", "ぎゃ", "ぎゅ", "ぎょ", "く", "くぁ", "くぃ", "くぇ", "くぉ", "ぐ", "ぐぁ",
            "ぐぃ", "ぐぇ", "ぐぉ", "け", "げ", "こ", "ご", "さ", "ざ", "し", "しぇ", "しゃ", "しゅ", "しょ", "じ",
            "じぇ", "じゃ", "じゅ", "じょ", "す", "すぁ", "すぃ", "すぇ", "すぉ", "ず", "ずぁ", "ずぃ", "ずぇ", "ずぉ",
            "せ", "ぜ", "そ", "ぞ", "た", "だ", "ち", "ちぇ", "ちゃ", "ちゅ", "ちょ", "つ", "つぁ", "つぃ", "つぇ",
            "つぉ", "て", "てぃ", "てゅ", "で", "でぃ", "でゅ", "と", "とぅ", "ど", "どぅ", "な", "に", "にぇ", "にゃ",
            "にゅ", "にょ", "ぬ", "ぬぁ", "ぬぃ", "ぬぇ", "ぬぉ", "ね", "の", "は", "ば", "ぱ", "ひ", "ひぇ", "ひゃ",
            "ひゅ", "ひょ", "び", "びぇ", "びゃ", "びゅ", "びょ", "ぴ", "ぴぇ", "ぴゃ", "ぴゅ", "ぴょ", "ふ", "ふぁ",
            "ふぃ", "ふぇ", "ふぉ", "ぶ", "ぶぁ", "ぶぃ", "ぶぇ", "ぶぉ", "ぷ", "ぷぁ", "ぷぃ", "ぷぇ", "ぷぉ", "へ",
            "べ", "ぺ", "ほ", "ぼ", "ぽ", "ま", "み", "みぇ", "みゃ", "みゅ", "みょ", "む", "むぁ", "むぃ", "むぇ",
            "むぉ", "め", "も", "や", "ゆ", "よ", "ら", "り", "りぇ", "りゃ", "りゅ", "りょ", "る", "るぁ", "るぃ",
            "るぇ", "るぉ", "れ", "ろ", "わ", "を", "ん"];

        this.sounds = [];
        this.fs = 44100;
        this.frame_period = 5;
        const f0_floor = 71.0;   //worldのライブラリで定義されていた通り
        //static_cast<int>(pow(2.0, 1.0 +
        //  static_cast<int>(log(3.0 * fs / option->f0_floor + 1) / world::kLog2))); kLog2=0.69314718055994529
        this.fft_size = Math.floor(Math.pow(2.0, 1.0 + Math.floor(Math.log(3.0 * this.fs / f0_floor + 1) / Math.log(2))));
        //world_parameters->fft_size / 2 + 1
        this.f_points = Math.floor(this.fft_size / 2) + 1;
        this.mel_points = 10 + 1;
        this.isLoaded = false;

        const load = async () => {
            //const parameter = ["f0", "ap", "sp"];
            const parameter = ["f0", "ap", "mgc"];
            for (let i = 0; i < this.soundIndex.length; i++) {
                this.sounds[i] = {}
                for (let p of parameter) {
                    const res = await fetch('http://localhost:5500/namine_ritsu_float/' + p + '/' + i + '.' + p);
                    const [_, index, param] = res.url.match(/(\d+).(ap|sp|f0|mgc)/);
                    const buf = await res.arrayBuffer();
                    let view = new DataView(buf);

                    let arr = new Float64Array(view.byteLength / 4);
                    arr.fill(0);
                    for (let i = 0, l = view.byteLength / 4; i < l; i++) {
                        arr[i] = view.getFloat32(i * 4, true);  //リトルエンディアン
                    }
                    this.sounds[index][param] = arr;
                }
            }
            this.isLoaded = true;
        };
        load();
    }

    mgc2sp(index) {
        const wait = () => {
            if(!this.isLoaded)  setTimeout(wait, 300);
            else {
                //for(let index = 0; index < 1/*this.soundIndex.length*/; index++){
                    const mgc_size = this.sounds[index]["mgc"].length * this.sounds[index]["mgc"].BYTES_PER_ELEMENT;
                    const mgc_ptr = Module._malloc(mgc_size);
                    let mgc_heap = new Uint8Array(Module.HEAPU8.buffer, mgc_ptr, mgc_size);
                    mgc_heap.set(new Uint8Array(this.sounds[index]["mgc"].buffer));
            
                    const out = new Float64Array(this.sounds[index]["ap"].length);
                    const out_size = out.length * out.BYTES_PER_ELEMENT;
                    const out_ptr = Module._malloc(out_size);
                    let out_heap = new Uint8Array(Module.HEAPU8.buffer, out_ptr, out_size);
                    out_heap.set(new Uint8Array(out.buffer));
                    console.time('mgc2sp');
                    this._mgc2sp(mgc_ptr, this.sounds[index]["mgc"].length, 10, this.fft_size, 3, 0.544, 0, 0, 0, 0, out_ptr)
                    console.timeEnd('mgc2sp');
                    out_heap = new Uint8Array(Module.HEAPU8.buffer, out_ptr, out_size);
                    const result = new Float64Array(out_heap.buffer, out_heap.byteOffset, out.length);
                    this.sounds[index]["sp"] = new Float64Array(result);
                    Module._free(mgc_heap.byteOffset);
                    Module._free(out_heap.byteOffset);   
                    delete this.sounds[index]["mgc"];
                //}
        
            }
        }
        wait();
    }

    setFunction(syn, mgc) {
        this._synthesis = syn;
        this._mgc2sp = mgc;
    }

    scoreToBuffer(score, basePitch, verticalNum, bpm, beats) {
        let f0_len = 0, sp_len = 0, ap_len = 0;
        let lastIndex = 0;
        for (let s of score) {
            let length = this.cellToMSeconds(bpm, beats, s.end - s.start + 1);
            if (s.start - lastIndex > 0) {
                length += this.cellToMSeconds(bpm, beats, s.start - lastIndex);
            }
            const time_len = Math.floor(length / this.frame_period);
            f0_len += time_len;
            sp_len += time_len * this.f_points;  //周波数方向1025点
            ap_len += time_len * this.f_points;
            lastIndex = s.end + 1;
        }

        let f0_buf = new Float64Array(f0_len);
        let sp_buf = new Float64Array(sp_len);
        let ap_buf = new Float64Array(ap_len);

        let f0_offset = 0;
        let sp_offset = 0;
        let ap_offset = 0;
        lastIndex = 0;
        for (let s of score) {
            if (s.start - lastIndex > 0) {
                let length = this.cellToMSeconds(bpm, beats, s.start - lastIndex);
                length /= this.frame_period;
                length = Math.floor(length);
                f0_buf.set(Array(length).fill(0), f0_offset);
                sp_buf.set(Array(length * this.f_points).fill(0), sp_offset);
                ap_buf.set(Array(length * this.f_points).fill(0), ap_offset);
                f0_offset += length;
                sp_offset += length * this.f_points;
                ap_offset += length * this.f_points;
            }
            const index = this.soundIndex.indexOf(s.lyric);
            if(!this.sounds[index]["sp"])   this.mgc2sp(index);
            const _f0 = this.makePitch(this.sounds[index].f0, this.pitchToMidiNum(s.pitch, basePitch, verticalNum));
            const [f0, sp, ap] = this.alignLength(_f0, this.sounds[index].sp, this.sounds[index].ap, bpm, beats, s.end - s.start + 1);
            f0_buf.set(f0, f0_offset);
            sp_buf.set(sp, sp_offset);
            ap_buf.set(ap, ap_offset);
            f0_offset += f0.length;
            sp_offset += sp.length;
            ap_offset += ap.length;
            lastIndex = s.end + 1;
        }

        return [f0_buf, sp_buf, ap_buf];
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

    alignLength(f0, sp, ap, bpm, beats, length) {
        const m_sec = this.cellToMSeconds(bpm, beats, length);
        const times = (f0.length * this.frame_period) / m_sec;
        const f_points = sp.length / f0.length;

        const time_length = Math.floor((f0.length - 1) / times);
        const _f0 = new Float64Array(time_length);
        const _sp = new Float64Array(time_length * f_points);
        const _ap = new Float64Array(time_length * f_points);

        for (let i = 0, len = _f0.length; i < len; i++) {
            const newIdx = i * times;
            const x = newIdx - Math.floor(newIdx);
            for (let j = 0; j < f_points; j++) {
                _sp[i * f_points + j] = this.linear(sp[Math.floor(newIdx) * f_points + j], sp[Math.ceil(newIdx) * f_points + j], x);
                _ap[i * f_points + j] = this.linear(ap[Math.floor(newIdx) * f_points + j], ap[Math.ceil(newIdx) * f_points + j], x);
            }
            _f0[i] = this.linear(f0[Math.floor(newIdx)], f0[Math.ceil(newIdx)], x);
        }
        return [_f0, _sp, _ap];
    }

    linear(y2, y1, x) {
        return (y2 - y1) * x + y1;
    }

    cellToMSeconds(bpm, beats, length) {
        return 1000 * 60 * length / (bpm * beats);
    }

    synthesis(score, basePitch, verticalNum, bpm, beats) {
        console.time('score2Buf');
        const [f0, sp, ap] = this.scoreToBuffer(score, basePitch, verticalNum, bpm, beats);
        console.timeEnd('score2Buf');
        if (f0.length === 0) return [];
        console.time('heap');

        const f0_length = f0.length;

        const f0_size = f0_length * f0.BYTES_PER_ELEMENT;
        const f0_ptr = Module._malloc(f0_size);
        let f0_heap = new Uint8Array(Module.HEAPU8.buffer, f0_ptr, f0_size);
        f0_heap.set(new Uint8Array(f0.buffer));

        const sp_size = sp.length * sp.BYTES_PER_ELEMENT;
        const sp_ptr = Module._malloc(sp_size);
        let sp_heap = new Uint8Array(Module.HEAPU8.buffer, sp_ptr, sp_size);
        sp_heap.set(new Uint8Array(sp.buffer));

        //ポインタの型つき配列を作成 max:2GB
        const sp_pointers = new Uint32Array(f0_length);
        for (let i = 0; i < f0_length; i++) {
            sp_pointers[i] = sp_ptr + i * sp.BYTES_PER_ELEMENT * this.f_points;
        }
        const sp_pointers_size = sp_pointers.length * sp_pointers.BYTES_PER_ELEMENT;
        const sp_pointers_ptr = Module._malloc(sp_pointers_size);
        let sp_pointers_heap = new Uint8Array(Module.HEAPU8.buffer, sp_pointers_ptr, sp_pointers_size);
        sp_pointers_heap.set(new Uint8Array(sp_pointers.buffer));

        const ap_size = ap.length * ap.BYTES_PER_ELEMENT;
        const ap_ptr = Module._malloc(ap_size);
        let ap_heap = new Uint8Array(Module.HEAPU8.buffer, ap_ptr, ap_size);
        ap_heap.set(new Uint8Array(ap.buffer));

        //ポインタの型つき配列を作成 max:2GB
        const ap_pointers = new Uint32Array(f0_length);
        for (let i = 0; i < f0_length; i++) {
            ap_pointers[i] = ap_ptr + i * ap.BYTES_PER_ELEMENT * this.f_points;
        }
        const ap_pointers_size = ap_pointers.length * ap_pointers.BYTES_PER_ELEMENT;
        const ap_pointers_ptr = Module._malloc(ap_pointers_size);
        let ap_pointers_heap = new Uint8Array(Module.HEAPU8.buffer, ap_pointers_ptr, ap_pointers_size);
        ap_pointers_heap.set(new Uint8Array(ap_pointers.buffer));

        //worldで定義されていた通り
        const out_length = Math.floor((f0.length - 1) * this.frame_period / 1000.0 * this.fs) + 1;
        const out = new Float64Array(out_length);
        const out_size = out.length * out.BYTES_PER_ELEMENT;
        const out_ptr = Module._malloc(out_size);
        let out_heap = new Uint8Array(Module.HEAPU8.buffer, out_ptr, out_size);
        out_heap.set(new Uint8Array(out.buffer));

        console.timeEnd('heap');
        console.time('synthesis');
        //double frame_period, int fs, double *f0, int f0_len, double **sp, double**ap, int fft_size, int out_len, double *out
        this._synthesis(this.frame_period, this.fs, f0_ptr, f0_length, sp_pointers_ptr, ap_pointers_ptr,
            this.fft_size, out_length, out_ptr);
        console.timeEnd('synthesis');

        out_heap = new Uint8Array(Module.HEAPU8.buffer, out_ptr, out_size);
        const result = new Float64Array(out_heap.buffer, out_heap.byteOffset, out_length);

        Module._free(f0_heap.byteOffset);
        Module._free(sp_heap.byteOffset);
        Module._free(sp_pointers_heap.byteOffset);
        Module._free(ap_heap.byteOffset);
        Module._free(ap_pointers_heap.byteOffset);
        Module._free(out_heap.byteOffset);

        const audio = Array.from(result);
        return audio;
    }

}