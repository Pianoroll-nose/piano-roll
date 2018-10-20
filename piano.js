class Piano {
    constructor(verticalNum) {
        this.canvas = document.getElementById("piano");
        this.ctx = this.canvas.getContext("2d");
        this.verticalNum = verticalNum;
        this.resize();
    }

    resize() {
        this.areaWidth = this.canvas.clientWidth;
        this.areaHeight = this.canvas.clientHeight;
        this.draw();
    }

    draw() {
        this.ctx.clearRect(0, 0, this.areaWidth, this.areaHeight);

        this.ctx.strokeStyle = "black";
        this.ctx.strokeRect(0, 0, this.areaWidth, this.areaHeight);

        const pianoCellHeight = this.areaHeight / this.verticalNum;

        for(let h = 0; h <= this.areaHeight; h += pianoCellHeight){
            this.ctx.strokeStyle = "gray";


            this.ctx.beginPath();
            this.ctx.moveTo(0, h);
            this.ctx.lineTo(this.areaWidth, h);
            this.ctx.stroke();
        }

        const octave = this.verticalNum / 12;

        for(let o = 0; o < octave; o++){
            this.ctx.fillStyle = "black";
            this.ctx.fillRect(0, pianoCellHeight * (1 + 12 * (octave - 1 - o)), this.areaWidth * 2 / 3, pianoCellHeight);
            this.ctx.fillRect(0, pianoCellHeight * (3 + 12 * (octave - 1 - o)), this.areaWidth * 2 / 3, pianoCellHeight);
            this.ctx.fillRect(0, pianoCellHeight * (5 + 12 * (octave - 1 - o)), this.areaWidth * 2 / 3, pianoCellHeight);
            this.ctx.fillRect(0, pianoCellHeight * (8 + 12 * (octave - 1 - o)), this.areaWidth * 2 / 3, pianoCellHeight);
            this.ctx.fillRect(0, pianoCellHeight * (10 + 12 * (octave - 1 - o)), this.areaWidth * 2 / 3, pianoCellHeight);

            this.ctx.fillText("C" + String(o), this.areaWidth * 3 / 4,  pianoCellHeight * (11 + 12 * (octave - 1 - o)) + 25);
        }
    }
}