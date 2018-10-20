
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

    resize() {
        this.editor.resize();
        this.piano.resize();
        this.bar.resize();
    }
}