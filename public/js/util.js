class Util {
    constructor(basePitch, verticalNum) {
        this.musicXML = new MusicXML(basePitch, verticalNum);
    }

    static getSoundIndex() {
        return [
            "あ", "い", "いぇ", "う", "うぁ", "うぃ", "うぇ", "うぉ", "え", "お", "か", "が", "き", "きぇ", "きゃ",
            "きゅ", "きょ", "ぎ", "ぎぇ", "ぎゃ", "ぎゅ", "ぎょ", "く", "くぁ", "くぃ", "くぇ", "くぉ", "ぐ", "ぐぁ",
            "ぐぃ", "ぐぇ", "ぐぉ", "け", "げ", "こ", "ご", "さ", "ざ", "し", "しぇ", "しゃ", "しゅ", "しょ", "じ",
            "じぇ", "じゃ", "じゅ", "じょ", "す", "すぁ", "すぃ", "すぇ", "すぉ", "ず", "ずぁ", "ずぃ", "ずぇ", "ずぉ",
            "せ", "ぜ", "そ", "ぞ", "た", "だ", "ち", "ちぇ", "ちゃ", "ちゅ", "ちょ", "つ", "つぁ", "つぃ", "つぇ",
            "つぉ", "て", "てぃ", "てゅ", "で", "でぃ", "でゅ", "と", "とぅ", "ど", "どぅ", "な", "に", "にぇ", "にゃ",
            "にゅ", "にょ", "ぬ", "ぬぁ", "ぬぃ", "ぬぇ", "ぬぉ", "ね", "の", "は", "ば", "ぱ", "ひ", "ひぇ", "ひゃ",
            "ひゅ", "ひょ", "び", "びぇ", "びゃ", "びゅ", "びょ", "ぴ", "ぴぇ", "ぴゃ", "ぴゅ", "ぴょ", "ふ", "ふぁ",
            "ふぃ", "ふぇ", "ふぉ", "ぶ", "ぶぁ", "ぶぃ", "ぶぇ", "ぶぉ", "ぷ", "ぷぁ", "ぷぃ", "ぷぇ", "ぷぉ", "へ",
            "べ", "ぺ", "ほ", "ぼ", "ぽ", "ま", "み", "みぇ", "みゃ", "みゅ", "みょ", "む", "むぁ", "むぃ", "むぇ",
            "むぉ", "め", "も", "や", "ゆ", "よ", "ら", "り", "りぇ", "りゃ", "りゅ", "りょ", "る", "るぁ", "るぃ",
            "るぇ", "るぉ", "れ", "ろ", "わ", "を", "ん"];
    }
    
    static existsSound(lyric) {
        return this.getSoundIndex().includes(lyric);
    }

    static getPitchList(){ 
        return ['C', 'C+', 'D', 'D+', 'E', 'F', 'F+', 'G', 'G+', 'A', 'A+', 'B'];
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
    }

    createWav(audioData) {
        const buf = new ArrayBuffer(44 + audioData.length*2);
        const view = new DataView(buf);

        const writeString = (offset, string) => {
            for(let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }

        const fs = 16000;
        //ヘッダ情報の書き込み
        //(fs)Hz, 16bit
        writeString(0, 'RIFF');
        view.setUint32(4, 32 + audioData.length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, fs, true);
        view.setUint32(28, fs * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, audioData.length * 2, true);

        for (let i = 0, offset = 44; i < audioData.length; i++ , offset += 2) {
            view.setInt16(offset, Math.max(-32767, Math.min(32767, Math.floor(audioData[i] * 32767))), true);
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
                reader.onload = () => {
                    try{
                        resolve(this.musicXML.read(reader.result));
                    }catch(e){
                        reject(e);
                    }
                }
                reader.readAsText(file);
            });
        };

        return (async () => {
            const file = await showDialog();
            const score = await readFile(file);
            return score;
        })();
    }
}