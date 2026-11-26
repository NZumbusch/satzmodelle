#!/usr/bin/env python3
"""Validate a library folder against docs/library-format.md (schema 1 and 2). Read-only.

    python3 -I tools/validate_library.py LIBRARY_DIR

Exit code 0 = no errors (warnings are printed but do not fail).
Prints only ids, paths and field names, never content.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

SCHEMA = 2  # newest supported; schema 1 manifests stay valid
KINDS = {'model', 'warmup', 'overview'}
STATUS = {'complete', 'original-only', 'skeleton-only', 'notation-only', 'sources-only'}
AUDIO_ROLES = {'task', 'skeleton', 'original', 'sample', 'other'}
NOTATION_ROLES = {'start', 'task_sheet', 'degrees', 'degrees_keyed', 'solution', 'reference'}
SCORE_ROLES = {'task', 'skeleton', 'solution', 'reference'}
TEMPI = {'slow', 'normal', 'fast'}


def validate(root: Path) -> tuple[list[str], list[str], int]:
    errors: list[str] = []
    warnings: list[str] = []
    ids: dict[str, Path] = {}
    manifests = sorted(root.rglob('model.json'))
    cats: set[str] = set()
    lj = root / 'library.json'
    if lj.exists():
        try:
            idx = json.loads(lj.read_text(encoding='utf-8'))
            cats = {c['id'] for c in idx.get('categories', [])}
        except (ValueError, KeyError, TypeError) as e:
            errors.append(f'library.json: {e}')
    else:
        warnings.append('library.json missing (optional; categories get no titles)')
    for mf in manifests:
        rel = mf.parent.relative_to(root)
        err = lambda msg: errors.append(f'{rel}: {msg}')  # noqa: E731
        try:
            m = json.loads(mf.read_text(encoding='utf-8'))
        except ValueError as e:
            err(f'invalid JSON ({e})')
            continue
        if not isinstance(m, dict):
            err('not an object')
            continue
        if m.get('schema') not in range(1, SCHEMA + 1):
            err(f'schema {m.get("schema")!r} not in 1..{SCHEMA}')
        if m.get('scores') and m.get('schema') != 2:
            err('scores need schema 2')
        mid = m.get('id')
        if not isinstance(mid, str) or not mid:
            err('missing id')
        elif mid in ids:
            err(f'duplicate id {mid} (also {ids[mid]})')
        else:
            ids[mid] = rel
        for field in ('category', 'title'):
            if not isinstance(m.get(field), str):
                err(f'{field} missing')
        if cats and m.get('category') not in cats:
            warnings.append(f'{rel}: category {m.get("category")!r} not in library.json')
        if m.get('kind') not in KINDS:
            err(f'kind {m.get("kind")!r}')
        if m.get('status') not in STATUS:
            err(f'status {m.get("status")!r}')
        if not isinstance(m.get('trainable'), bool):
            err('trainable must be true/false')
        d = m.get('difficulty')
        if d is not None and not (isinstance(d, int) and 1 <= d <= 5):
            err(f'difficulty {d!r} (1-5 or null)')
        for listname, roles in (('audio', AUDIO_ROLES), ('notation', NOTATION_ROLES), ('scores', SCORE_ROLES)):
            items = m.get(listname, [])
            if not isinstance(items, list):
                err(f'{listname} must be a list')
                continue
            for e in items:
                if not isinstance(e, dict) or not isinstance(e.get('file'), str):
                    err(f'{listname}: entry without file')
                    continue
                if e.get('role') not in roles:
                    err(f'{listname} {e["file"]}: role {e.get("role")!r}')
                if listname == 'audio' and e.get('tempo', 'normal') not in TEMPI:
                    err(f'audio {e["file"]}: tempo {e.get("tempo")!r}')
                if '..' in Path(e['file']).parts or e['file'].startswith('/'):
                    err(f'{listname} {e["file"]}: path must stay inside the model folder')
                elif not (mf.parent / e['file']).is_file():
                    err(f'{listname} {e["file"]}: file missing')
        for e in m.get('extras', []) or []:
            if isinstance(e, dict) and isinstance(e.get('file'), str) and not (mf.parent / e['file']).is_file():
                warnings.append(f'{rel}: extra {e["file"]} missing')
        audio = m.get('audio', []) if isinstance(m.get('audio'), list) else []
        has = {e.get('role') for e in audio if isinstance(e, dict)}
        scores = m.get('scores', []) if isinstance(m.get('scores'), list) else []
        if any(isinstance(e, dict) and e.get('role') == 'task' for e in scores):
            has.add('task')
        if m.get('trainable') and not has & {'task', 'original'}:
            err('trainable but no task/original audio')
    return errors, warnings, len(manifests)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    root = Path(sys.argv[1])
    errors, warnings, n = validate(root)
    for w in warnings:
        print('warning:', w)
    for e in errors:
        print('error:', e)
    print(f'{n} manifests, {len(errors)} errors, {len(warnings)} warnings')
    sys.exit(1 if errors or n == 0 else 0)


if __name__ == '__main__':
    main()
