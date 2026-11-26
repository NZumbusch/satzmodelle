#!/usr/bin/env python3
"""
build_library.py - turn a raw archive of exercises into the compact, app-ready library.

    python3 -I tools/build_library.py  <archive.zip | extracted-dir>  <out-dir>  [--jobs N]

Real-world archives are messy (exported from notation programs, DAWs and phones, renamed by hand,
copied between Mac and Windows). The rules below are deliberately broad: German and English file
names, typos in role words, performer-named recordings, copy suffixes, scans, screenshots, paged
exports, broken model numbers. Anything the rules cannot place ends up in `_report.md`.

What it does
  * keeps only short training audio (drops full recordings > 2 MB, video/AIFF/FLV, Logic projects)
  * converts notation (tif / png / pdf) to small, trimmed WebP images
  * classifies every file into a ROLE (task, skeleton, original, start, solution, ...)
  * writes one `model.json` per model + a `library.json` index + `_report.md`
  * keeps editable sources (.sib, .docx, .pptx, ...) in `extras/` (the app ignores them)

The input is never modified. The result is the *library*: copyrighted teaching material that
must stay private (see .gitignore). Format is documented in docs/library-format.md.
"""
import argparse, hashlib, json, os, re, shutil, struct, subprocess, sys, tempfile, unicodedata, zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SCHEMA = 1
MB = 1024 * 1024
AUDIO_EXT = {".mp3", ".m4a"}
AV_DROP_EXT = {".mp4", ".aif", ".aiff", ".flv", ".wav", ".mov"}
IMG_EXT = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}
SRC_EXT = {".sib", ".docx", ".doc", ".pptx", ".pages", ".odt"}
BIG_AUDIO = 2 * MB          # classified audio above this is a full recording -> dropped
UNKNOWN_AUDIO_MAX = 1 * MB  # unclassified audio above this is dropped as well
BIG_PDF = 1 * MB            # PDFs above this are scanned editions -> dropped

# Default difficulty (1-5) per category id. A guess by category order; adjust freely here,
# or per model in model.json ("difficulty"). Unknown categories get 3.
CATEGORY_DIFFICULTY = {
    "01.1": 1, "01.2": 2, "02.1": 2, "02.2": 3, "02.3": 3, "02.4": 4,
    "03.1": 3, "03.2": 3, "03.3": 4, "04.1": 3, "04.2": 4, "04.3": 4, "04.4": 5,
}

# ---------------------------------------------------------------- helpers

def norm(s):
    s = unicodedata.normalize("NFC", s)
    return re.sub(r"[\s  ]+", " ", s).strip()

_UMLAUT = {"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss"}

def ascii_safe(s):
    s = "".join(_UMLAUT.get(c, c) for c in norm(s))
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9.+-]+", "_", s).strip("_")

def slug(s, n=48):
    return ascii_safe(s).lower().replace(".", "")[:n].strip("_-") or "x"

KEY_RE = re.compile(r"(?<![A-Za-z])([A-Ha-h](?:is|es|s)?)[- ]?(Dur|Moll)\b")

def find_key(s):
    m = KEY_RE.search(s)
    if not m:
        return None
    return f"{m.group(1)}-{m.group(2)}"

def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

_BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
_BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
_SR = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}

def mp3_duration(path):
    """Approximate duration in seconds (Xing frame count, else CBR estimate). None if unknown."""
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            head = f.read(65536)
        off = 0
        if head[:3] == b"ID3":
            off = 10 + ((head[6] & 0x7F) << 21 | (head[7] & 0x7F) << 14 | (head[8] & 0x7F) << 7 | (head[9] & 0x7F))
        i = head.find(b"\xff", off)
        while 0 <= i < len(head) - 4:
            b1, b2 = head[i + 1], head[i + 2]
            if (b1 & 0xE0) == 0xE0 and (b1 >> 3) & 3 != 1 and (b1 >> 1) & 3 == 1 and (b2 >> 4) != 15 and ((b2 >> 2) & 3) != 3:
                break
            i = head.find(b"\xff", i + 1)
        else:
            return None
        ver = (head[i + 1] >> 3) & 3          # 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
        bitrate = (_BR1 if ver == 3 else _BR2)[head[i + 2] >> 4] * 1000
        sr = _SR[ver][(head[i + 2] >> 2) & 3]
        mono = (head[i + 3] >> 6) == 3
        spf = 1152 if ver == 3 else 576
        side = (17 if mono else 32) if ver == 3 else (9 if mono else 17)
        x = i + 4 + side
        tag = head[x:x + 4]
        if tag in (b"Xing", b"Info") and head[x + 7] & 1:
            frames = struct.unpack(">I", head[x + 8:x + 12])[0]
            return round(frames * spf / sr, 1)
        if bitrate:
            return round((size - i) * 8 / bitrate, 1)
    except Exception:
        pass
    return None

