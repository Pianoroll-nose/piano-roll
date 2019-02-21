class Bar {
    constructor(bpm, horizontalNum, beats, ctx) {
        this.disp = document.querySelector('.parameters').lastElementChild;
        this.canvas = document.getElementById("bar");
        this.container = document.getElementById('editor-container');
        this.ctx = this.canvas.getContext("2d");
        this.audioCtx = ctx;
        this.bpm = bpm;
        this.horizontalNum = horizontalNum;
        this.beats = beats;
        this.id = null;
        this.src = null;
        this.resize();

        this.x = 0;
    }

    play(buf, mSec) {
        if (this.id !== null) {
            this.x = 0;
            this.cancelAnimation();
        }
        
        const buffer = this.audioCtx.createBuffer(1, buf.length, 16000);
        buffer.copyToChannel(buf, 0);
        const src = this.audioCtx.createBufferSource();
        src.buffer = buffer;
        const gainNode = this.audioCtx.createGain();
        gainNode.gain.value = 5;
        src.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);
        
        //src.connect(this.audioCtx.destination);

        this.src = src;
        const startX = this.x;
        const startTime = performance.now();

        src.start(this.audioCtx.currentTime, mSec/1000);

        const animation = () => {
            this.drawBar();

            const currentTime = performance.now();

            if (this.x > this.areaWidth) {
                this.stop();
            }
            else {
                const diff = (currentTime - startTime) / 1000; //s
                const diffMin = diff / 60;  //s->m
                const diffSec = diff % 60;
                const diffMSec = diff * 100000 % 10000; //4桁表示
                this.x = startX + diffMin * this.bpm * this.beats * this.cellWidth;
                this.disp.innerHTML =
                    ('000' + Math.floor(diffMin)).slice(-3) + ':' +
                    ('00' + Math.floor(diffSec)).slice(-2) + '.' +
                    (Math.floor(diffMSec) + '0000').substr(0, 4);
                this.id = requestAnimationFrame(animation);
                this.container.scrollLeft = this.x - this.containerWidth / 2;
            }
        };

        animation();
    }

    pause() {
        this.cancelAnimation();
    }

    stop() {
        this.x = 0;
        this.cancelAnimation();
        this.disp.innerHTML = '000:00.0000';
        this.drawBar();

        if(this.src !== null){
            this.src.stop();
            this.src = null;
        }
        this.container.scrollLeft = 0;
    }

    cancelAnimation() {
        cancelAnimationFrame(this.id);
        this.id = null;
    }

    updateBpm(bpm) {
        this.stop();
        this.bpm = bpm;
    }

    updateSeconds(mSec) {
        this.x = mSec / 60 / 1000 * this.bpm * this.beats * this.cellWidth;
        this.drawBar();
    }

    drawBar() {
        this.ctx.clearRect(0, 0, this.areaWidth, this.areaHeight);
        this.ctx.fillStyle = "green";
        this.ctx.fillRect(this.x, 0, 2, this.areaHeight);
    }

    resize() {
        this.areaWidth = this.canvas.clientWidth;
        this.areaHeight = this.canvas.clientHeight;
        this.containerWidth = this.container.clientWidth;
        this.cellWidth = this.areaWidth / this.horizontalNum;
        this.drawBar();
        this.stop();
    }
}