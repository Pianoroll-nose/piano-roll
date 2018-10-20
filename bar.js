class Bar {
    constructor(verticalNum) {
        this.canvas = document.getElementById("bar");
        this.ctx = this.canvas.getContext("2d");
        this.verticalNum = verticalNum;
        this.resize();

        //stという変数がストップしている状態を表すフラグなのであればisStoppedなどにしてboolean型にした方が良いのでは
        this.x = 0;
        this.st = 0;
    }

    barStart() {
        this.x = 0;
        this.st = 0;

        const animation = () => {
            this.ctx.clearRect(0, 0, this.areaWidth, 40);
            this.drawFrame();
            //this.ctx.strokeStyle = "green";

            this.ctx.beginPath();
            this.ctx.moveTo(this.x - 15, 0);
            this.ctx.lineTo(this.x + 15, 0);
            this.ctx.lineTo(this.x, 19);
            this.ctx.closePath();

            //this.ctx.strokeStyle = "green";
            //this.ctx.stroke();

            this.ctx.fillStyle = "green";
            this.ctx.fill();

            if (this.x > 3000) {
                this.x = 0;
            } else if (this.st == 1) {
            } else {
                this.x += 2;
                requestAnimationFrame(animation);
            }

        };
        animation();
    }

    barStop() {
        this.st = 1;
    }

    barReset() {
        this.st = 1;
        this.x = 0;

        this.ctx.clearRect(0, 0, this.areaWidth, 40);
        this.ctx.strokeStyle = "black";
        this.ctx.strokeRect(0, 0, this.areaWidth, 20);

        //this.ctx.strokeStyle = "green";

        this.ctx.beginPath();
        this.ctx.moveTo(this.x - 15, 0);
        this.ctx.lineTo(this.x + 15, 0);
        this.ctx.lineTo(this.x, 19);
        this.ctx.closePath();

        //this.ctx.strokeStyle = "green";
        //this.ctx.stroke();

        this.ctx.fillStyle = "green";
        this.ctx.fill();
    }

    resize() {
        this.areaWidth = this.canvas.clientWidth;
        this.areaHeight = this.canvas.clientHeight;
        this.drawFrame();
        this.barReset();
    }
    
    drawFrame() {
        this.ctx.strokeStyle = "black";
        this.ctx.strokeRect(0, 0, this.areaWidth, this.areaHeight / 2);
    }
}