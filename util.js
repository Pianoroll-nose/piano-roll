class Util {
    constructor(basePitch, verticalNum) {
        this.musicXML = new MusicXML(basePitch, verticalNum);
    }

    downloadScore(score, notesPerMeasure, beats) {
        const xml = this.musicXML.create(score, notesPerMeasure, beats);

        const url = document.createElement("a");
        url.download = document.getElementById('scoreName').value || 'score';
        url.href = URL.createObjectURL(new Blob([xml], {'type': 'application/xml'}));
        url.click();
        setTimeout(() => {
            URL.revokeObjectURL(url.href);
        }, 0);

        /*
        const url = document.createElement("a");
        url.download = document.getElementById('scoreName').value || 'score';
        url.href = URL.createObjectURL(new Blob([JSON.stringify(score)], {'type': 'application/json'}));
        url.click();
        setTimeout(() => {
            URL.revokeObjectURL(url.href);
        }, 0);
        */
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
                input.accept = '.xml, application/xml';
                input.onchange = (e) => {resolve(e.target.files[0]);}
                input.click();
            });
        };

        const readFile = (file) => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsText(file);
                reader.onload = () => {
                    try{
                        resolve(this.musicXML.read(reader.result));
                    }catch(e){
                        reject(e);
                    }
                }
            });
        };

        return (async () => {
            const file = await showDialog();
            const score = await readFile(file);
            return score;
        })();
    }
}