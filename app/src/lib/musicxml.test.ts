// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { beatToSeconds, musicXmlText, parseMusicXml } from './musicxml';
import { keyFromFifths, parseKey, transposeKey } from './keys';

const XML = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <work><work-title>Test-Diminution</work-title></work>
  <identification><creator type="composer">Niemand</creator></identification>
  <part-list><score-part id="P1"><part-name>Klavier</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><key><fifths>-1</fifths><mode>minor</mode></key><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration></note>
      <note><chord/><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration><tie type="start"/></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>4</duration></note>
    </measure>
    <measure number="2">
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><tie type="stop"/></note>
      <note><grace/><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch></note>
      <note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>1</duration></note>
      <note><rest/><duration>2</duration></note>
    </measure>
  </part>
</score-partwise>`;

describe('musicxml', () => {
  it('parses notes, chords, backup, ties, grace, tempo, metadata', () => {
    const s = parseMusicXml(XML);
    expect(s.title).toBe('Test-Diminution');
    expect(s.composer).toBe('Niemand');
    expect(s.key).toBe('d-Moll');
    expect(s.tempo[0]).toEqual({ beat: 0, bpm: 120 });
    expect(s.measures).toEqual([{ number: '1', start: 0 }, { number: '2', start: 2 }]);
    expect(s.beats).toBe(4);
    expect(s.notes.map((n) => [n.start, n.dur, n.midi])).toEqual([
      [0, 2, 50], [0, 1, 62], [0, 1, 65], [1, 1.5, 69], [2.5, 0.5, 70],
    ]);
    expect(beatToSeconds(s, 4)).toBe(2);
  });
  it('reads compressed mxl', () => {
    const mxl = zipSync({
      'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>'),
      'score.xml': strToU8(XML),
    });
    expect(parseMusicXml(musicXmlText(mxl)).title).toBe('Test-Diminution');
  });
  it('rejects non-scores', () => {
    expect(() => parseMusicXml('<html/>')).toThrow();
  });
});

describe('keys', () => {
  it('parses and transposes German key names', () => {
    expect(parseKey('fis-Moll')).toEqual({ pc: 6, minor: true });
    expect(parseKey('B-Dur')).toEqual({ pc: 10, minor: false });
    expect(transposeKey('a-Moll', 3)).toBe('c-Moll');
    expect(transposeKey('C-Dur', -1)).toBe('H-Dur');
    expect(transposeKey('Es-Dur', 2)).toBe('F-Dur');
    expect(keyFromFifths(3, 'major')).toBe('A-Dur');
    expect(keyFromFifths(-2, 'minor')).toBe('g-Moll');
  });
});
