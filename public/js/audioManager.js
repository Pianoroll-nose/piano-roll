class AudioManager {
    //audioContext
    constructor(context) {
        this.isPlaying = false;
        this.context = context;
        this.srcs = [];
        this.audioData = null;
        this.startTime = null;
        this.startedIndex = 0;
        this.lastIndex = -1;
    }

    play(mSec) {
        if(this.canStart) {
            if(this.startTime === null) {
                let i = 0, tmp = mSec;
                while(tmp > 1) {
                    tmp /= this.srcs[0].buffer.duration * 1000
                    i++;
                }
                this.startTime = this.context.currentTime;

                this.srcs[0].start(this.startTime, mSec - this.srcs[0].buffer.duration * 1000 * i);
                this.startedIndex++;
            }

            for(let i = this.startedIndex; i < this.srcs.length; i++) {
                this.srcs[i].start(this.startTime, 0);
                this.startTime += this.srcs[i].buffer.duration;
            }
            this.startedIndex = this.srcs.length;
            this.isPlaying = true;
        }
    }

    stop() {
        if(this.isPlaying) {
            for(let s of this.srcs) {
                s.stop();
            }    
        }

        this.srcs = [];
        this.startTime = null;
        this.isPlaying = false;
        this.startedIndex = 0;
        this.lastIndex = -1;
    }

    canStart() {
        return this.srcs.length > 0;
    }

    isPlaying() { 
        return this.isPlaying;
    }

    setSrc(audioData, index) {
        if(this.lastIndex+1 !== index) return;

        const buffer = this.context.createBuffer(1, audioData.length, 16000);
        buffer.copyToChannel(audioData, 0);
        const src = this.context.createBufferSource();
        src.buffer = buffer;
        src.connect(this.context.destination);
        this.srcs.push(src);
        this.lastIndex = index;

        if(this.isPlaying)  this.play();
    }

    setAudioData(audioData) {
        this.audioData = audioData;
    }

    getAudioData() {
        return this.audioData;
    }
}