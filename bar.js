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
        this.isStopped = true;
    }

    play() {
        this.isStopped = false;

        if(this.id !== null)    this.cancelAnimation();

        const startTime = performance.now();
        
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
                this.x = diffMin * this.bpm * this.beats * this.cellWidth;
                
                this.id = requestAnimationFrame(animation);    

                if(this.x > this.canvas.innerWidth) { 
                    this.container.scrollLeft = this.x;
                }
            }
        };

        animation();
    }

    pause() {
        this.isStopped = !this.isStopped;
        this.cancelAnimation();
    }

    stop() {
        this.isStopped = true;
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