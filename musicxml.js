class MusicXML {
    constructor(basePitch, verticalNum) {
        this.basePitch = basePitch.match(/[A-G]?/);
        this.baseOctave = basePitch.match(/\d/);
        this.verticalNum = verticalNum;
    }

    create() {

    }

    pitchToNum(p, acc) {
        const pitchList = ['C', 'C+', 'D', 'D+', 'E', 'F', 'F+', 'G', 'G+', 'A', 'A+', 'B'];
        const sharpOrFlat = {'sharp': 1, 'flat': -1};
        const pitch = p.match(/[A-G]?/);
        const octave = p.match(/\d/);

        const pitchOffset = (pitchList.indexOf(pitch) - pitchList.indexOf(this.basePitch) + 12) % 12;
        const octaveOffset = (octave - this.baseOctave) * 12;
        const accidental = sharpOrFlat[acc] || 0;

        //scoreの方は上からpitchが0なのでverticalNum-1を足す
        return pitchOffset + octaveOffset + accidental + this.verticalNum - 1;
    }

    //http://roomba.hatenablog.com/entry/2016/02/03/150354 (2018/10/26)
    read(xml) {
        //xmlの読み込み
        const parser = new DOMParser();
        const dom = parser.parseFromString(xml, 'application/xml');
        if(dom.querySelector('parsererror') !== null) {
            throw new SyntaxError('ファイルの中身がXML形式ではありません');
        }
        if(dom.querySelector('score-partwise') === null) {
            throw new SyntaxError('MusicXML形式ではありません')
        }

        //xmlの中身の取得
        const partID = dom.querySelector('score-part').id;
        const part = dom.querySelector('part#'+partID);
        const measures = part.querySelectorAll('measure');
        const attribute = part.querySelector('attributes');
        const xmlDivToMyDiv = (duration) => duration*4/attribute.querySelector('divisions').textContent;  //4は現状での分解能

        //現状4拍子しか対応していないので
        if(attribute.querySelector('beat-type') === '4') {
            throw new Error('4拍子ではありません');
        }
        if(part.querySelector('chord') !== null) {
            throw new Error('和音が含まれています');
        }

        let currentTime = 0;
        let score = [];
        measures.forEach((m) => {
            m.querySelectorAll('note').forEach((n) => {
                let note = {lyric: "あ"};
                if(n.querySelector('duration') !== null) {
                    const duration = parseInt(n.querySelector('duration').textContent, 10);
                    note.start = xmlDivToMyDiv(currentTime);
                    currentTime += duration;
                    note.end = xmlDivToMyDiv(currentTime);
                }
                if(n.querySelector('pitch') !== null) {
                    const step = n.querySelector('pitch step');
                    const octave = n.querySelector('pitch octave');
                    const accidental = n.querySelector('accidental');
                    note.pitch = this.pitchToNum(
                        step.textContent + octave.textContent,
                        accidental !== null ? accidental.textContent : null
                    );
                }
                if(n.querySelector('lyric') !== null) {
                    note.lyric = n.querySelector('lyric text').textContent;
                }

                if(n.querySelector('rest') === null)    score.push(note);
            });
        });

        return score;
    }
}