
//Menuバーのイベントから他のクラスに処理を促すクラス
class Menu {
    constructor() {
        this.notesPerMeasure = 4;
        this.measureNum = 30;
        this.horizontalNum = this.measureNum * this.notesPerMeasure;
        this.verticalNum = 24;
        this.basePitch = 'C4';
        this.beats = 4;     //1小節に何拍あるか
        this.bpm = 120;
        this.mode = 1;

        this.editor = new Editor(this.verticalNum, this.horizontalNum, this.measureNum, this.beats, this.mode);
        this.piano = new Piano(this.verticalNum, this.basePitch);
        this.util = new Util(this.basePitch, this.verticalNum);
        this.bar = new Bar(this.bpm, this.horizontalNum, this.beats);

        document.getElementsByName('mode').forEach((e) => {
            e.onchange = () => {
                this.mode = modes[e.value];
                this.editor.changeMode(this.mode);
            };
        });

        document.getElementById('undo').onclick = this.editor.undo.bind(this.editor);
        document.getElementById('redo').onclick = this.editor.redo.bind(this.editor);
        document.getElementById('play').onclick = () => {
            const audioData = [];
            for (var i = 0; i < 44100 * 2; i++) {
                audioData.push(Math.floor(Math.sin(Math.PI * 2 * i / 44100 * 440) * 128 + 128));
            }
            this.util.playAudio(audioData);
            this.bar.play();
        }
        document.getElementById('pause').onclick = this.bar.pause.bind(this.bar);
        document.getElementById('stop').onclick = this.bar.stop.bind(this.bar);
        document.getElementById('clear').onclick = this.editor.clear.bind(this.editor);
        document.getElementById('remove').onclick = () => this.editor.remove(false);
        document.getElementById('downloadWav').onclick = () => {
            const audioData = [];
            for (var i = 0; i < 44100 * 2; i++) {
                audioData.push(Math.floor(Math.sin(Math.PI * 2 * i / 44100 * 440) * 128 + 128));
            }
            this.util.downloadWav(audioData);
        }
        document.getElementById('downloadScore').onclick = () => {
            this.util.downloadScore(this.editor.getScore(), this.notesPerMeasure, this.beats);
        }
        document.getElementById('openScore').onclick = () => {
            this.util.openScore().then((score) => {
                this.editor.setScore(score);
            }).catch((e) => {
                alert(e);
            });
        }
        document.getElementById('updateBpm').onclick = () => {
            const bpm = this.bpm = parseInt(document.getElementById('bpm').value, 10) || this.bpm;
            document.getElementById('bpm').value = bpm;
            this.bar.updateBpm(bpm);
        }

        //ToDo:もう少し綺麗に記述できそう
        document.querySelectorAll('.zoom').forEach((button, index) => {
            const id = button.id;
            const addOrSub = (id, value) => (id.endsWith('up')) ? value + 100 : value - 100;
            if (id.startsWith('w')) {
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
    }

    resize() {
        this.editor.resize();
        this.piano.resize();
        this.bar.resize();
    }
}