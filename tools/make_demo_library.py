#!/usr/bin/env python3
"""Generate a small SYNTHETIC library (schema 1) for tests, CI and demos.

Everything here is made up: generated tones and drawn notation. It contains none of the
real teaching material, so the output may be used in tests, fixtures and screenshots.

    python3 -I tools/make_demo_library.py OUT_DIR [--zip OUT.zip] [--format wav|mp3]

Needs Pillow for the notation images. mp3 needs ffmpeg; the default is wav (stdlib only).
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import struct
import subprocess
import sys
import wave
import zipfile
from pathlib import Path

SR = 22050
NOTE = {n: i for i, n in enumerate(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])}


def freq(name: str) -> float:
    pitch, octave = name[:-1], int(name[-1])
    midi = 12 * (octave + 1) + NOTE[pitch]
    return 440.0 * 2 ** ((midi - 69) / 12)


def render(chords: list[list[str]], beat: float, melody: bool) -> list[float]:
    """Very small additive synth: each chord one beat; with melody=True a running figure on top."""
    out: list[float] = []
    for chord in chords:
        n = int(beat * SR)
        fs = [freq(c) for c in chord]
        top = fs[-1]
        for i in range(n):
            t = i / SR
            env = min(1.0, t * 40) * math.exp(-2.2 * t / beat)
            s = sum(math.sin(2 * math.pi * f * t) + 0.3 * math.sin(4 * math.pi * f * t) for f in fs[:-1]) / (len(fs) + 1)
            if melody:
                # four-note diminution of the top voice: upper neighbour, passing tones
                step = int(4 * i / n)
                ratio = [1.0, 2 ** (2 / 12), 1.0, 2 ** (-1 / 12)][step]
                lt = (i % (n // 4)) / SR
                s += 0.5 * math.sin(2 * math.pi * top * ratio * t) * min(1.0, lt * 60) * math.exp(-5 * lt)
            else:
                s += 0.5 * math.sin(2 * math.pi * top * t)
            out.append(0.6 * env * s)
    return out


def write_audio(path: Path, samples: list[float], fmt: str) -> Path:
    wav = path.with_suffix('.wav')
    with wave.open(str(wav), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 32000)) for s in samples))
    if fmt == 'mp3':
        mp3 = path.with_suffix('.mp3')
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(wav), '-b:a', '96k', str(mp3)], check=True)
        wav.unlink()
        return mp3
    return wav


def draw_notation(path: Path, title: str, notes: int, with_numerals: list[str] | None = None):
    from PIL import Image, ImageDraw  # noqa: PLC0415

    w, h = 1400, 360
    img = Image.new('RGB', (w, h), 'white')
    d = ImageDraw.Draw(img)
    for staff, top in enumerate((70, 200)):
        for i in range(5):
            y = top + i * 14
            d.line([(40, y), (w - 40, y)], fill='black', width=2)
        for k in range(notes):
            x = 120 + k * (w - 200) // max(1, notes)
            y = top + 56 - ((k * 3 + staff * 5) % 9) * 7
            d.ellipse([x - 9, y - 7, x + 9, y + 7], fill='black')
            d.line([(x + 8, y), (x + 8, y - 45)], fill='black', width=2)
    d.text((40, 20), f'DEMO - {title}', fill='black')
    if with_numerals:
        for k, num in enumerate(with_numerals):
            d.text((120 + k * (w - 200) // len(with_numerals), 300), num, fill='black')
    img.save(path.with_suffix('.webp'), 'WEBP', quality=80)


CATEGORIES = [
    {'id': '90.1', 'title': 'Demo-Kadenzen', 'dir': '90.1_demo_kadenzen', 'difficulty_default': 1},
    {'id': '90.2', 'title': 'Demo-Sequenzen', 'dir': '90.2_demo_sequenzen', 'difficulty_default': 3},
]

PROG_A = [['C3', 'E3', 'G3', 'C4'], ['F2', 'F3', 'A3', 'C4'], ['G2', 'D3', 'G3', 'B3'], ['C3', 'E3', 'G3', 'C4']]
PROG_B = [['A2', 'E3', 'A3', 'C4'], ['D3', 'F3', 'A3', 'D4'], ['G2', 'D3', 'G3', 'B3'], ['C3', 'G3', 'C4', 'E4'],
          ['F2', 'C3', 'F3', 'A3'], ['B2', 'D3', 'F3', 'B3'], ['E3', 'G#3', 'B3', 'E4'], ['A2', 'E3', 'A3', 'C4']]


def musicxml(title: str, prog: list[list[str]], fifths: int, mode: str, diminution: bool) -> str:
    """A small two-staff MusicXML score (4/4, one chord per bar; diminution = running eighths on top)."""
    def note(pitch: str, dur: int, typ: str, chord=False, staff=1, voice=1) -> str:
        step, octave = pitch[0], pitch[-1]
        alter = '<alter>1</alter>' if '#' in pitch else ''
        return (f'<note>{"<chord/>" if chord else ""}<pitch><step>{step}</step>{alter}<octave>{octave}</octave></pitch>'
                f'<duration>{dur}</duration><voice>{voice}</voice><type>{typ}</type><staff>{staff}</staff></note>')
    bars = []
    for i, chord in enumerate(prog):
        attrs = ''
        if i == 0:
            attrs = (f'<attributes><divisions>2</divisions><key><fifths>{fifths}</fifths><mode>{mode}</mode></key>'
                     '<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>'
                     '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
                     '<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>'
                     '<per-minute>72</per-minute></metronome></direction-type><sound tempo="72"/></direction>')
        top = chord[-1]
        upper = ''
        if diminution:
            letters = 'CDEFGAB'
            idx, octv = letters.index(top[0]), int(top[-1])
            for k, d in enumerate([0, 1, 0, -1, 0, 2, 1, 0]):
                j = idx + d
                p = letters[j % 7] + ('#' if '#' in top and d == 0 else '') + str(octv + j // 7)
                upper += note(p, 1, 'eighth')
        else:
            upper = note(top, 8, 'whole')
        inner = ''.join(note(p, 8, 'whole', chord=j > 0, staff=1, voice=1) for j, p in enumerate(chord[1:-1]))
        lower = note(chord[0], 8, 'whole', staff=2, voice=2)
        body = upper + '<backup><duration>8</duration></backup>' + inner.replace('<voice>1</voice>', '<voice>3</voice>') \
            + '<backup><duration>8</duration></backup>' + lower
        bars.append(f'<measure number="{i + 1}">{attrs}{body}</measure>')
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">'
            f'<work><work-title>{title}</work-title></work><identification><creator type="composer">Demo</creator></identification>'
            '<part-list><score-part id="P1"><part-name>Klavier</part-name></score-part></part-list>'
            f'<part id="P1">{"".join(bars)}</part></score-partwise>\n')


def model(out: Path, cat: dict, mid: str, slug: str, *, title: str, composer: str, key: str, kind='model',
          audio=(), notation=(), extras=(), difficulty=None, fmt='wav', scores=()) -> dict:
    d = out / cat['dir'] / f'{mid}_{slug}'
    (d / 'audio').mkdir(parents=True, exist_ok=True)
    (d / 'notation').mkdir(exist_ok=True)
    a_entries = []
    for name, role, tempo, label, prog, beat, melody in audio:
        f = write_audio(d / 'audio' / name, render(prog, beat, melody), fmt)
        e = {'file': f'audio/{f.name}', 'role': role, 'tempo': tempo, 'key': key,
             'duration_s': round(len(prog) * beat, 1), 'src': f'{name} (generated)'}
        if label:
            e['label'] = label
        a_entries.append(e)
    n_entries = []
    for name, role, notes, numerals in notation:
        draw_notation(d / 'notation' / name, f'{title} ({role})', notes, numerals)
        n_entries.append({'file': f'notation/{name}.webp', 'role': role, 'src': f'{name} (generated)'})
    s_entries = []
    if scores:
        (d / 'score').mkdir(exist_ok=True)
        for name, role, prog, fifths, mode, dim in scores:
            (d / 'score' / f'{name}.musicxml').write_text(musicxml(title, prog, fifths, mode, dim), encoding='utf-8')
            e = {'file': f'score/{name}.musicxml', 'role': role}
            if role == 'task':
                e['start_measures'] = 1
            s_entries.append(e)
    x_entries = []
    if extras:
        (d / 'extras').mkdir(exist_ok=True)
        for name in extras:
            (d / 'extras' / name).write_text('synthetic placeholder source file\n')
            x_entries.append({'file': f'extras/{name}', 'kind': name.rsplit('.', 1)[-1]})
    has_task = any(e['role'] == 'task' for e in a_entries) or any(e['role'] == 'task' for e in s_entries)
    has_orig = any(e['role'] == 'original' for e in a_entries)
    has_skel = any(e['role'] == 'skeleton' for e in a_entries)
    status = ('complete' if has_task else 'original-only' if has_orig else 'skeleton-only' if has_skel
              else 'notation-only' if n_entries else 'sources-only')
    m = {
        'schema': 1, 'id': mid, 'category': cat['id'], 'kind': kind, 'title': title, 'composer': composer,
        'key': key, 'status': status, 'trainable': has_task or has_orig, 'difficulty': difficulty, 'tags': ['demo'],
        'audio': a_entries, 'notation': n_entries, 'extras': x_entries, 'source': f'demo/{mid}',
    }
    if s_entries:
        m['schema'] = 2
        m['scores'] = s_entries
    (d / 'model.json').write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {'id': mid, 'category': cat['id'], 'dir': str(d.relative_to(out)), 'title': title, 'composer': composer,
            'status': status, 'kind': kind, 'trainable': m['trainable']}


def build(out: Path, fmt: str):
    if out.exists() and any(out.iterdir()):
        sys.exit(f'refusing to write into non-empty {out}')
    out.mkdir(parents=True, exist_ok=True)
    c1, c2 = CATEGORIES
    full_notation = [('start', 'start', 3, None), ('degrees', 'degrees', 4, ['I', 'IV', 'V', 'I']),
                     ('degrees_keyed', 'degrees_keyed', 4, ['C: I', 'IV', 'V', 'I']), ('solution', 'solution', 16, None)]
    models = [
        model(out, c1, 'D900101', 'demo_kadenz_c', title='Kleine Kadenz', composer='Demo', key='C-Dur', fmt=fmt,
              audio=[('task', 'task', 'normal', '', PROG_A, 0.9, True),
                     ('task_slow', 'task', 'slow', '', PROG_A, 1.4, True),
                     ('skeleton', 'skeleton', 'normal', '', PROG_A, 0.9, False),
                     ('original', 'original', 'normal', '', PROG_A, 0.7, True)],
              notation=full_notation, extras=['Demo.sib']),
        model(out, c1, 'D900102', 'demo_kadenz_klavier', title='Kadenz mit Varianten', composer='Demo', key='a-Moll',
              fmt=fmt, difficulty=2,
              audio=[('task', 'task', 'normal', 'Klavier', PROG_B[:4], 0.8, True),
                     ('task_fast', 'task', 'fast', '', PROG_B[:4], 0.55, True),
                     ('sample', 'sample', 'normal', '', PROG_B[:4], 0.8, False)],
              notation=[('start', 'start', 3, None), ('solution', 'solution', 12, None)]),
        model(out, c1, 'D900100-01', 'vorubung', title='Vorübung Kadenz', composer='', key='C-Dur', kind='warmup',
              fmt=fmt, audio=[('task', 'task', 'normal', '', PROG_A[:2], 1.0, False)]),
        model(out, c2, 'D900201', 'demo_quintfall', title='Quintfall-Sequenz', composer='Demo', key='a-Moll', fmt=fmt,
              audio=[('task', 'task', 'normal', '', PROG_B, 0.7, True), ('skeleton', 'skeleton', 'normal', '', PROG_B, 0.7, False)],
              notation=[('task_sheet', 'task_sheet', 4, None), ('degrees', 'degrees', 8, ['i', 'iv', 'VII', 'III', 'VI', 'ii°', 'V', 'i']),
                        ('solution', 'solution', 16, None)]),
        model(out, c2, 'D900202', 'demo_original_only', title='Nur Original', composer='Demo', key='C-Dur', fmt=fmt,
              audio=[('original', 'original', 'normal', '', PROG_A, 0.6, True)]),
        model(out, c2, 'D900203', 'demo_skeleton_only', title='Nur Gerüst', composer='Demo', key='C-Dur', fmt=fmt,
              audio=[('skeleton', 'skeleton', 'normal', '', PROG_A, 0.9, False)]),
        model(out, c2, 'D900204', 'demo_stub', title='Ohne Audio', composer='', key='', fmt=fmt,
              notation=[('reference', 'reference', 6, None)]),
        model(out, c2, 'D900206', 'demo_aus_noten', title='Sequenz aus Noten', composer='Demo', key='a-Moll', fmt=fmt,
              scores=[('task', 'task', PROG_B, 0, 'minor', True), ('skeleton', 'skeleton', PROG_B, 0, 'minor', False)]),
        model(out, c2, 'D900205', 'demo_sources', title='Nur Quellen', composer='', key='', fmt=fmt, extras=['Quelle.sib']),
    ]
    cats = []
    for c in CATEGORIES:
        ms = [m for m in models if m['category'] == c['id']]
        cats.append({**c, 'models': len(ms), 'trainable': sum(m['trainable'] for m in ms)})
    (out / 'library.json').write_text(json.dumps({'schema': 2, 'generated_from': 'tools/make_demo_library.py',
                                                  'categories': cats, 'models': models}, ensure_ascii=False, indent=2) + '\n')
    (out / 'README-DEMO.txt').write_text('Synthetic demo library generated by tools/make_demo_library.py. No real material.\n')
    return models


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('out', type=Path)
    ap.add_argument('--zip', type=Path, help='also write a zip with top-level folder "library/"')
    ap.add_argument('--format', choices=['wav', 'mp3'], default='wav')
    a = ap.parse_args()
    if a.format == 'mp3' and not shutil.which('ffmpeg'):
        sys.exit('--format mp3 needs ffmpeg')
    models = build(a.out, a.format)
    if a.zip:
        with zipfile.ZipFile(a.zip, 'w', zipfile.ZIP_DEFLATED) as z:
            for p in sorted(a.out.rglob('*')):
                if p.is_file():
                    z.write(p, Path('library') / p.relative_to(a.out))
    print(f'{len(models)} demo models in {a.out}' + (f', zip {a.zip}' if a.zip else ''))


if __name__ == '__main__':
    main()
