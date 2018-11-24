//打ち込み画面を管理するクラス
class Editor {
    constructor(verticalNum, horizontalNum, measureNum, beats, mode){
        this.verticalNum = verticalNum;
        this.horizontalNum = horizontalNum;
        this.measureNum = measureNum;
        this.beats = beats;

        this.score = new Score(this.horizontalNum, this.verticalNum);
        this.score.changeMode(mode);

        this.backGround = new BackGround(this.measureNum, this.verticalNum, this.beats);

        this.draw();
    }

    resize() {
        this.score.resize();
        this.backGround.resize();
    }

    changeMode(mode) {
        this.score.changeMode(mode);
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

    remove() {
        this.score.removeSelectedNotes();
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