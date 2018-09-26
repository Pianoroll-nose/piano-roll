function start(){
    let pContainer = document.getElementById("piano-container");
    let eContainer = document.getElementById("editor-container");
    //canvasの幅をdivの幅に揃える
    document.getElementById('piano').width = pContainer.clientWidth;

    //スクロールを合わせる
    pContainer.onscroll = function(){
        eContainer.scrollTop = this.scrollTop;
    };
    
    eContainer.onscroll = function(){
        pContainer.scrollTop = this.scrollTop;
    };

    menu = new Menu();
}

//Menuバーのイベントから他のクラスに処理を促すクラス
class Menu {
    constructor() {
        this.notesPerMeasure = 4;
        this.measureNum = 30;
        this.horizontalNum = this.measureNum * this.notesPerMeasure;
        this.verticalNum = 24;
        this.beats = 4;     //何分の何拍子みたいなやつ

        this.editor = new Editor(this.verticalNum, this.horizontalNum, this.measureNum, this.beats);
        this.piano = new Piano(this.verticalNum);

    }
}

class Piano {
    constructor(verticalNum) {
        this.canvas = document.getElementById("piano");
        this.ctx = this.canvas.getContext("2d");
        this.areaWidth = this.canvas.clientWidth;
        this.areaHeight = this.canvas.clientHeight;

        this.verticalNum = verticalNum;
        this.draw();
    }

    draw() {
        this.ctx.strokeStyle = "black";
        this.ctx.strokeRect(0, 0, this.areaWidth, this.areaHeight);

        const pianoCellHeight = this.areaHeight / this.verticalNum;

        for(let h = 0; h <= this.areaHeight; h += pianoCellHeight){

//            if(h / pianoCellHeight % 12 == 0 || h / pianoCellHeight % 12 == 7) {
//                this.ctx.strokeStyle = "black";
//            } else {
                  this.ctx.strokeStyle = "gray";
//            }

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

            this.ctx.fillText("C" + String(o), 170,  pianoCellHeight * (11 + 12 * (octave - 1 - o)) + 25);
        }
    }
}

//打ち込み画面を管理するクラス
class Editor {
    constructor(verticalNum, horizontalNum, measureNum, beats){
        this.verticalNum = verticalNum;
        this.horizontalNum = horizontalNum;
        this.measureNum = measureNum;
        this.beats = beats;

        this.score = new Score(this.horizontalNum, this.verticalNum);

        this.backGround = new BackGround(this.measureNum, this.verticalNum, this.beats);

        this.draw();
    }

    draw() {
        this.backGround.draw(this.ctx);
        this.score.draw(this.ctx);
    }
}

//枠線などを描画するクラス
class BackGround {
    constructor(measureNum, vNum, beats) {
        this.canvas = document.getElementById("background");
        this.ctx = this.canvas.getContext("2d");
        this.areaWidth = this.canvas.clientWidth;
        this.areaHeight = this.canvas.clientHeight;
        this.measureNum = measureNum;
        this.verticalNum = vNum;
        this.beats = beats;

        this.draw();
    }

