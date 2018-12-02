
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
        this.world = new World();

        document.getElementsByName('mode').forEach((e) => {
            e.onchange = () => {
                this.mode = modes[e.value];
                this.editor.changeMode(this.mode);
            };
        });

        this.setClickEvent('undo', this.editor.undo.bind(this.editor));
        this.setClickEvent('redo', this.editor.redo.bind(this.editor));
        this.setClickEvent('play', () => {
            this.util.playAudio(this.world.synthesis(this.editor.getScore(), this.basePitch, this.verticalNum, this.bpm, this.beats));
            this.bar.play();
        });
        this.setClickEvent('pause', this.bar.pause.bind(this.bar));
        this.setClickEvent('stop', this.bar.stop.bind(this.bar));
        this.setClickEvent('clear', this.editor.clear.bind(this.editor));
        this.setClickEvent('remove', this.editor.remove.bind(this.editor));
        this.setClickEvent('downloadWav', () => {
            this.util.downloadWav(this.world.synthesis(this.editor.getScore(), this.basePitch, this.verticalNum, this.bpm, this.beats));
        });
        this.setClickEvent('downloadScore', () => {
            this.util.downloadScore(this.editor.getScore(), this.notesPerMeasure, this.beats);
        });
        this.setClickEvent('openScore', () => {
            this.util.openScore().then((score) => {
                this.editor.setScore(score);
            }).catch((e) => {
                alert(e);
            });
        });
        this.setClickEvent('updateBpm', () => {
            const bpm = this.bpm = Math.min(400, Math.max(20, (parseFloat(document.getElementById('bpm_in').value) || this.bpm)));
            document.getElementById('bpm').innerHTML = bpm.toFixed(2);
            this.bar.updateBpm(bpm);
        });
        /*
        document.getElementById('undo').onclick = this.editor.undo.bind(this.editor);
        document.getElementById('redo').onclick = this.editor.redo.bind(this.editor);
        document.getElementById('play').onclick = () => {
            this.util.playAudio(this.world.synthesis(this.editor.getScore(), this.basePitch, this.verticalNum));
            this.bar.play();
        }
        document.getElementById('pause').onclick = this.bar.pause.bind(this.bar);
        document.getElementById('stop').onclick = this.bar.stop.bind(this.bar);
        document.getElementById('clear').onclick = this.editor.clear.bind(this.editor);
        document.getElementById('remove').onclick = () => this.editor.remove(false);
        document.getElementById('downloadWav').onclick = () => {
            this.util.downloadWav(this.world.synthesis(this.editor.getScore(), this.basePitch, this.verticalNum));
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
            const bpm = this.bpm = Math.min(400, Math.max(20, (parseFloat(document.getElementById('bpm_in').value) || this.bpm)));
            document.getElementById('bpm').innerHTML = bpm.toFixed(2);
            this.bar.updateBpm(bpm);
        }
        */
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

    setFunction(func) {
        this.world.setFunction(func);
    }

    setClickEvent(id, func) {
        document.getElementById(id).onclick = func;
    }

    resize() {
        this.editor.resize();
        this.piano.resize();
        this.bar.resize();
    }
}