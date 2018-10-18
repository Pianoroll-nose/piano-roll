function start(){
    let bContainer = document.getElementById("bar-container");
    let pContainer = document.getElementById("piano-container");
    let eContainer = document.getElementById("editor-container");
    //canvasの幅をdivの幅に揃える
    document.getElementById('piano').width = pContainer.clientWidth;

    //スクロールを合わせる
    pContainer.addEventListener('scroll', () => {
        eContainer.scrollTop = pContainer.scrollTop;
    });

    eContainer.addEventListener('scroll', () => {
        pContainer.scrollTop = eContainer.scrollTop;
    });

    bContainer.addEventListener('scroll', () => {
        eContainer.scrollLeft = bContainer.scrollLeft;
    });

    eContainer.addEventListener('scroll', () => {
        bContainer.scrollLeft = eContainer.scrollLeft;
    });

    menu = new Menu();
}


class Util {
    constructor() {
    }

    downloadScore(score) {
        const url = document.createElement("a");
        url.download = document.getElementById('scoreName').value || 'score';
        url.href = URL.createObjectURL(new Blob([JSON.stringify(score)], {'type': 'application/json'}));
        url.click();
    }

    //https://qiita.com/HirokiTanaka/items/56f80844f9a32020ee3b (10/13)
    //http://www.ys-labo.com/pc/2009/091223%20File.html (10/13)
    createWav(audioData) { 
        const buf = new ArrayBuffer(44 + audioData.length);
        const view = new DataView(buf);

        const writeString = (offset, string) => {
            for(let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }

        //ヘッダ情報の書き込み
        //44100Hz, 8bit
        writeString(0, 'RIFF'); //RIFFヘッダ
        view.setUint32(4, 32+audioData.length, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, 44100, true);
        view.setUint32(28, 44100, true);
        view.setUint16(32, 1, true);
        view.setUint16(34, 8, true);
        writeString(36, 'data');
        view.setUint32(40, audioData.length, true);
        
        for(let i = 0, offset = 44; i < audioData.length; i++, offset++) {
            view.setUint8(offset, audioData[i], true);
        }

        return buf;
    }

    downloadWav(audioData) {
        const wav = this.createWav(audioData);
        const url = document.createElement("a");
        url.download = document.getElementById('wavName').value || 'audio';
        url.href = URL.createObjectURL(new Blob([wav], {'type': 'audio/wav'}));
        url.click();
        setTimeout(() => {
            URL.revokeObjectURL(url.href);
        }, 0);
    }

    playAudio(audioData) {
        const wav = this.createWav(audioData);
        const audio = document.getElementById("audio");
        audio.src = URL.createObjectURL(new Blob([wav], {'type': 'audio/wav'}));
        audio.play();
        setTimeout(() => {
            URL.revokeObjectURL(audio.src);
        }, 0);
    }

    openScore() {
        const showDialog = () => {
            return new Promise((resolve, reject) => {
                const input = document.createElement("input");
                input.type = 'file';
                input.accept = '.json, application/json';
                input.onchange = (e) => {resolve(e.target.files[0]);}
                input.click();
            });
        };

        const readFile = (file) => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsText(file);
                reader.onload = () => {
                    resolve(JSON.parse(reader.result));
                }
            });
        };

        return (async () => {
            const file = await showDialog();
            const score = await readFile(file);

            if(!Array.isArray(score)){
                return new Promise((resolve, reject) => {
                    reject('this is not a score.');
                });
            }

            const property = ['start', 'end', 'lyric', 'pitch'];
            for(let i = 0; i < score.length; i++) {
                for(let p of property) {
                    const has = score[i].hasOwnProperty(p);
                    if(!has){
                        return new Promise((resolve, reject) => {
                            reject('this is not a score.');
                        });
                    }
                }
            }
            return score;
        })();
    }
}

//Menuバーのイベントから他のクラスに処理を促すクラス
class Menu {
    constructor() {
        this.notesPerMeasure = 4;
        this.measureNum = 30;
        this.horizontalNum = this.measureNum * this.notesPerMeasure;
        this.verticalNum = 24;
        this.beats = 4;     //何分の何拍子みたいなやつ

        this.button1 = document.getElementById("button1");
        this.button2 = document.getElementById("button2");
        this.button3 = document.getElementById("button3");

        this.editor = new Editor(this.verticalNum, this.horizontalNum, this.measureNum, this.beats);
        this.piano = new Piano(this.verticalNum);
        this.util = new Util();
        this.bar = new Bar(this.verticalNum);
        
        document.getElementById('undo').onclick = this.editor.undo.bind(this.editor);
        document.getElementById('redo').onclick = this.editor.redo.bind(this.editor);
        document.getElementById('play').onclick = () => {
            const audioData = [];
            for(var i = 0; i < 44100*2; i++){
                audioData.push(Math.floor(Math.sin(Math.PI*2*i/44100*440) * 128 + 128));
            }
            this.util.playAudio(audioData);
        }
        document.getElementById('clear').onclick = this.editor.clear.bind(this.editor);
        document.getElementById('downloadWav').onclick = () => {
            const audioData = [];
            for(var i = 0; i < 44100*2; i++){
                audioData.push(Math.floor(Math.sin(Math.PI*2*i/44100*440) * 128 + 128));
            }
            this.util.downloadWav(audioData);
        }
        document.getElementById('downloadScore').onclick = () => {
            this.util.downloadScore(this.editor.getScore());
        }
        document.getElementById('openScore').onclick = () => {
            this.util.openScore().then((score) => {
                this.editor.setScore(score);
            }).catch((e) => {
                alert(e);
            });
        }

        //ToDo:もう少し綺麗に記述できそう
        document.querySelectorAll('.zoom').forEach((button, index) => {
            const id = button.id;
            const addOrSub = (id, value) => (id.endsWith('up')) ? value+100 : value-100;
            if(id.startsWith('w')) {
                button.onclick = () => {
                    const elements = document.querySelectorAll('canvas:not(#piano)');
                    elements.forEach((element, index) => {
                        //2000px以上6000px以下
                        element.width = Math.max(2000, Math.min(6000, addOrSub(id, element.width)));
                    })
                    this.editor.resize();
                    this.bar.resize();    
                }
            }
            else {
                button.onclick = () => {
                    const elements = document.querySelectorAll('canvas:not(#bar)');
                    elements.forEach((element, index) => {
                        //500px以上3000px以下
                        element.height = Math.max(500, Math.min(3000, addOrSub(id, element.height)));
                    })
                    this.editor.resize();
                    this.piano.resize();    
                }
            }
        });
        this.button1.addEventListener("click", this.bar.barStart.bind(this.bar), false);
        this.button2.addEventListener("click", this.bar.barStop.bind(this.bar), false);
        this.button3.addEventListener("click", this.bar.barReset.bind(this.bar), false);
    }
}

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

    resize() {
        this.score.resize();
        this.backGround.resize();
    }

    undo() {
        this.score.undo();
    }
    
    redo() { 
        this.score.redo();
    }

    clear() {
        this.score.clear();
    }

    draw() {
        this.backGround.draw();
        this.score.draw();
    }

    getScore() {
        return this.score.score;
    }

    setScore(score) { 
        this.score.setScore(score);
    }
}

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
        input.onblur = function() {
            this.parentNode.removeChild(this);
        };
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
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            this.dragProperty.end = Math.max(this.dragProperty.start, Math.floor(x / this.cellWidth));
            this.draw();
        }
    }
}
