class Piano {
    constructor(verticalNum, basePitch) {
        this.canvas = document.getElementById("piano");
        this.ctx = this.canvas.getContext("2d");
        this.verticalNum = verticalNum;
        this.basePitch = basePitch;
        this.baseOctave = parseInt(basePitch.match(/\d/)[0], 10);
        this.resize();
    }

    resize() {
        this.areaWidth = this.canvas.clientWidth;
        this.areaHeight = this.canvas.clientHeight;
        this.draw();
    }

    draw() {
        this.ctx.clearRect(0, 0, this.areaWidth, this.areaHeight);

        const pianoCellHeight = this.areaHeight / this.verticalNum;

        this.ctx.strokeStyle = "black";
        this.ctx.font = pianoCellHeight / 3 + "px Arial";
        this.ctx.textBaseline = "middle";

        this.ctx.strokeRect(0, 0, this.areaWidth, this.areaHeight);

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

            this.ctx.fillText("C" + String(this.baseOctave + o), this.areaWidth * 3 / 4,  pianoCellHeight * (12 * (octave - o)) - pianoCellHeight / 2, this.areaWidth / 4);
        }
    }
}