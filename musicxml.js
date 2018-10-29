class MusicXML {
    constructor(basePitch, verticalNum) {
        this.basePitch = basePitch.match(/[A-G]?/)[0];
        this.baseOctave = basePitch.match(/\d/)[0];
        this.verticalNum = verticalNum;
    }

    create(score, notesPerMeasure, beats) {
        const noteNum = notesPerMeasure * beats;    //xmlのmeasure1つ中のnoteの個数
        const head = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + 
                    '<!DOCTYPE score-partwise PUBLIC \n' + 
                    '\t"-//Recordare//DTD MusicXML 3.1 Partwise//EN"\n' + 
                    '\t"http://www.musicxml.org/dtds/partwise.dtd">\n';
        
        const dom = document.implementation.createDocument('', '', null);
        const score_partwise = dom.appendChild(dom.createElement('score-partwise'));
        score_partwise.setAttribute('version', '3.1');

        const part_list = dom.createElement('part-list');
        const score_part = dom.createElement('score-part');
        score_part.setAttribute('id', 'P1');
        const part_name = dom.createElement('part-name')
        part_name.textContent = 'Music';
        score_partwise.appendChild(part_list);
        part_list.appendChild(score_part);
        score_part.appendChild(part_name);

        const part = dom.createElement('part');
        part.setAttribute('id', 'P1');
        const _measure = dom.createElement('measure');
        _measure.setAttribute('number', 1);
        const attributes = dom.createElement('attributes');
        const divisions = dom.createElement('divisions');
        divisions.textContent = notesPerMeasure;
        const key = dom.createElement('key');
        const fifths = dom.createElement('fifths');
        fifths.textContent = 0;
        const time = dom.createElement('time');
        const _beats = dom.createElement('beats');
        _beats.textContent = beats;     //よくわからない
        const beat_type = dom.createElement('beat-type');
        beat_type.textContent = beats;  //よくわからない
        const clef = dom.createElement('clef');
        const sign = dom.createElement('sign');
        sign.textContent = 'G';
        const line = dom.createElement('line');
        line.textContent = '2';

        score_partwise.appendChild(part);
        part.appendChild(_measure);
        _measure.appendChild(attributes);

        attributes.appendChild(divisions);
        attributes.appendChild(key);
        key.appendChild(fifths);
        attributes.appendChild(time);
        time.appendChild(_beats);
        time.appendChild(beat_type);
        attributes.appendChild(clef);
        clef.appendChild(sign);
        clef.appendChild(line);
        
        let currentTime = 0;
        let currentMeasure = 1;
        let beforeTime = 0;
        for(let s of score) {
            if(currentTime > currentMeasure*noteNum){
                currentMeasure++;
                const measure = dom.createElement('measure');
                measure.setAttribute('number', currentMeasure);
                part.appendChild(measure);
            }
            
            const note = dom.createElement('note');
            if(s.start - beforeTime > 0) {
                const note = dom.createElement('note');
                const rest = dom.createElement('rest');
                const duration = dom.createElement('duration');
                duration.textContent = s.start - beforeTime;
            }
        }

        const serializer = new XMLSerializer();
        const serialized = serializer.serializeToString(dom);
        return head + serialized;

    }

    getNoteType(duration, notesPerMeasure) {

    }

    addNote(note, isThai){

    }

    pitchToNum(p, acc) {
        const pitchList = ['C', 'C+', 'D', 'D+', 'E', 'F', 'F+', 'G', 'G+', 'A', 'A+', 'B'];
        const sharpOrFlat = {'sharp': 1, 'flat': -1};
        const pitch = p.match(/[A-G]?/)[0];
        const octave = p.match(/\d/)[0];

        const pitchOffset = (pitchList.indexOf(pitch) - pitchList.indexOf(this.basePitch) + 12) % 12;
        const octaveOffset = (octave - this.baseOctave) * 12;
        const accidental = sharpOrFlat[acc] || 0;

        //scoreの方は上からpitchが上からなので変換
        return this.verticalNum - (pitchOffset + octaveOffset + accidental);
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
        let tmp = {};
        measures.forEach((m) => {
            m.querySelectorAll('note').forEach((n) => {
                let note = {lyric: "あ"};
                if(n.querySelector('duration') !== null) {
                    const duration = parseInt(n.querySelector('duration').textContent, 10);
                    note.start = xmlDivToMyDiv(currentTime);
                    currentTime += duration;
                    note.end = xmlDivToMyDiv(currentTime) - 1;  //indexの関係
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

                if(n.querySelector('rest') === null) {
                    if(n.querySelector('tie') !== null) {
                        const tie = n.querySelector('tie');
                        if(tie.getAttribute('type') === 'start') {
                            tmp = note;
                        }
                        else {
                            tmp.end = note.end;
                            score.push(tmp);
                            tmp = {};
                        }
                    }
                    else    score.push(note);
                }
            });
        });

        return score;
    }
}