    draw() {
        this.ctx.clearRect(0, 0, this.areaWidth, this.areaHeight);

        const cellWidth = this.areaWidth / this.measureNum;
        const cellHeight = this.areaHeight / this.verticalNum;
        this.ctx.strokeStyle = "black";

        for(let w = 0; w <= this.areaWidth; w += cellWidth){
            this.ctx.lineWidth = (w % (cellWidth*this.beats) === 0) ? 4 : 1;

            this.ctx.beginPath();
            this.ctx.moveTo(w, 0);
            this.ctx.lineTo(w, this.areaHeight);
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

//打ち込まれた内部データを処理するクラス
class Score {
    constructor(horizontalNum, verticalNum) {
        this.canvas = document.getElementById("score");
        this.ctx = this.canvas.getContext("2d");
        this.horizontalNum = horizontalNum;
        this.verticalNum = verticalNum;
        this.areaWidth = this.canvas.clientWidth;
        this.areaHeight = this.canvas.clientHeight;
        this.cellWidth = this.areaWidth / this.horizontalNum;
        this.cellHeight = this.areaHeight / this.verticalNum;

        this.score = new Array();
        this.isClicked = false;
        this.isDragging = false;
        this.dragProperty = {
            start: null,
            end: null,
            lyric: "あ",
            pitch: null
        };

        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this), false);
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this), false);
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this), false);
        this.draw();
    }   

    draw() {
        this.ctx.clearRect(0, 0, this.areaWidth, this.areaHeight);

        this.ctx.strokeStyle = "black";
        this.ctx.font = this.cellHeight + "px Arial";
        this.ctx.textBaseline = "middle";

        let objs = this.score.concat();
        if(this.isDragging){
            objs.push(this.dragProperty);
        }

        for(let obj of objs){
            let left = obj.start * this.cellWidth;
            let top = obj.pitch * this.cellHeight;
            let width = (obj.end - obj.start + 1) * this.cellWidth;

            //四角の描画
            this.ctx.fillStyle = "red";
            this.ctx.fillRect(left, top, width, this.cellHeight);
            this.ctx.strokeRect(left, top, width, this.cellHeight);

            //歌詞の描画
            this.ctx.fillStyle = "black";
            this.ctx.fillText(obj.lyric, left, top + this.cellHeight / 2, width);
        }
    }

    noteExists(x, y) {
        for(let i = 0, length = this.score.length; i < length; i++){
            if(this.score[i].start <= x && x <= this.score[i].end){
                if(this.score[i].pitch === y){
                    return i;
                }
            }
        }

        return -1;
    }

    addNote(obj) {
        let shouldDelete = true, objList = [obj];

        /*
            追加するセルの先頭がすでにあるセルとセルの間にあるなら,挿入するインデックスのみを保持
            追加するセルの先頭がすでにあるセルに被っていたら,元のセルの長さを変更してobjListの先頭に追加
            追加するセルがどこのセルとも被ってなかったらshouldDeleteフラグを消す
        */

        for(var i_s = 0, length = this.score.length; i_s < length; i_s++){
            if(this.score[i_s].start >= obj.start){
                if(this.score[i_s].start > obj.end){
                    shouldDelete = false;
                }
                break;
            }
            if(this.score[i_s].start < obj.start && obj.start <= this.score[i_s].end){
                let tmp = Object.assign({}, this.score[i_s]);
                tmp.end = obj.start-1;
                objList.unshift(tmp);
                break;
            }
        }

        /*
            追加するセルの末尾がすでにあるセルに被っていたら,元のセルの長さを変更してobjListの先頭に追加
            追加するセルの末尾がすでにあるセルとセルの間にあるなら,挿入するインデックスのみを保持
        */

        for(var i_e = i_s; i_e < length; i_e++){
            if(this.score[i_e].start <= obj.end && obj.end < this.score[i_e].end){
                let tmp = Object.assign({}, this.score[i_e]);
                tmp.start = obj.end+1;
                objList.push(tmp);
                break;
            }

            if(this.score[i_e].end >= obj.end){
                break;
            }
        }

        let deleteNum = shouldDelete ? i_e-i_s+1 : 0;

        this.score.splice.apply(this.score, [i_s, deleteNum].concat(objList));
    }

    addTextBox(index) {
        const input = document.createElement("input");
        input.type = "text";
        input.id = "lyric";
        input.value = this.score[index].lyric;
        input.style.position = "absolute";
        input.style.fontSize = this.cellHeight + "px";
        input.style.top = this.score[index].pitch * this.cellHeight + "px";
        input.style.left = this.score[index].start * this.cellWidth + "px";
        input.style.width = this.cellWidth * (this.score[index].end - this.score[index].start + 1) + "px";
        input.style.height = this.cellHeight + "px";
        input.style.padding = "0px";
        input.style.margin = "0px";
        input.style.border = "0px";
        input.style.backgroundColor = "red";
        input.onblur = function() {
            this.parentNode.removeChild(this);
        };
        input.onkeypress = function(e) {
            if(e.keyCode === 13){
                let txtBox = document.getElementById("lyric");
                this.score[index].lyric = txtBox.value;
                txtBox.blur();
                this.draw();
            }
        }.bind(this);

        //テキストボックスの追加
        this.canvas.parentNode.insertBefore(input, this.canvas.nextSibling);

        //テキストボックスにフォーカスを合わせる
        setTimeout(function() {
            document.getElementById("lyric").focus();
        }, 0);

    }

    onMouseDown(e) {
        const rect = e.target.getBoundingClientRect();
        const x = Math.max(0, e.clientX - rect.left);
        const y = Math.max(0, e.clientY - rect.top);
        const xIndex = Math.floor(x / this.cellWidth);
        const yIndex = Math.floor(y / this.cellHeight);
        const sameIndex = this.noteExists(xIndex, yIndex);

        if(sameIndex !== -1){
            if(this.isClicked){
                this.addTextBox(sameIndex);
                this.isClicked = false;
            }
            else{
                this.isClicked = true;
                setTimeout(function() {
                    if(this.isClicked){
                        this.score.splice(sameIndex, 1);
                    }
                    this.isClicked = false;
                    this.draw();
                }.bind(this), 200);
            }
        }
        else{
            this.dragProperty.start = xIndex;
            this.dragProperty.pitch = yIndex;
            this.dragProperty.end = xIndex;
            this.isDragging = true;
        }

        this.draw();
    }

    onMouseUp(e) {
        if(this.isDragging){
            const rect = e.target.getBoundingClientRect();
            const x = e.clientX - rect.left;
            this.dragProperty.end = Math.max(this.dragProperty.start, Math.floor(x / this.cellWidth));
            this.isDragging = false;

            this.addNote(this.dragProperty);
            this.draw();

            this.dragProperty = {
                start: null,
                end: null,
                lyric: "あ",
                pitch: null
            };
        }
    }

    onMouseMove(e) {
        if(this.isDragging){
            const rect = e.target.getBoundingClientRect();
            const x = e.clientX - rect.left;
            this.dragProperty.end = Math.max(this.dragProperty.start, Math.floor(x / this.cellWidth));
            this.draw();
        }
    }
}