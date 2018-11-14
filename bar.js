class Bar {
    constructor(bpm, horizontalNum, beats) {
        this.container = document.getElementById("bar-container");
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

    play() {
        if(this.id !== null)    this.cancelAnimation();

        const startTime = performance.now();
        const startX = this.x;
        
        const animation = () => {
            this.drawTriangle();

            const currentTime = performance.now();

            if(this.x > this.areaWidth) {
                this.x = 0;
                this.drawTriangle();
                this.cancelAnimation();
            }
            else {
                const diffMin = (currentTime - startTime) / 1000 / 60;   //ms->s->m
                this.x = startX + diffMin * this.bpm * this.beats * this.cellWidth;

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

        this.drawTriangle();
    }

    cancelAnimation() {
        cancelAnimationFrame(this.id);
        this.id = null;
    }

    updateBpm(bpm) { 
        this.stop();
        this.bpm = bpm;
    }

    drawTriangle() {
        const triangleWidth = this.areaWidth / 200;
        const triangleHeight = this.areaHeight * 2 / 3;

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

    resize() {
        this.areaWidth = this.canvas.clientWidth;
        this.areaHeight = this.canvas.clientHeight;
        this.stop();
    }
}