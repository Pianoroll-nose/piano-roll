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
        this.ctx.strokeStyle = "black";

        for(let i = 0; i < this.measureNum; i++){
            this.ctx.lineWidth = (i % this.beats == 0) ? 4 : 1;

            this.ctx.beginPath();
            this.ctx.moveTo(cellWidth*i, 0);
            this.ctx.lineTo(cellWidth*i, this.areaHeight);
            this.ctx.stroke();
        }

        this.ctx.lineWidth = 1;
        for(let h = 0; h <= this.areaHeight; h += cellHeight){
            this.ctx.beginPath();
            this.ctx.moveTo(0, h);
            this.ctx.lineTo(this.areaWidth, h);
            this.ctx.stroke();
        }
    }
}