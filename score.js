//打ち込まれた内部データを処理するクラス
class Score {
    constructor(horizontalNum, verticalNum) {
        this.canvas = document.getElementById("score");
        this.ctx = this.canvas.getContext("2d");
        this.horizontalNum = horizontalNum;
        this.verticalNum = verticalNum;

        this.score = new Array();
        this.scoreStack = new Array();
        this.scoreStack.push(null);
        this.scoreStack.add = (index, removed, added) => { 
            this.scoreStack.splice(this.stackTop+1, this.score.length-this.stackTop+1);
            this.scoreStack.push({
                index: index,
                removed: removed,
                added: added
            });
            this.stackTop = this.scoreStack.length-1;    
        }
        this.stackTop = 0;

        this.isClicked = false;
        this.isDragging = false;
        this.dragProperty = {
            start: null,
            end: null,
            lyric: "あ",
            pitch: null
        };

        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this), false);
        window.addEventListener('mouseup', this.onMouseUp.bind(this), false);
        window.addEventListener('mousemove', this.onMouseMove.bind(this), false);
        this.resize();
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
            this.ctx.fillStyle = obj === this.dragProperty ? "rgba(255, 0, 0, 0.4)" : "red";
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

    undo() {
        const top = this.scoreStack[this.stackTop];
        if(top !== null){
            Array.prototype.splice.apply(this.score, [top.index, top.added.length].concat(top.removed));
            this.stackTop--;
        }
        this.draw();
    }

    redo() {
        if(this.stackTop+1 < this.scoreStack.length){
            this.stackTop++;
            const top = this.scoreStack[this.stackTop];
            Array.prototype.splice.apply(this.score, [top.index, top.removed.length].concat(top.added));
        }
        this.draw();
    }

    resize() {
        this.areaWidth = this.canvas.clientWidth;
        this.areaHeight = this.canvas.clientHeight;
        this.cellWidth = this.areaWidth / this.horizontalNum;
        this.cellHeight = this.areaHeight / this.verticalNum;
        this.draw();
    }

    clear() {
        this.setScore([]);
    }

    setScore(score) {
        this.scoreStack.add(0, this.score, score);
        this.score = score.concat();
        this.draw();
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

        const removed = Array.prototype.splice.apply(this.score, [i_s, deleteNum].concat(objList));
        this.scoreStack.add(i_s, removed, objList);
    }

    addTextBox(index) {
        const input = document.createElement("input");
        input.type = "text";
        input.id = "lyric";
        input.value = this.score[index].lyric;
        input.style.position = "absolute";
        input.style.fontSize = Math.min(this.cellHeight, this.cellWidth) + "px";
        input.style.top = this.score[index].pitch * this.cellHeight + "px";
        input.style.left = this.score[index].start * this.cellWidth + "px";
        input.style.width = this.cellWidth * (this.score[index].end - this.score[index].start + 1) + "px";
        input.style.height = this.cellHeight + "px";
        input.style.padding = "0px";
        input.style.margin = "0px";
        input.style.border = "0px";
        input.style.backgroundColor = "red";
        this.canvas.style.pointerEvents = "none";

        input.onchange = () => {
            const txtBox = document.getElementById("lyric");
            const add = Object.assign({}, this.score[index]);
            add.lyric = txtBox.value;
            this.addNote(add);
            this.draw();
            txtBox.parentNode.removeChild(txtBox);
            this.canvas.style.pointerEvents = "auto";
        }
        /*
        input.onblur = function() {
            this.parentNode.removeChild(this);
            console.log(this);
        };
        /*
        input.onkeypress = function(e) {
            if(e.keyCode === 13){
                const txtBox = document.getElementById("lyric");
                const add = Object.assign({}, this.score[index]);
                add.lyric = txtBox.value;
                this.addNote(add);
                txtBox.blur();
                this.draw();
            }
        }.bind(this);
        */
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
                        this.scoreStack.add(sameIndex, this.score.splice(sameIndex, 1), []);
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
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            this.dragProperty.end = Math.max(this.dragProperty.start, Math.floor(x / this.cellWidth));
            this.isDragging = false;

            this.addNote(this.dragProperty);

            this.dragProperty = {
                start: null,
                end: null,
                lyric: "あ",
                pitch: null
            };
            this.draw();
        }
    }

    onMouseMove(e) {
        if(this.isDragging){
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            this.dragProperty.end = Math.max(this.dragProperty.start, Math.floor(x / this.cellWidth));
            this.draw();
        }
    }
}