class Score {
    constructor(horizontalNum, verticalNum) {
        this.canvas = document.getElementById("score");
        this.ctx = this.canvas.getContext("2d");
        this.container = document.getElementById('editor-container');
        this.horizontalNum = horizontalNum;
        this.verticalNum = verticalNum;

        this.score = [];
        this.scoreStack = new ScoreStack();

        this.mouseDown = false;
        this.isClicked = false;
        this.isMoving = false;
        this.selectedNotes = [];
        this.lastClicked = {
            x: null,
            y: null
        };
        this.isDragging = false;
        this.dragProperty = {
            start: null,
            end: null,
            lyric: "あ",
            pitch: null
        };

        this.scrollId = null;

        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this), false);
        window.addEventListener('mouseup', this.onMouseUp.bind(this), false);
        window.addEventListener('mousemove', this.onMouseMove.bind(this), false);
        window.addEventListener('keydown', (e) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedNotes.length !== 0) {
                this.removeSelectedNotes();
            }
        }, false);
        this.resize();
    }

    draw() {
        const _draw = (score, backColor, fontColor) => {
            for (let s of score) {
                let left = s.start * this.cellWidth;
                let top = s.pitch * this.cellHeight;
                let width = (s.end - s.start + 1) * this.cellWidth;

                //四角の描画
                this.ctx.fillStyle = backColor;
                this.ctx.fillRect(left, top, width, this.cellHeight);
                this.ctx.strokeRect(left, top, width, this.cellHeight);

                //歌詞の描画
                this.ctx.fillStyle = fontColor;
                this.ctx.fillText(s.lyric, left, top + this.cellHeight * 0.6, width);
            }
        }

        this.ctx.clearRect(0, 0, this.areaWidth, this.areaHeight);

        this.ctx.strokeStyle = "#00ff00";
        this.ctx.font = this.cellHeight + "px Arial";
        this.ctx.textBaseline = "middle";

        _draw(this.score.filter((e, i) => this.selectedNotes.map(e => e.index).indexOf(i) === -1), "black", "#00ff00");

        if (this.isDragging) {
            this.ctx.strokeStyle = "black";
            _draw([this.dragProperty], "#00ff00", "black");
        }

        /*どうにかできそう*/
        if (this.selectedNotes.length > 0) {
            _draw(this.score.map((e, i) => {
                const obj = Object.assign({}, e);
                const index = this.selectedNotes.map(e => e.index).indexOf(i);
                if (index !== -1) {
                    obj.start += this.selectedNotes[index].diffX;
                    obj.end += this.selectedNotes[index].diffX;
                    obj.pitch += this.selectedNotes[index].diffY;
                }

                return obj;
            }).filter((e, i) => this.selectedNotes.map(e => e.index).indexOf(i) !== -1), "#00ff00", "black");
        }
    }

    changeMode(mode) {
        this.mode = mode;
    }

    noteExists(x, y) {
        for (let i = 0, length = this.score.length; i < length; i++) {
            if (this.score[i].start <= x && x <= this.score[i].end) {
                if (this.score[i].pitch === y) {
                    return i;
                }
            }
        }

        return -1;
    }

    undo() {
        let top = this.scoreStack.pop();
        if (top !== null) {
            for (let i = top.index.length-1; i >= 0; i--) {
                Array.prototype.splice.apply(this.score, [top.index[i], top.added[i].length].concat(top.removed[i]));
            }
            this.scoreStack.decTop();
        }
        this.draw();
    }

    redo() {
        if (this.scoreStack.canRedo()) {
            this.scoreStack.incTop();
            let top = this.scoreStack.pop();
            for (let i = 0, length = top.index.length; i < length; i++) {
                Array.prototype.splice.apply(this.score, [top.index[i], top.removed[i].length].concat(top.added[i]));
            }
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
        this.selectAll();
        this.removeSelectedNotes();
    }

    selectAll() {
        this.selectedNotes = this.score.map((v, i) => {
            return {
                index: i,
                diffX: 0,
                diffY: 0
            };
        });
        this.draw();
    }

    setScore(score) {
        this.scoreStack.push([0], [this.score], [score]);
        this.score = score.concat();
        this.draw();
    }

    //一時的に削除するときは引数にFalseを与える(addNotesからの呼び出し)
    removeSelectedNotes(reallyDelete = true) {
        this.selectedNotes.sort((a, b) => b.index - a.index);
        const added = [];
        const removed = [];
        const start = [];
        for (let s of this.selectedNotes) {
            removed.push(this.score.splice(s.index, 1));
            added.push([]);
            start.push(s.index);
        }
        if (reallyDelete)
            this.scoreStack.push(start, removed, added);
        this.selectedNotes = [];
        this.draw();

        if (!reallyDelete) {
            return { start, removed, added };
        }
    }

    //考え直す必要あり
    addNotes(objs) {
        //選択されているノートを一旦削除(ノートを移動する時用)
        const { start, removed, added } = this.removeSelectedNotes(false);

        for (let i = 0, obj_length = objs.length; i < obj_length; i++) {
            const obj = objs[i];
            let shouldDelete = true, objList = [obj];

            /*
                追加するセルの先頭がすでにあるセルとセルの間にあるなら,挿入するインデックスのみを保持
                追加するセルの先頭がすでにあるセルに被っていたら,元のセルの長さを変更してobjListの先頭に追加
                追加するセルがどこのセルとも被ってなかったらshouldDeleteフラグを消す
            */

            for (var i_s = 0, length = this.score.length; i_s < length; i_s++) {
                if (this.score[i_s].start >= obj.start) {
                    if (this.score[i_s].start > obj.end) {
                        shouldDelete = false;
                    }
                    break;
                }
                if (this.score[i_s].start < obj.start && obj.start <= this.score[i_s].end) {
                    let tmp = Object.assign({}, this.score[i_s]);
                    tmp.end = obj.start - 1;
                    objList.unshift(tmp);
                    break;
                }
            }

            /*
                追加するセルの末尾がすでにあるセルに被っていたら,元のセルの長さを変更してobjListの先頭に追加
                追加するセルの末尾がすでにあるセルとセルの間にあるなら,挿入するインデックスのみを保持
            */

            for (var i_e = i_s; i_e < length; i_e++) {
                if (this.score[i_e].start <= obj.end && obj.end < this.score[i_e].end) {
                    let tmp = Object.assign({}, this.score[i_e]);
                    tmp.start = obj.end + 1;
                    objList.push(tmp);
                    i_e++;
                    break;
                }

                if (this.score[i_e].end > obj.end) {
                    break;
                }
            }

            let deleteNum = shouldDelete ? i_e - i_s : 0;

            removed.push(Array.prototype.splice.apply(this.score, [i_s, deleteNum].concat(objList)))
            added.push(objList);
            start.push(i_s);
        }
        this.scoreStack.push(start, removed, added);
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
        input.style.backgroundColor = "black";
        input.style.color = "#00ff00";
        this.canvas.style.pointerEvents = "none";
        let isCalled = false;

        const add = () => {
            const txtBox = document.getElementById("lyric");
            if (isCalled) return;
            isCalled = true;
            const add = Object.assign({}, this.score[index]);
            if (Util.existsSound(txtBox.value))
                add.lyric = txtBox.value;
            this.addNotes([add]);
            this.draw();
            txtBox.parentNode.removeChild(txtBox);
            this.canvas.style.pointerEvents = "auto";
        }

        input.onblur = add;

        input.onchange = add;

        //テキストボックスの追加
        this.canvas.parentNode.insertBefore(input, this.canvas.nextSibling);

        //テキストボックスにフォーカスを合わせる
        setTimeout(function () {
            const tar = document.getElementById("lyric");
            tar.focus();
            tar.select();
        }, 0);

    }

    onMouseDown(e) {
        if (e.button !== 0) return;

        const rect = e.target.getBoundingClientRect();
        const x = Math.max(0, e.clientX - rect.left);
        const y = Math.max(0, e.clientY - rect.top);
        const xIndex = Math.floor(x / this.cellWidth);
        const yIndex = Math.floor(y / this.cellHeight);
        const sameIndex = this.noteExists(xIndex, yIndex);

        switch (this.mode) {
            case modes['pen']:
                if (sameIndex === -1) {
                    this.selectedNotes = [];
                    this.dragProperty.start = xIndex;
                    this.dragProperty.pitch = yIndex;
                    this.dragProperty.end = xIndex;
                    this.isDragging = true;
                }
            case modes['select']:
                this.lastClicked.x = xIndex;
                this.lastClicked.y = yIndex;

                if (sameIndex !== -1) {
                    if (this.isClicked) {
                        this.selectedNotes = [];
                        this.addTextBox(sameIndex);
                        this.isClicked = false;
                    }
                    else {
                        this.isClicked = true;
                        //選択されていないノートの時
                        const selectedIndex = this.selectedNotes.map(e => e.index).indexOf(sameIndex);
                        const pushed = {
                            index: sameIndex,
                            diffX: 0,
                            diffY: 0
                        };
                        if (selectedIndex === -1) {
                            if (e.shiftKey) this.selectedNotes.push(pushed);
                            else this.selectedNotes = [pushed];
                        }
                        else {
                            if (e.shiftKey) this.selectedNotes.splice(selectedIndex, 1);
                        }

                        setTimeout(function () {
                            this.isClicked = false;
                        }.bind(this), 300);
                    }
                    this.mouseDown = true;
                }
                break;

            case modes['erase']:
                if (sameIndex !== -1) {
                    this.isClicked = this.isMoving = this.isDragging = false;
                    this.selectedNotes = [{
                        index: sameIndex,
                        diffX: 0,
                        diffY: 0
                    }];
                    this.removeSelectedNotes();
                }
        }

        this.draw();
    }

    onMouseUp(e) {
        if (e.button !== 0) return;

        this.mouseDown = false;
        if (this.isMoving) {
            this.isMoving = false;

            const notesAdded = this.selectedNotes.map(e => {
                let s = Object.assign({}, this.score[e.index]);
                s.start = Math.max(0, s.start + e.diffX);
                s.end = Math.min(this.horizontalNum - 1, s.end + e.diffX);
                s.pitch += e.diffY;
                return s;
            });

            this.addNotes(notesAdded);

            this.draw();
        }

        if (this.isDragging) {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            this.dragProperty.end = Math.max(this.dragProperty.start, Math.floor(x / this.cellWidth));
            this.isDragging = false;

            this.addNotes([this.dragProperty]);
            const index = this.score.indexOf(this.dragProperty);
            this.selectedNotes = [{
                index: index,
                diffX: 0,
                diffY: 0
            }];

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
        const con_rect = this.container.getBoundingClientRect();
        const can_rect = this.canvas.getBoundingClientRect();
        const x = Math.max(0, e.clientX - con_rect.left);
        const y = Math.max(0, e.clientY - con_rect.top);
        const xIndex = Math.floor((e.clientX - can_rect.left) / this.cellWidth);
        const yIndex = Math.floor((e.clientY - can_rect.top) / this.cellHeight);
        const diffX = xIndex - this.lastClicked.x;
        const diffY = yIndex - this.lastClicked.y;

        const move = (diffX, diffY, xIndex) => {
            if (this.mouseDown) {
                for (let s of this.selectedNotes) {
                    s.diffX = diffX;
                    s.diffY = diffY;
                }
                this.isMoving = diffX !== 0 || diffY !== 0;
                this.draw();
            }
            if (this.isDragging) {
                this.dragProperty.end = Math.max(this.dragProperty.start, xIndex);
                this.draw();
            }
        }

        if (this.scrollId !== null) {
            if (0 <= x && x <= this.container.clientWidth && 0 <= y && y <= this.container.clientHeight) {
                clearTimeout(this.scrollId);
                this.scrollId = null;
            }
            return;
        }

        //どうにかしたい
        if ((this.mouseDown || this.isDragging) && x >= this.container.clientWidth) {
            let x = e.clientX - can_rect.left;
            const scroll = () => {
                this.container.scrollLeft += 10;
                x += 10;
                const xIndex = Math.floor(x / this.cellWidth);
                move(xIndex - this.lastClicked.x, diffY, xIndex);
                this.scrollId = setTimeout(scroll, 30);
            }
            scroll();
        }
        else if ((this.mouseDown || this.isDragging) && x <= 0) {
            let x = e.clientX - can_rect.left;
            const scroll = () => {
                this.container.scrollLeft -= 10;
                x -= 10;
                const xIndex = Math.floor(x / this.cellWidth);
                move(xIndex - this.lastClicked.x, diffY, xIndex);
                this.scrollId = setTimeout(scroll, 30);
            }
            scroll();
        }

        if ((this.mouseDown || this.isDragging) && y >= this.container.clientHeight) {
            let y = e.clientY - can_rect.top;
            const scroll = () => {
                this.container.scrollTop += 10;
                y += 10;
                const yIndex = Math.floor(y / this.cellHeight);
                move(diffX, yIndex - this.lastClicked.y, yIndex);
                this.scrollId = setTimeout(scroll, 30);
            }
            scroll();
        }
        else if ((this.mouseDown || this.isDragging) && y <= 0) {
            let y = e.clientY - can_rect.top;
            const scroll = () => {
                this.container.scrollTop -= 10;
                y -= 10;
                const yIndex = Math.floor(y / this.cellHeight);
                move(diffX, yIndex - this.lastClicked.y, yIndex);
                this.scrollId = setTimeout(scroll, 30);
            }
            scroll();
        }

        move(diffX, diffY, xIndex);
    }
}

class ScoreStack {

    constructor() {
        /**
         * stackは変更の差分を取っておく配列
         * 先頭はnull
         * 中身は、一度の操作(複数削除もありうる)における追加されたノートの配列、削除されたノートの配列、追加され(削除され?)始めたindexの配列
         * (ex:{
         *      index:[2, 1],
         *      removed:[
         *          [{start: 10, end: 14, lyric: "あ", pitch: 2}],
         *          [{start: 6, end: 9, lyric: "あ", pitch: 1}]
         *      ],
         *      added:[
         *          [],
         *          []
         *      ]
         * }
         */
        this.stack = [null];
        this.top = 0;
    }
    push(index, removed, added) {
        this.stack.splice(this.stackTop + 1, this.stack.length - this.stackTop + 1);
        this.stack.push({
            index: index,
            removed: removed,
            added: added,
        });
        this.top = this.stack.length - 1;
    }

    pop() {
        return this.stack[this.top];
    }

    incTop() {
        const before = this.top;
        this.top = Math.min(this.top + 1, this.stack.length - 1);
        return before != this.top;
    }

    decTop() {
        const before = this.top;
        this.top = Math.max(this.top - 1, 0);
        return before != this.top;
    }

    canRedo() {
        return this.top + 1 < this.stack.length;
    }
}