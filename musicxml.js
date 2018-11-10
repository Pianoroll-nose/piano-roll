class MusicXML {
    constructor(basePitch, verticalNum) {
        this.basePitch = basePitch.match(/[A-G]?/)[0];
        this.baseOctave = parseInt(basePitch.match(/\d/)[0], 10);
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
        let measure = dom.createElement('measure');
        measure.setAttribute('number', 1);
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
        part.appendChild(measure);
        measure.appendChild(attributes);

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

        for(let s of score) {
            //restの挿入
            if(s.start - currentTime > 0) {
                let tmp = {
                    start: currentTime,
                    end: s.start - 1,
                };

                const startMeasure = Math.floor(currentTime / noteNum) + 1;
                const endMeasure = Math.floor((s.start-1) / noteNum) + 1;
                for(let i = startMeasure; i <= endMeasure; i++) {
                    const note = dom.createElement('note');
                    const rest = dom.createElement('rest');
                    const duration = dom.createElement('duration');
                    duration.textContent = Math.min(tmp.end, i*noteNum-1) - tmp.start + 1;

                    tmp.start = tmp.end > i*noteNum-1 ? i*noteNum : tmp.start;

                    note.appendChild(rest);
                    note.appendChild(duration);

                    //measureが変わる時
                    if(i > currentMeasure) {
                        measure = dom.createElement('measure');
                        measure.setAttribute('number', ''+i);
                        part.appendChild(measure);
                        currentMeasure = i;
                    }
                    measure.appendChild(note);
                }
            }
            
            //noteの挿入
            const startMeasure = Math.floor(s.start / noteNum) + 1;
            const endMeasure = Math.floor(s.end / noteNum) + 1;
            const pitch_strings = this.numToPitch(s.pitch);
            let start = s.start;
            for(let i = startMeasure; i <= endMeasure; i++) {
                const note = dom.createElement('note');
                const pitch = dom.createElement('pitch');
                const step = dom.createElement('step');
                step.textContent = pitch_strings[0];
                const octave = dom.createElement('octave');
                octave.textContent = pitch_strings[1];
                pitch.appendChild(step);
                if(pitch_strings[2] !== null) {
                    const alter = dom.createElement('alter');
                    alter.textContent = 1;
                    pitch.appendChild(alter);
                }
                pitch.appendChild(octave);

                const duration = dom.createElement('duration');
                duration.textContent = Math.min(s.end, i*noteNum-1) - start + 1;
                start = s.end > i*noteNum-1 ? i*noteNum : s.end;
                note.appendChild(pitch);
                note.appendChild(duration);

                const lyric = dom.createElement('lyric');
                const syllabic = dom.createElement('syllabic');
                const text = dom.createElement('text');

                //tieの時
                if(startMeasure !== endMeasure) {
                    const notations = dom.createElement('notations');
                    if(i !== endMeasure){
                        const tie = dom.createElement('tie');
                        tie.setAttribute('type', 'start');
                        const tied = dom.createElement('tied');
                        tied.setAttribute('type', 'start');
                        note.appendChild(tie);
                        notations.appendChild(tied);
                    }
                    if(i !== startMeasure) {
                        const tie = dom.createElement('tie');
                        tie.setAttribute('type', 'stop');
                        const tied = dom.createElement('tied');
                        tied.setAttribute('type', 'stop');
                        note.appendChild(tie);
                        notations.appendChild(tied);
                    }
                    note.appendChild(notations);
                }

                //どうにかできそう
                if(startMeasure === endMeasure) {
                    syllabic.textContent = 'single';
                    text.textContent = s.lyric;
                }
                else if(i === startMeasure) {
                    syllabic.textContent = 'begin';    
                    text.textContent = s.lyric;                
                }
                else if(i === endMeasure) {
                    syllabic.textContent = 'end';
                }
                else {
                    syllabic.textContent = 'middle';
                }
                
                lyric.appendChild(syllabic);
                lyric.appendChild(text);

                note.appendChild(lyric);

                if(i > currentMeasure){
                    measure = dom.createElement('measure');
                    measure.setAttribute('number', i+'');
                    part.appendChild(measure);
                    currentMeasure = i;
                } 
                measure.appendChild(note);
            }
            currentTime = s.end + 1;
        }

        //小節の最後までrestを詰める
        if(currentTime < currentMeasure*noteNum) {
            const note = dom.createElement('note');
            const rest = dom.createElement('rest');
            const duration = dom.createElement('duration');
            duration.textContent = currentMeasure*noteNum - currentTime;

            note.appendChild(rest);
            note.appendChild(duration);
            measure.appendChild(note);
        }

        const serializer = new XMLSerializer();
        const serialized = serializer.serializeToString(dom);
        const formatted = this.formatXML(serialized);
        return head + formatted;
    }

    formatXML(string) {
        //</..>、<></..>にはマッチして、<><>、<../><>にはマッチしないようにしてインデント後の一行を取り出す（もっと綺麗になりそう）
        const close = /(<\/.*?>)/;
        const openAndClose = /(<[^/>]*?>[^<]*?<\/.*?>)/;
        const none = /<.*?\/>/;
        const open = /<.*?>/;
        const split = /(<\/.*?>)|(<[^/>]*?>[^<]*?<\/.*?>)|(<.*?>)/;

        const splitted = string.split(split).filter(s => s);

        let depth = 0;
        return splitted.map((s) => {
            console.log(s, depth);
            if(s.match(openAndClose))   return '\t'.repeat(depth)+s;
            if(s.match(none))           return '\t'.repeat(depth)+s;
            if(s.match(close))          return '\t'.repeat(--depth)+s;
            if(s.match(open))           return '\t'.repeat(depth++)+s;
        }).join('\n');

    }

    numToPitch(num) {
        const pitchList = ['C', 'C+', 'D', 'D+', 'E', 'F', 'F+', 'G', 'G+', 'A', 'A+', 'B'];
        const pitch = pitchList[(this.verticalNum - num - 1) % 12];
        const octave = this.baseOctave + Math.floor((this.verticalNum - num - 1) / 12);
        const alter = pitch.match(/\+/) || [null];

        return [pitch[0], octave, alter[0]]
    }

    pitchToNum(p, acc, alter) {
        const pitchList = ['C', 'C+', 'D', 'D+', 'E', 'F', 'F+', 'G', 'G+', 'A', 'A+', 'B'];
        const sharpOrFlat = {'sharp': 1, 'flat': -1};
        const pitch = p.match(/[A-G]?/)[0];
        const octave = p.match(/\d/)[0];

        //pitchOffsetの計算が怪しい
        const pitchOffset = (pitchList.indexOf(pitch) - pitchList.indexOf(this.basePitch - 1) + 12) % 12;
        const octaveOffset = (octave - this.baseOctave) * 12;
        const accidental = (sharpOrFlat[acc] || 0) + alter;

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
        const partID = dom.querySelector('score-part').getAttribute('id');
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
                    const alter = n.querySelector('alter');
                    note.pitch = this.pitchToNum(
                        step.textContent + octave.textContent,
                        accidental !== null ? accidental.textContent : null,
                        alter !== null ? parseInt(alter.textContent, 10) : 0
                    );
                }

                if(n.querySelector('lyric') !== null) {
                    note.lyric = n.querySelector('lyric text').textContent;
                }

                if(n.querySelector('rest') === null) {
                    if(n.querySelector('tie') !== null) {
                        const ties = n.querySelectorAll('tie');
                        const tie_type = Array.prototype.map.call(ties, (t) => {
                            return t.getAttribute('type');
                        });
                        const isStart = tie_type.includes('start');
                        const isStop = tie_type.includes('stop');
                        if(isStart && !isStop) {
                            tmp = note;
                        }
                        else if(!isStart && isStop) {
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