# ---------------------------------------------------------------- classification: audio

TEMPO = (("langsam", "slow"), ("slow", "slow"), ("half speed", "slow"), ("halbes tempo", "slow"),
         ("schnell", "fast"), ("fast", "fast"), ("full speed", "fast"))

# Role words incl. common typos and English names (the diminution pattern also catches misspellings).
ROLE_WORDS = re.compile(r"(?i)\b(gerüstsatz|gerüst|geruest\w*|skeleton|framework|d[iy]m+i?n[iu]\w*|diminuierter satz|"
                        r"aufgabe|task|exercise|original|aufnahme|recording|einspielung|audio|mögliche lösung|"
                        r"possible solution|sample solution|beispiellösung)\b")

# Words that name a *version* of the task, not a performer (kept as the variant label).
VARIANT_WORDS = {
    "klavier", "piano", "cembalo", "harpsichord", "orgel", "organ", "midi", "synth", "sibelius", "dorico",
    "musescore", "finale", "notation", "streicher", "strings", "gitarre", "guitar", "laute", "lute",
    "flöte", "flute", "violine", "violin", "cello", "chor", "choir", "bass", "sopran", "alt", "tenor",
    "kurz", "short", "lang", "long", "variante", "version", "neu", "new", "alt2", "einfach", "simple",
    "kadenz", "cadence", "mit", "ohne", "teil", "part", "loop",
}

# Recording markers: the file is (an excerpt of) a recording of the real piece.
RECORDING_RE = re.compile(r"(?i)\b(original|aufnahme|recording|einspielung|live|konzert|concert|cd|track|take|"
                          r"youtube|spotify|mitschnitt|rec)\b")

# Excerpt / section / performer-group words that only occur in names of recordings.
EXCERPT_RE = re.compile(r"(?i)(ausschnitt|abschnitt|excerpt|exposition|durchführung|development|reprise|"
                        r"recapitulation|coda|\btakte?\b|\bbars?\b|\bmm\.|letzter satz|last movement|\bsatz\b|"
                        r"movement|allemande|courante|sarabande|gigue|menuett|minuet|gavotte|bourr[ée]e|"
                        r"pr[äa]lud\w*|prelude|toccata|fuga\b|ensemble|orchest\w*|akademie|academy|consort|"
                        r"kammer\w*|chamber|quartett|quartet|\bt\. ?\d+-\d+|\b[abc]-teil|\b[abc] section|"
                        r"\b4[0-4]\d ?hz)")

def audio_info(rel):
    """-> dict(role, tempo, key, label, order)"""
    stem = norm(Path(rel).stem)
    stem = re.sub(r"(?i)(\.(png|pdf|mp3|wav|m4a|aiff?|xml|musicxml))+$", "", stem)   # double extensions
    l = stem.lower()
    tempo = "normal"
    for word, t in TEMPO:
        if word in l:
            tempo = t
    key = find_key(stem)
    order = None
    role = None
    m = re.match(r"^(\d{2})\.?-?(?:\d{2}\.)?\s", stem)
    if m and re.search(r"(?i)(\bT\. ?\d|mal ganz|abschnitt|\bteil\b)", stem):
        role, order = "task", int(m.group(1))
        label = norm(stem.split(" - ")[-1])
        return dict(role=role, tempo="normal", key=None, label=label, order=order, group="clips")
    if re.search(r"gerüst|geruest|skeleton|framework", l):
        role = "skeleton"
    elif re.search(r"mögliche lösung|possible solution|sample solution|beispiellösung|schülerlösung", l):
        role = "sample"
    elif RECORDING_RE.search(l):
        role = "original"
    elif re.search(r"d[iy]m+i?n[iu]|aufgabe|\btask\b|exercise|\bübung\b", l):
        role = performer_take(stem) or "task"
    elif re.match(r"^audio\b", l) or l in VARIANT_WORDS:
        role = "task"
    elif EXCERPT_RE.search(l):
        role = "original"
    else:
        role = "other"
    label = ROLE_WORDS.sub(" ", stem)
    if key:
        label = KEY_RE.sub(" ", label)
    for word, _ in TEMPO:
        label = re.sub(word, " ", label, flags=re.I)
    label = re.sub(r"\b(in|mit)\s*$", " ", label.strip())
    label = norm(re.sub(r"[-–_.]+", " ", label)).strip()
    if label.lower() in ("", "mp3"):
        label = ""
    return dict(role=role, tempo=tempo, key=key, label=label, order=None, group=None)

