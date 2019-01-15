class Sox {
    constructor() {
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
        this.soundIndex = Util.getSoundIndex();
        /*
        this.audio = document.querySelector('audio');
        var source = this.ctx.createMediaElementSource(this.audio);
        source.connect(this.ctx.destination);
        this.audio.playbackRate = 0.5;
        this.audio.play();
        this.audio.addEventListener('loadstart', function() {
            var source = this.ctx.createMediaElementSource(audio);
            source.connect(this.ctx.destination);
            this.audio.play();
        }, false);
        */
    }

    async synthesis(score, basePitch, verticalNum, bpm, beats) {
        let lastIndex = 0;
        let start = 0;
        const startTime = this.ctx.currentTime + 3;
        const play = (wav, start) => {
            this.ctx.decodeAudioData(new Uint8Array(wav).buffer, (res) => {
                const source = this.ctx.createBufferSource();
                source.buffer = res;
                source.connect(this.ctx.destination);
                source.start(startTime + start, 0, source.buffer.duration);
            });
        }
        for(let s of score) {
            if (s.start - lastIndex > 0) {
                start += 60 * (s.start - lastIndex) / (bpm * beats);
            }
            const length = 60 * (s.end - s.start + 1) / (bpm * beats);
            lastIndex = s.end + 1;
            console.time('timeStretch');
            const wav = this.timestretch(this.soundIndex.indexOf(s.lyric), length);
            console.timeEnd('timestretch');
            play(wav, start);
            start += length;
        }
    }

    pitchToMidiNum(pitch, basePitch, verticalNum) {
        const pitchList = ['C', 'C+', 'D', 'D+', 'E', 'F', 'F+', 'G', 'G+', 'A', 'A+', 'B'];
        const b_pitch = basePitch.match(/[A-G]?/)[0];
        const b_octave = basePitch.match(/\d/)[0];

        const pitchOffset = (9 - pitchList.indexOf(b_pitch) + 12) % 12; //indexOf("A") = 9
        const octaveOffset = (4 - b_octave) * 12;
        return (69 - pitchOffset + octaveOffset) + (verticalNum - 1 - pitch);
    }

    setFunction(func) {
        this._timeStretch = func;
    }

    timestretch(index, length, pitch) {
        this._timeStretch("./namine_ritsu/"+this.soundIndex[index]+".wav", length, 1.0);
        const wav = FS.findObject('./out.wav').contents;
        return wav;
    }
}