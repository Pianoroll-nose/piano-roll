class Bar {
    constructor(bpm, horizontalNum, beats) {
        this.disp = document.querySelector('.parameters').lastElementChild;
        this.canvas = document.getElementById("bar");
        this.ctx = this.canvas.getContext("2d");
        this.bpm = bpm;
        this.horizontalNum = horizontalNum;
        this.beats = beats;
        this.cellWidth = this.canvas.clientWidth / horizontalNum;
        this.id = null;
        this.resize();

        this.x = 0;
    }

    play(ctx, src, mSec) {
        if (this.id !== null) {
            this.x = 0;
            this.cancelAnimation();
        }

        src.start(ctx.currentTime, mSec / 1000);

        const startTime = ctx.currentTime;
        const startX = this.x;

        const animation = () => {
            this.drawBar();

            const currentTime = ctx.currentTime;

            if (this.x > this.areaWidth) {
                this.stop();
            }
            else {
                const diff = currentTime - startTime;
                const diffMin = diff / 60;//s->m
                const diffSec = diff % 60;
                const diffMSec = diff * 100000 % 10000; //4桁表示
                this.x = startX + diffMin * this.bpm * this.beats * this.cellWidth;
                this.disp.innerHTML =
                    ('000' + Math.floor(diffMin)).slice(-3) + ':' +
                    ('00' + Math.floor(diffSec)).slice(-2) + '.' +
                    (Math.floor(diffMSec) + '0000').substr(0, 4);
                this.id = requestAnimationFrame(animation);

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
    /*
    drawTriangle() {
        const triangleWidth = this.areaWidth / 200;
        const triangleHeight = this.areaHeight;

        this.ctx.clearRect(0, 0, this.areaWidth, this.areaHeight);
        this.ctx.strokeStyle = "black";
        this.ctx.strokeRect(0, 0, this.areaWidth, triangleHeight);

        this.ctx.beginPath();
        this.ctx.moveTo(this.x - triangleWidth, 0);
        this.ctx.lineTo(this.x + triangleWidth, 0);
        this.ctx.lineTo(this.x, triangleHeight);
        this.ctx.closePath();

        this.ctx.fillStyle = "green";
        this.ctx.fill();

    }
    */
    resize() {
        this.areaWidth = this.canvas.clientWidth;
        this.areaHeight = this.canvas.clientHeight;
        this.drawBar();
        this.stop();
    }
}