def performer_take(stem):
    """'Diminution <Name>' where <Name> is a proper name, not a version word -> a recording by that
    performer, i.e. role 'original'. Returns None when the rest looks like a task variant."""
    rest = ROLE_WORDS.sub(" ", stem)
    rest = KEY_RE.sub(" ", rest)
    for word, _ in TEMPO:
        rest = re.sub(word, " ", rest, flags=re.I)
    words = [w for w in re.split(r"[\s\-–_.,()]+", rest) if w]
    if len(words) != 1:
        return None
    w = words[0]
    if w.lower() in VARIANT_WORDS or any(c.isdigit() for c in w) or not w[:1].isupper() or len(w) < 3:
        return None
    return "original"

# ---------------------------------------------------------------- classification: notation

COPY_RE = re.compile(r"(?i)(\s*[-_]?\s*(kopie|copy|kopie von|copy of|duplicate|dup)(\s*\(?\d+\)?)?|\s*\(\d+\)|\s+\d+\s*$)$")
COPY_PREFIX_RE = re.compile(r"(?i)^(kopie von|copy of)\s+")

def strip_copy(s):
    """Remove the many ways copies get named: ' Kopie', ' - Kopie (2)', ' copy', 'Copy of x', 'x (1)'."""
    s = COPY_PREFIX_RE.sub("", s)
    prev = None
    while prev != s:
        prev, s = s, COPY_RE.sub("", s).strip()
    return s

def group_key(stem):
    k = norm(stem).lower()
    k = re.sub(r"[_ -]?(\d{4}|p\d{1,3}|seite \d+|page \d+)$", "", k)      # paged exports
    k = re.sub(r"( - partitur| - score)$", "", k)
    return strip_copy(k).strip()

def notation_role(path, size, ext, group, sibling_keys, tonart_bases, sib_stems):
    stem = norm(path.stem)
    l = stem.lower()
    parent = "/".join(p.lower() for p in path.parts[:-1])
    base = group
    if re.search(r"anfang|beginning|incipit|\bstart\b|opening", l):
        return "start"
    if re.search(r"aufgabe|arbeitsblatt|diktat|worksheet|\btask\b|exercise", l) or re.search(r"arbeitsbl|worksheet", parent):
        return "task_sheet"
    if re.search(r"lösung|loesung|solution", l) or re.search(r"lösungen|solutions", parent):
        return "solution"
    if re.search(r"tonart|with key|\bkey\b", l):
        return "degrees_keyed"
    if re.match(r"(stufen|degrees|roman|funktionen|bezifferung|figured)", l):
        return "degrees"
    if re.match(r"(partitur|score)", base) or re.search(r"bildschirmfoto|screenshot|screen shot|bildschirmaufnahme", l):
        return "solution"
    if base in tonart_bases:
        return "degrees"
    if any(s.startswith(base + " - lösung") for s in sib_stems):
        return "task_sheet"
    if "diminution" in l:
        return "solution"
    if any(s.startswith(base + " - aufgabe") for s in sib_stems | sibling_keys):
        return "solution"
    if re.search(r"partitur|score", l) and size <= 12 * 1024:
        return "degrees"
    if ext in (".tif", ".tiff") and size < 30 * 1024:
        return "degrees"
    if re.search(r"partitur|score", l):
        return "solution"
    return "reference"

# Scanned editions (public score libraries, facsimiles, scans): references, not exercise material.
SCAN_RE = re.compile(r"(?i)(^imslp|^petrucci|\bscan|faksimile|facsimile|digitalisat|autograph|manuscript|manuskript|"
                     r"erstdruck|first edition|\bbsb\b|\bmdz\b|gallica)")

