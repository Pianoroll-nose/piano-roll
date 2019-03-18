
class Menu {
    constructor() {
        this.notesPerMeasure = 4;
        this.measureNum = 50;
        this.horizontalNum = this.measureNum * this.notesPerMeasure;
        this.verticalNum = 24;
        this.basePitch = 'C4';
        this.beats = 4;     //1小節に何拍あるか
        this.mSeconds = 0;
        this.bpm = 120;
        this.mode = 1;
        this.defaultSize = {
            'w': 5000,
            'h': 1000
        };
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContext();

        this.audioManager = new AudioManager(this.audioCtx);
        this.editor = new Editor(this.verticalNum, this.horizontalNum, this.measureNum, this.beats, this.mode);
        this.piano = new Piano(this.verticalNum, this.basePitch);
        this.util = new Util(this.basePitch, this.verticalNum);
        this.bar = new Bar(this.bpm, this.horizontalNum, this.beats, this.audioManager);
        this.sptk = new Sptk(this.audioManager);
        //this.world = new World(this.audioCtx);

        this.init();
    }

    init() {
        this.setWidth(this.defaultSize.w);
        this.setHeight(this.defaultSize.h);

        document.getElementsByName('mode').forEach((e) => {
            e.onchange = () => {
                this.mode = modes[e.value];
                this.editor.changeMode(this.mode);
            };
        });

        this.setClickEvent('undo', this.editor.undo.bind(this.editor));
        this.setClickEvent('redo', this.editor.redo.bind(this.editor));
        this.setClickEvent('play', () => {
            const element = document.getElementById('synthesis');
            element.className = 'synthesizing';

            this.sptk.synthesis(this.editor.getScore(), this.basePitch, this.verticalNum,
                this.bpm, this.beats, this.mSeconds, true).then(isPlay =>{
                    element.className = 'none';
                    if(isPlay) {
                        this.bar.play(this.mSeconds);
                        this.mSeconds = 0;    
                    }
                });

        });
        this.setClickEvent('backward', () => document.getElementById('editor-container').scrollLeft = 0);
        this.setClickEvent('stop', this.bar.stop.bind(this.bar));
        this.setClickEvent('forward', () => document.getElementById('editor-container').scrollLeft =
            document.getElementById('score').clientWidth);
        //this.setClickEvent('clear', this.editor.clear.bind(this.editor));
        this.setClickEvent('selectAll', this.editor.selectAll.bind(this.editor));
        this.setClickEvent('remove', this.editor.remove.bind(this.editor));
        this.setClickEvent('d-wav', () => this.showDownloadDialog('wav'));
        this.setClickEvent('d-score', () => this.showDownloadDialog('score'));
        this.setClickEvent('downloadWav', () => {
            const element = document.getElementById('synthesis');
            element.className = 'synthesizing';

            this.sptk.synthesis(this.editor.getScore(), this.basePitch, this.verticalNum,
                this.bpm, this.beats, this.mSeconds, false).then(isPlay => {
                    if(isPlay)
                        this.util.downloadWav(this.audioManager.getAudioData());
                });
            element.className = 'none';
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

        document.querySelectorAll('.parameters').forEach((e) => {
            e.onclick = () => this.showInputDialog(e);
        });

        //ToDo:もう少し綺麗に記述できそう
        document.querySelectorAll('.zoom').forEach((button, index) => {
            const id = button.id;
            const _default = this.defaultSize;

            const addOrSub = (id, value) => Math.ceil(
                (id.endsWith('up')) ? value + _default[id[0]] * 0.1 : value - _default[id[0]] * 0.1);
            const container = document.getElementById('canvas-container');
            if (id.startsWith('w')) {
                button.onclick = () => {
                    //this.setWidth(Math.max(2000, Math.min(6000, addOrSub(id, container.clientWidth - 20))));
                    this.setWidth(Math.max(_default.w * 0.1, Math.min(_default.w * 2, addOrSub(id, container.clientWidth-20))));
                }
            }
            else {
                button.onclick = () => {
                    //this.setHeight(Math.max(500, Math.min(3000, addOrSub(id, container.clientHeight))));
                    this.setHeight(Math.max(_default.h * 0.1, Math.min(_default.h * 2, addOrSub(id, container.clientHeight))));
                }
            }
        });

        this.setClickEvent('width_default', () => {
            this.setWidth(this.defaultSize.w);
        });

        this.setClickEvent('height_default', () => {
            this.setHeight(this.defaultSize.h);
        });

        document.getElementById('w-value-in').oninput = () => {
            const w = document.getElementById('w-value-in').value;
            this.setWidth(this.defaultSize.w * parseInt(w) / 100);
        }
    }

    setClickEvent(id, func) {
        document.getElementById(id).addEventListener('click', func);
    }

    setWidth(width) {
        const elements = document.querySelectorAll('canvas:not(#piano)');
        const container = document.getElementById('canvas-container');
        container.style.width = width + 20 + "px";
        elements.forEach((element, index) => {
            element.width = width;
        });
        const res = Math.floor(width / this.defaultSize.w * 100);
        document.getElementById('w-value-out').value = res + "%"
        document.getElementById('w-value-in').value = res;
        this.editor.resize();
        this.bar.resize();
    }

    setHeight(height) {
        const elements = document.querySelectorAll('canvas');
        const container = document.getElementById('canvas-container');
        container.style.height = height + "px";
        elements.forEach((element, index) => {
            element.height = height;
        });
        this.editor.resize();
        this.bar.resize();
        this.piano.resize();
    }

    showDownloadDialog(wavOrScore) {
        const w_s = document.getElementById(wavOrScore + '-container');
        document.getElementById((wavOrScore === 'wav' ? 'score' : 'wav') + '-container').className = 'none';
        const dialog = document.getElementById('download_dialog');
        const close = document.getElementById('d_close');

        w_s.className = 'download';
        dialog.className = 'download';

        close.onclick = () => {
            dialog.className = 'none';
            w_s.className = 'none';
        }
    }

    showInputDialog(e) {
        const className = e.firstElementChild.innerHTML.toLowerCase();
        const input_num = {
            'seconds': 3,
            'tempo': 1,
            'beat': 2
        };

        const tags = {
            'seconds': ['.', ':'],
            'tempo': [],
            'beat': ['/'],
        };


        const div = document.getElementById('input_parameter');
        div.className = className;
        document.querySelectorAll('.parameter,.parameter~span').forEach(e => e.parentNode.removeChild(e));

        for (let i = 0; i < input_num[className]; i++) {
            if (i > 0) {
                const tag = document.createElement('span');
                tag.innerHTML = tags[className][i - 1];
                div.insertBefore(tag, div.firstElementChild);
            }
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'parameter';
            div.insertBefore(input, div.firstElementChild);
        }

        const close = document.getElementById('p_close');
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


    updateBpm(value) {
        this.bpm = Math.min(400, Math.max(20, (parseFloat(value) || this.bpm)));
        this.bar.updateBpm(this.bpm);
        return this.bpm.toFixed(2);
    }

    updateSeconds(_min, _sec, _mSec) {
        const max = this.measureNum / this.bpm * 60 * 1000;
        const min = (parseInt(_min) || 0) + Math.floor(_sec / 60);
        const sec = _sec % 60;
        const mSec = parseInt(_mSec.substr(0, 4)) * 100 || 0;

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