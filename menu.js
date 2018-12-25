
class Menu {
    constructor() {
        this.notesPerMeasure = 4;
        this.measureNum = 30;
        this.horizontalNum = this.measureNum * this.notesPerMeasure;
        this.verticalNum = 24;
        this.basePitch = 'C4';
        this.beats = 4;     //1小節に何拍あるか
        this.mSeconds = 0;
        this.bpm = 120;
        this.mode = 1;
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContext();

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
            const buf = this.world.synthesis(this.editor.getScore(), this.basePitch, this.verticalNum,
                this.bpm, this.beats);
            if (buf.length > 0) {
                const buffer = this.audioCtx.createBuffer(1, buf.length, 44100);
                buffer.copyToChannel(new Float32Array(buf), 0);
                const src = this.audioCtx.createBufferSource();
                src.buffer = buffer;
                src.connect(this.audioCtx.destination);

                this.bar.play(this.audioCtx, src, this.mSeconds);
                this.mSeconds = 0;
            }
        });
        this.setClickEvent('pause', this.bar.pause.bind(this.bar));
        this.setClickEvent('stop', this.bar.stop.bind(this.bar));
        this.setClickEvent('clear', this.editor.clear.bind(this.editor));
        this.setClickEvent('remove', this.editor.remove.bind(this.editor));
        this.setClickEvent('downloadWav', () => {
            this.util.downloadWav(this.world.synthesis(this.editor.getScore(), this.basePitch, this.verticalNum,
                this.bpm, this.beats));
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

        document.querySelectorAll('.parameters').forEach((e) => {
            e.onclick = () => this.showInputDialog(e);
        });

        //ToDo:もう少し綺麗に記述できそう
        document.querySelectorAll('.zoom').forEach((button, index) => {
            const id = button.id;
            const addOrSub = (id, value) => (id.endsWith('up')) ? value + 100 : value - 100;
            const container = document.getElementById('canvas-container');
            if (id.startsWith('w')) {
                button.onclick = () => {
                    const elements = document.querySelectorAll('canvas:not(#piano)');
                    container.style.width = Math.max(2000, Math.min(6000, addOrSub(id, container.clientWidth))) + "px";
                    elements.forEach((element, index) => {
                        //2000px以上6000px以下
                        element.width = Math.max(2000, Math.min(6000, addOrSub(id, element.width)));
                    });
                    this.editor.resize();
                    this.bar.resize();
                }
            }
            else {
                button.onclick = () => {
                    const elements = document.querySelectorAll('canvas');
                    container.style.height = Math.max(500, Math.min(3000, addOrSub(id, container.clientHeight))) + "px";
                    elements.forEach((element, index) => {
                        //500px以上3000px以下
                        element.height = Math.max(500, Math.min(3000, addOrSub(id, element.height)));
                    });
                    this.editor.resize();
                    this.bar.resize();
                    this.piano.resize();
                }
            }
        });
    }

    setFunction(syn, mgc) {
        this.world.setFunction(syn, mgc);
    }

    setClickEvent(id, func) {
        document.getElementById(id).onclick = func;
    }

    showInputDialog(e) {
        const className = e.firstElementChild.innerHTML.toLowerCase();
        const input_num = {
            'seconds': 3,
            'tempo': 1,
            'beat': 2
        };
        const tags = {
            'seconds': ['', '.', ':'],
            'tempo': [],
            'beat': ['', '/']
        }
        const div = document.getElementById('input_parameter');
        div.className = className;
        document.querySelectorAll('.parameter').forEach(e => e.parentNode.removeChild(e));

        for (let i = 0; i < input_num[className]; i++) {
/*            if(i > 0){
                const p = document.createElement('span');
                p.innerHTML = tags[className][i];
                p.className = 'symbol';
                div.insertBefore(p, div.firstElementChild);
            }
*/          const input = document.createElement('input');
            input.type = 'number';
            input.className = 'parameter';
            div.insertBefore(input, div.firstElementChild);
        }
        const close = document.getElementById('close');
        const set = document.getElementById('set');

        close.onclick = () => {
            div.className = 'none';
        }

        set.onclick = () => {
            const parameters = document.querySelectorAll('.parameter');
            const funcs = {
                'seconds': this.updateSeconds,
                'tempo': this.updateBpm,
                'beat': this.updateBeat
            };
            e.lastElementChild.innerHTML = funcs[className].bind(this)(...Array.prototype.map.call(parameters, p => p.value));
        }
    }

    insertElement(div, parameter) {
        const tags = {
            'seconds': [':', '.'],
            'tempo': [],
            'beat': ['.']
        }
        switch (parameter) {
            case 'seconds':
                for (let i = 0; i < input_num[className]; i++) {
                    const input = document.createElement('input');
                    input.type = 'number';
                    input.className = 'parameter';
                    div.insertBefore(input, div.firstElementChild);

                }
        }
    }

    updateBpm(value) {
        this.bpm = Math.min(400, Math.max(20, (parseFloat(value) || this.bpm)));
        this.bar.updateBpm(this.bpm);
        return this.bpm.toFixed(2);
    }

    updateSeconds(_min, _sec, _mSec) {
        const max = this.measureNum / this.bpm * 60 * 1000;
        const min = (parseInt(_min) || 0) + Math.floor(_sec / 60);
        const sec = _sec % 60;
        const mSec = parseInt(_mSec.substr(0, 4)) / 10 || 0;

        this.mSeconds = Math.min(max, Math.max(0, (parseFloat((min * 60 + sec) * 1000 + mSec) || this.mSeconds)));
        this.bar.updateSeconds(this.mSeconds);

        const disp_min = ('000' + (Math.floor(this.mSeconds / (1000 * 60)))).slice(-3);
        const disp_sec = ('00' + Math.floor(this.mSeconds / 1000) % 100 % 60).slice(-2);
        const disp_mSec = (this.mSeconds * 10 % 10000 + '0000').substr(0, 4);
        return disp_min + ':' + disp_sec + '.' + disp_mSec;
    }

    updateBeat(denom, numerator) {
    }

    resize() {
        this.editor.resize();
        this.piano.resize();
        this.bar.resize();
    }
}