//枠線などを描画するクラス
class BackGround {
    constructor(measureNum, vNum, beats) {
        this.canvas = document.getElementById("background");
        this.ctx = this.canvas.getContext("2d");
        this.measureNum = measureNum;
        this.verticalNum = vNum;
        this.beats = beats;        

        this.resize();
    }

    resize() {
        this.areaWidth = this.canvas.clientWidth;
        this.areaHeight = this.canvas.clientHeight;
        this.draw();
    }

    draw() {
        this.ctx.clearRect(0, 0, this.areaWidth, this.areaHeight);

        const cellWidth = this.areaWidth / this.measureNum;
        const cellHeight = this.areaHeight / this.verticalNum;
        const black = [1, 3, 6, 8, 10];
        this.ctx.strokeStyle = "black";

        this.ctx.fillStyle = "rgb(158, 158, 158)"
        this.ctx.fillRect(0, 0, this.areaWidth, this.areaHeight);

        this.ctx.lineWidth = 1;
        this.ctx.fillStyle = "rgb(94, 94, 94)";

        //下から引いていく
        for (let h = 0; h <= this.verticalNum; h++) {
            const currentY = this.areaHeight - h * cellHeight - cellHeight;
            this.ctx.beginPath();
            this.ctx.moveTo(0, currentY);
            this.ctx.lineTo(this.areaWidth, currentY);

            if(black.includes(h % 12))
                this.ctx.fillRect(0, currentY, this.areaWidth, cellHeight);
            this.ctx.stroke();
        }

        for (let i = 0; i <= this.measureNum; i++) {
            this.ctx.lineWidth = (i % this.beats == 0) ? 4 : 1;

            this.ctx.beginPath();
            this.ctx.moveTo(cellWidth * i, 0);
            this.ctx.lineTo(cellWidth * i, this.areaHeight);
            this.ctx.stroke();
        }
    }
}