# ---------------------------------------------------------------- build

def repair_id(sid, cid):
    """Model numbers are S + category (4 digits, '02.2' -> '0202') + 2-digit number. Hand-typed numbers
    go wrong in many ways (a digit missing or doubled, letters, spaces); malformed ones are rebuilt
    from the category folder and the last two digits. Returns (id, repaired?)."""
    want = "S" + cid.replace(".", "0")
    digits = re.sub(r"\D", "", sid)
    if len(digits) == 6 and sid == "S" + digits:
        return sid, False            # well-formed: keep as is (IDs are stable keys)
    return want + (digits[-2:] if len(digits) >= 2 else digits.zfill(2)), True


class Builder:
    def __init__(self, src, out, jobs):
        self.src, self.out, self.jobs = Path(src), Path(out), jobs
        self.convert_jobs = []     # (callable)
        self.dropped = []          # (relpath, size, reason)
        self.review = []           # strings
        self.models = []
        self.cats = []
        self.stats = dict(kept_audio=0, kept_audio_bytes=0)

    def visible(self, d):
        """All real files below d, skipping hidden files and Logic projects (logged as dropped)."""
        out, logic = [], {}
        for f in d.rglob("*"):
            if not f.is_file():
                continue
            parts = f.relative_to(d).parts
            lp = next((i for i, x in enumerate(parts) if x.endswith(".logicx")), None)
            if lp is not None:
                key = d.joinpath(*parts[:lp + 1])
                logic[key] = logic.get(key, 0) + f.stat().st_size
            elif not any(x.startswith(".") or x == "__MACOSX" for x in parts):
                out.append(f)
        for k, size in logic.items():
            self.drop(k.relative_to(self.src), size, "Logic project")
        return out

    # -- logging
    def drop(self, rel, size, reason):
        self.dropped.append((str(rel), size, reason))

    # -- conversion jobs
    def queue_image(self, src, dst):
        dst.parent.mkdir(parents=True, exist_ok=True)
        self.convert_jobs.append(lambda s=src, d=dst: img_to_webp(s, d))

    def queue_pdf(self, src, dst_stem):
        dst_stem.parent.mkdir(parents=True, exist_ok=True)
        self.convert_jobs.append(lambda s=src, d=dst_stem: pdf_to_webp(s, d))

    # -- one model directory (or virtual file list)
    def build_model(self, files, base, model_dir, meta, src_label):
        """files: list of absolute Paths belonging to this model; base: Path they are relative to."""
        model_dir.mkdir(parents=True, exist_ok=True)
        used_names = set()
        audio, notation, extras = [], [], []

        def unique(name, folder):
            stem, ext = os.path.splitext(name)
            n, cand = 2, name
            while (folder, cand) in used_names:
                cand = f"{stem}_{n}{ext}"
                n += 1
            used_names.add((folder, cand))
            return cand

        # ---- audio
        seen_md5 = {}
        for p in sorted(files):
            rel = p.relative_to(base)
            ext = p.suffix.lower()
            size = p.stat().st_size
            if ext in AV_DROP_EXT:
                self.drop(rel, size, "video/AIFF/FLV (not needed)")
                continue
            if ext not in AUDIO_EXT:
                continue
            info = audio_info(rel)
            if info["role"] == "other" and size > UNKNOWN_AUDIO_MAX:
                self.drop(rel, size, "unclassified audio > 1 MB (full recording)")
                continue
            if size > BIG_AUDIO:
                self.drop(rel, size, "audio > 2 MB (full recording)")
                continue
            h = md5(p)
            if h in seen_md5:
                self.drop(rel, size, f"identical copy of {seen_md5[h]}")
                continue
            seen_md5[h] = str(rel)
            parts = [info["role"]]
            if info["tempo"] != "normal":
                parts.append(info["tempo"])
            if info["key"]:
                parts.append(info["key"])
            if info["label"]:
                parts.append(ascii_safe(info["label"])[:40])
            if info["order"] is not None:
                parts.insert(1, f"{info['order']:02d}")
            name = unique("_".join(parts) + ext, "audio")
            dst = model_dir / "audio" / name
            dst.parent.mkdir(exist_ok=True)
            shutil.copy2(p, dst)
            entry = {"file": f"audio/{name}", "role": info["role"], "tempo": info["tempo"]}
            if info["key"]:
                entry["key"] = info["key"]
            if info["label"]:
                entry["label"] = info["label"]
            if info["order"] is not None:
                entry["order"] = info["order"]
            if info["group"]:
                entry["group"] = info["group"]
            dur = mp3_duration(p) if ext == ".mp3" else None
            if dur:
                entry["duration_s"] = dur
            entry["src"] = str(rel)
            audio.append(entry)
            self.stats["kept_audio"] += 1
            self.stats["kept_audio_bytes"] += size
            if info["role"] == "other":
                self.review.append(f"{meta['id']}: audio '{rel}' unclassified (role=other)")
        audio.sort(key=lambda a: (["task", "skeleton", "original", "sample", "other"].index(a["role"]), a.get("order") or 0, a["file"]))

        # ---- notation
        cand = [p for p in files if p.suffix.lower() in IMG_EXT or p.suffix.lower() == ".pdf"]
        sib_stems = {group_key(p.stem) for p in files if p.suffix.lower() == ".sib"}
        sibling_keys = {group_key(p.stem) for p in files if p.suffix.lower() in IMG_EXT | {".pdf"}}
        groups = {}
        for p in sorted(cand):
            rel = p.relative_to(base)
            ext = p.suffix.lower()
            size = p.stat().st_size
            if SCAN_RE.search(p.name) or (ext == ".pdf" and size > BIG_PDF):
                self.drop(rel, size, "scanned edition / large PDF")
                continue
            groups.setdefault((str(rel.parent), group_key(p.stem)), []).append(p)
        tonart_bases = {re.sub(r"\s*mit\s*tonart$", "", k[1]).strip() for k in groups if re.search(r"mit\s*tonart$", k[1])}
        for (folder, key), members in sorted(groups.items()):
            pdf_part = [m for m in members if m.suffix.lower() == ".pdf" and m.stem.lower().endswith(" - partitur")]
            paged = any(re.search(r"_\d{4}$", m.stem) for m in members)
            if paged and pdf_part:
                chosen = pdf_part[0]
            else:
                pref = {".png": 0, ".tif": 1, ".tiff": 1, ".jpg": 2, ".jpeg": 2, ".pdf": 3}
                chosen = sorted(members, key=lambda m: (pref[m.suffix.lower()], m.name))[0]
            for m in members:
                if m is not chosen:
                    self.drop(m.relative_to(base), m.stat().st_size, f"duplicate of {chosen.name}")
            ext = chosen.suffix.lower()
            role = notation_role(chosen.relative_to(base), chosen.stat().st_size, ext, key, sibling_keys, tonart_bases, sib_stems)
            label = norm(chosen.stem)
            label = strip_copy(label)
            label = re.sub(r"(?i)(_\d{4}|partitur|score|bildschirmfoto.*|screenshot.*|screen shot.*)", " ", label)
            label = norm(re.sub(r"[-–_.]+", " ", label))
            lname = ascii_safe(label)[:30]
            name = unique(f"{role}{'_' + lname if lname and role not in ('solution', 'start') else ''}.webp", "notation")
            stem = os.path.splitext(name)[0]
            ndir = model_dir / "notation"
            if ext == ".pdf":
                self.queue_pdf(chosen, ndir / stem)
                files_out = [f"notation/{stem}.webp"]   # pdf_to_webp renames to -pN when multi-page
                notation.append({"file": f"notation/{stem}.webp", "role": role, "_pdf": True, "src": str(chosen.relative_to(base)), **({"label": label} if label and role not in ("solution", "start") else {})})
            else:
                self.queue_image(chosen, ndir / name)
                notation.append({"file": f"notation/{name}", "role": role, "src": str(chosen.relative_to(base)), **({"label": label} if label and role not in ("solution", "start") else {})})
            if role == "reference":
                self.review.append(f"{meta['id']}: notation '{chosen.relative_to(base)}' -> role 'reference' (check)")
        order = ["start", "task_sheet", "degrees", "degrees_keyed", "solution", "reference"]
        notation.sort(key=lambda n: (order.index(n["role"]), n["file"]))

        # ---- extras (editable sources)
        for p in sorted(files):
            if p.suffix.lower() in SRC_EXT:
                name = unique(norm(p.name), "extras")
                (model_dir / "extras").mkdir(exist_ok=True)
                shutil.copy2(p, model_dir / "extras" / name)
                extras.append({"file": f"extras/{name}", "kind": p.suffix.lower().lstrip(".")})

        # ---- status
        has_task = any(a["role"] == "task" for a in audio)
        has_orig = any(a["role"] == "original" for a in audio)
        if has_task or has_orig:
            status = "complete" if has_task else "original-only"
        elif any(a["role"] == "skeleton" for a in audio):
            status = "skeleton-only"
        elif notation:
            status = "notation-only"
        else:
            status = "sources-only"
        key = next((a.get("key") for a in audio if a["role"] == "task" and a.get("key")), None) \
            or next((a.get("key") for a in audio if a.get("key")), None)
        manifest = {
            "schema": SCHEMA, **meta, "key": key, "status": status,
            "trainable": has_task or has_orig,
            "difficulty": None, "tags": [],
            "audio": audio, "notation": notation, "extras": extras,
            "source": src_label,
        }
        for k in [k for k, v in manifest.items() if v is None and k not in ("key", "difficulty")]:
            del manifest[k]
        return manifest, model_dir

    # -- whole archive
    def run(self):
        root = self.src
        cat_dirs = sorted(d for d in root.iterdir() if d.is_dir() and re.match(r"\d\d\.\d", norm(d.name)))
        for cd in cat_dirs:
            cname = norm(cd.name)
            cid = cname[:4]
            ctitle = cname[7:] if cname[4:7] == " - " else cname[4:].strip(" -")
            cdir = self.out / f"{cid}_{slug(ctitle)}"
            cat_models = []
            entries = sorted(cd.iterdir(), key=lambda p: norm(p.name))
            numbered = {}
            loose = []
            for e in entries:
                n = norm(e.name)
                if e.is_dir() and e.suffix == ".logicx":
                    self.drop(e.relative_to(root), sum(f.stat().st_size for f in e.rglob("*") if f.is_file()), "Logic project")
                    continue
                if n.startswith(".") or n == "__MACOSX":
                    continue
                if not e.is_dir():
                    loose.append(e)
                    continue
                m = re.match(r"^(S\d{3,8})\s*-\s*(.*)$", n)
                if m and re.search(r"vorübung|vorubung|warm-?ups?|einstieg|vorbereitung", n, re.I):
                    for sub in sorted((x for x in e.iterdir() if x.is_dir()), key=lambda p: norm(p.name)):
                        found = re.search(r"(\d+)", sub.name)
                        nn = found.group(1) if found else str(len(cat_models) + 1)
                        mid = f"{m.group(1)}-{int(nn):02d}"
                        meta = dict(id=mid, category=cid, kind="warmup", title=norm(sub.name), composer=None)
                        files = self.visible(sub)
                        mf, md = self.build_model(files, sub, cdir / f"{mid}_vorbuebung-{int(nn):02d}", meta, str(sub.relative_to(root)))
                        cat_models.append((mf, md))
                    continue
                if m:
                    sid, rest = m.group(1), m.group(2)
                    sid, id_inferred = repair_id(sid, cid)
                else:
                    m2 = re.match(r"^(\d{1,2})\s*-\s*(.*)$", n)
                    if m2:
                        sid, rest, id_inferred = "S" + cid.replace(".", "0") + f"{int(m2.group(1)):02d}", m2.group(2), True
                    else:
                        sid, rest, id_inferred = None, n, True
                numbered[e] = (sid, rest, id_inferred)
            # assign ids to unnumbered folders
            used = {v[0] for v in numbered.values() if v[0]}
            nxt = max([int(u[-2:]) for u in used if u], default=0) + 1
            for e, (sid, rest, inf) in list(numbered.items()):
                if sid is None:
                    sid = "S" + cid.replace(".", "0") + f"{nxt:02d}"
                    nxt += 1
                    numbered[e] = (sid, rest, True)
            for e, (sid, rest, inf) in numbered.items():
                parts = [p.strip() for p in rest.split(" - ")]
                composer = parts[0] if len(parts) >= 2 else None
                title = " - ".join(parts[1:]) if len(parts) >= 2 else rest
                title = strip_copy(title)
                meta = dict(id=sid, category=cid, kind="model", title=title, composer=composer)
                if inf:
                    meta["id_inferred"] = True
                files = self.visible(e)
                mf, md = self.build_model(files, e, cdir / "_".join(x for x in (sid, slug(composer) if composer else "", slug(title, 36)) if x), meta, str(e.relative_to(root)))
                cat_models.append((mf, md))
            # loose files: images -> one stub model each; everything else -> one overview model
            imgs = [f for f in loose if f.suffix.lower() in IMG_EXT]
            others = [f for f in loose if f.suffix.lower() not in IMG_EXT]
            for i, f in enumerate(sorted(imgs, key=lambda p: norm(p.name)), 1):
                sid = f"U{cid.replace('.', '0')}-{i:02d}"
                meta = dict(id=sid, category=cid, kind="model", title=f"Beispiel {i} (nur Notation, unbenannt)", composer=None, id_inferred=True)
                tmp = f
                mf, md = self.build_model([tmp], f.parent, cdir / f"{sid}_unbenannt", meta, str(f.relative_to(root)))
                cat_models.append((mf, md))
            if others:
                sid = f"U{cid.replace('.', '0')}-00"
                title = norm(re.sub(r"\.[A-Za-z0-9]+$", "", sorted(others, key=lambda p: norm(p.name))[0].name))
                title = re.sub(r" - Partitur$", "", title)
                meta = dict(id=sid, category=cid, kind="overview", title=title, composer=None, id_inferred=True)
                mf, md = self.build_model(others, cd, cdir / f"{sid}_uebersicht", meta, str(others[0].relative_to(root)))
                cat_models.append((mf, md))
            cat_models.sort(key=lambda t: t[0]["id"])
            self.cats.append(dict(id=cid, title=ctitle, dir=cdir.name, difficulty_default=CATEGORY_DIFFICULTY.get(cid, 3), models=cat_models))

        return self

    def finish(self):
        print(f"converting {len(self.convert_jobs)} notation files ...", flush=True)
        with ThreadPoolExecutor(self.jobs) as ex:
            results = list(ex.map(lambda j: j(), self.convert_jobs))
        failures = [r for r in results if r]
        # fix pdf entries to real page files
        index_models = []
        for cat in self.cats:
            for mf, md in cat["models"]:
                new = []
                for n in mf["notation"]:
                    if n.pop("_pdf", False):
                        stem = n["file"][:-5]
                        pages = sorted((md / "notation").glob(f"{Path(stem).name}*.webp"))
                        pages = [p for p in pages if p.name == Path(stem).name + ".webp" or re.match(re.escape(Path(stem).name) + r"-p\d+\.webp$", p.name)]
                        if not pages:
                            self.review.append(f"{mf['id']}: PDF conversion produced nothing for {n['src']}")
                            continue
                        for p in pages:
                            e = dict(n)
                            e["file"] = f"notation/{p.name}"
                            new.append(e)
                    else:
                        if (md / n["file"]).exists():
                            new.append(n)
                        else:
                            self.review.append(f"{mf['id']}: image conversion failed for {n['src']}")
                mf["notation"] = new
                if not mf["notation"] and mf["status"] == "notation-only":
                    mf["status"] = "sources-only" if mf["extras"] else "empty"
                for sub in ("audio", "notation", "extras"):
                    d = md / sub
                    if d.exists() and not any(d.iterdir()):
                        d.rmdir()
                (md / "model.json").write_text(json.dumps(mf, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                index_models.append(dict(id=mf["id"], category=mf["category"], dir=str(md.relative_to(self.out)), title=mf["title"],
                                         composer=mf.get("composer"), status=mf["status"], kind=mf["kind"], trainable=mf["trainable"]))
        index = dict(schema=SCHEMA, generated_from="tools/build_library.py",
                     categories=[dict(id=c["id"], title=c["title"], dir=c["dir"], difficulty_default=c["difficulty_default"],
                                      models=len(c["models"]), trainable=sum(1 for m, _ in c["models"] if m["trainable"])) for c in self.cats],
                     models=index_models)
        (self.out / "library.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (self.out / "README-PRIVATE.txt").write_text(
            "PRIVATE TEACHING MATERIAL - NOT FOR REDISTRIBUTION\n\n"
            "This library contains material whose authors hold the copyright.\n"
            "It is for personal study only. Do not publish, upload, commit to a repository\n"
            "or share it. See docs/library-format.md in the project for the format.\n", encoding="utf-8")
        self.write_report(index_models, failures)

    def write_report(self, models, failures):
        out = self.out
        total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
        dropped_bytes = sum(s for _, s, _ in self.dropped)
        by_status = {}
        for m in models:
            by_status[m["status"]] = by_status.get(m["status"], 0) + 1
        lines = ["# Build report", "",
                 f"* library size: **{total / MB:.0f} MB**  |  models: {len(models)}  |  dropped: {len(self.dropped)} files ({dropped_bytes / MB:.0f} MB)",
                 f"* status: " + ", ".join(f"{k}: {v}" for k, v in sorted(by_status.items())), ""]
        if failures:
            lines += ["## Conversion failures", *[f"* {f}" for f in failures], ""]
        lines += ["## Needs a look", *(f"* {r}" for r in sorted(set(self.review))), ""]
        incomplete = [m for m in models if m["status"] not in ("complete",) and m["kind"] != "overview"]
        lines += ["## Models without a task recording", *(f"* {m['id']} [{m['status']}] {m['composer'] or ''} - {m['title']}" for m in incomplete), ""]
        lines += ["## Dropped files", *(f"* {s / MB:6.1f} MB  {p}  ({r})" for p, s, r in sorted(self.dropped, key=lambda x: -x[1])), ""]
        (out / "_report.md").write_text("\n".join(lines), encoding="utf-8")


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)

IMG_ARGS = ["-background", "white", "-alpha", "remove", "-alpha", "off", "-fuzz", "4%", "-trim", "+repage",
            "-bordercolor", "white", "-border", "24", "-resize", "2400x>", "-define", "webp:method=6", "-quality", "88"]

def img_to_webp(src, dst):
    r = run(["convert", f"{src}[0]", *IMG_ARGS, str(dst)])
    if r.returncode == 0:
        return None
    if "resources exhausted" in r.stderr or "width or height exceeds" in r.stderr:
        return _img_via_pillow(src, dst)     # huge scans exceed ImageMagick's policy limits
    return f"{src}: {r.stderr.strip()[:200]}"


def _img_via_pillow(src, dst):
    try:
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = None
        with tempfile.TemporaryDirectory() as td:
            im = Image.open(src)
            im = im.convert("L")
            if im.width > 4800:
                im = im.resize((4800, round(im.height * 4800 / im.width)), Image.LANCZOS)
            small = os.path.join(td, "s.png")
            im.save(small)
            r = run(["convert", small, *IMG_ARGS, str(dst)])
            return None if r.returncode == 0 else f"{src}: {r.stderr.strip()[:200]}"
    except Exception as e:
        return f"{src}: pillow fallback failed: {e}"

def pdf_to_webp(src, dst_stem):
    with tempfile.TemporaryDirectory() as td:
        r = run(["pdftoppm", "-r", "170", "-png", "-l", "8", str(src), os.path.join(td, "p")])
        pages = sorted(Path(td).glob("p-*.png"))
        if r.returncode != 0 or not pages:
            return f"{src}: pdftoppm failed {r.stderr.strip()[:200]}"
        for i, pg in enumerate(pages, 1):
            dst = Path(f"{dst_stem}.webp") if len(pages) == 1 else Path(f"{dst_stem}-p{i}.webp")
            r = run(["convert", str(pg), *IMG_ARGS, str(dst)])
            if r.returncode != 0:
                return f"{src}: {r.stderr.strip()[:200]}"
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="archive zip or an extracted archive directory")
    ap.add_argument("out", help="output library directory (will be created; must not exist or be empty)")
    ap.add_argument("--jobs", type=int, default=6)
    a = ap.parse_args()
    out = Path(a.out)
    if out.exists() and any(out.iterdir()):
        sys.exit(f"refusing to write into non-empty {out}")
    out.mkdir(parents=True, exist_ok=True)
    tmp = None
    src = Path(a.src)
    if src.is_file() and src.suffix == ".zip":
        tmp = tempfile.mkdtemp(prefix="satzmodelle_")
        print("extracting ...", flush=True)
        with zipfile.ZipFile(src) as z:
            z.extractall(tmp)
        kids = [d for d in Path(tmp).iterdir() if d.is_dir() and not d.name.startswith("__")]
        src = kids[0] if len(kids) == 1 else Path(tmp)
    try:
        b = Builder(src, out, a.jobs).run()
        b.finish()
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)
    print("done ->", out)

if __name__ == "__main__":
    main()
