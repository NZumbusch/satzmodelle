#!/usr/bin/env python3
"""Tests for build_library.py on a SYNTHETIC raw archive (made-up names, generated files only).

    python3 -I tools/test_build_library.py     (needs Pillow, ImageMagick `convert`)
"""
import json, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build_library as bl  # noqa: E402


class Rules(unittest.TestCase):
    def role(self, name):
        return bl.audio_info(name)["role"]

    def test_audio_roles(self):
        cases = {
            "Diminution - langsam - a-Moll.mp3": "task",
            "Diminuton Klavier.mp3": "task",                 # typo + version word
            "Dimminution - schnell.mp3": "task",
            "Exercise slow.mp3": "task",
            "Gerüst - C-Dur.mp3": "skeleton",
            "Geruestsatz.mp3": "skeleton",
            "Skeleton fast.mp3": "skeleton",
            "Original.mp3": "original",
            "Aufnahme Konzert.mp3": "original",
            "Diminution Mustermann.mp3": "original",          # performer-named take
            "Diminution Original.mp3": "original",
            "Allemande Ausschnitt.mp3": "original",
            "Ensemble Beispiel T. 1-8.mp3": "original",
            "Mögliche Lösung.mp3": "sample",
            "Possible solution.mp3": "sample",
            "Klavier.mp3": "task",
            "irgendwas.mp3": "other",
        }
        for name, want in cases.items():
            with self.subTest(name=name):
                self.assertEqual(self.role(name), want)

    def test_tempo_and_double_extension(self):
        i = bl.audio_info("Diminution - langsam - fis-Moll.png.mp3")
        self.assertEqual((i["tempo"], i["key"]), ("slow", "fis-Moll"))
        self.assertEqual(bl.audio_info("Exercise half speed.mp3")["tempo"], "slow")

    def test_copy_names(self):
        for s in ["Partitur Kopie", "Partitur - Kopie (2)", "Partitur copy", "Copy of Partitur",
                  "Kopie von Partitur", "Partitur (1)", "Partitur copy 3"]:
            with self.subTest(s=s):
                self.assertEqual(bl.strip_copy(s), "Partitur")

    def test_ids(self):
        self.assertEqual(bl.repair_id("S020207", "02.2"), ("S020207", False))
        self.assertEqual(bl.repair_id("S02207", "02.2"), ("S020207", True))     # digit missing
        self.assertEqual(bl.repair_id("S0202077", "02.2"), ("S020277", True))   # digit doubled
        self.assertEqual(bl.repair_id("S 0202-07", "02.2"), ("S020207", True))  # stray characters

    def test_scans(self):
        for n in ["IMSLP12345-Score.pdf", "Petrucci_x.pdf", "Faksimile.png", "scan_0001.tif", "Autograph.jpg"]:
            self.assertTrue(bl.SCAN_RE.search(n), n)
        self.assertFalse(bl.SCAN_RE.search("Partitur.pdf"))


def tone_file(path):
    # tiny stand-in, never decoded; content differs per file so the duplicate check keeps it
    path.write_bytes(b"ID3\x03\x00\x00\x00\x00\x00\x00" + path.name.encode() + b"\x00" * 2000)


def image(path, size=(600, 200)):
    from PIL import Image, ImageDraw
    im = Image.new("RGB", size, "white")
    ImageDraw.Draw(im).line([(10, 100), (590, 100)], fill="black", width=3)
    im.save(path)


@unittest.skipUnless(shutil.which("convert"), "ImageMagick not installed")
class EndToEnd(unittest.TestCase):
    def test_build(self):
        with tempfile.TemporaryDirectory() as td:
            raw = Path(td) / "raw" / "Archiv"
            cat = raw / "09.1 - Testkategorie"
            m1 = cat / "S090101 - Komponist A - Stück Eins"
            m2 = cat / "S09002 - Komponist B - Stück Zwei Kopie"      # digit missing + copy suffix
            warm = cat / "S090100 - Vorübungen" / "Übung 1"
            for d in (m1, m2, warm):
                d.mkdir(parents=True)
            tone_file(m1 / "Diminution - langsam - a-Moll.mp3")
            tone_file(m1 / "Diminution - a-Moll.mp3")
            tone_file(m1 / "Gerüst - a-Moll.mp3")
            tone_file(m1 / "Diminution Mustermann.mp3")
            image(m1 / "Anfang.png")
            image(m1 / "Partitur.png")
            image(m1 / "Partitur Kopie.png")                          # duplicate -> dropped
            image(m1 / "IMSLP999-Scan.png")                            # scan -> dropped
            (m1 / "Quelle.sib").write_bytes(b"sib")
            tone_file(m2 / "Original.mp3")
            image(m2 / "Stufen.png", (300, 80))
            tone_file(warm / "Aufgabe.mp3")
            image(cat / "lose Seite.png")
            out = Path(td) / "lib"
            r = subprocess.run([sys.executable, "-I", str(HERE / "build_library.py"), str(raw), str(out), "--jobs", "2"],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            idx = json.loads((out / "library.json").read_text())
            ids = sorted(m["id"] for m in idx["models"])
            self.assertEqual(ids, ["S090100-01", "S090101", "S090102", "U0901-01"])
            m = {x["id"]: x for x in idx["models"]}
            self.assertEqual(m["S090102"]["title"], "Stück Zwei")
            one = json.loads((out / m["S090101"]["dir"] / "model.json").read_text())
            roles = sorted((a["role"], a["tempo"]) for a in one["audio"])
            self.assertEqual(roles, [("original", "normal"), ("skeleton", "normal"), ("task", "normal"), ("task", "slow")])
            self.assertEqual(sorted(n["role"] for n in one["notation"]), ["solution", "start"])
            self.assertEqual(one["extras"][0]["kind"], "sib")
            report = (out / "_report.md").read_text()
            self.assertIn("scanned edition", report)
            self.assertIn("duplicate of", report)
            r = subprocess.run([sys.executable, "-I", str(HERE / "validate_library.py"), str(out)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout)


if __name__ == "__main__":
    unittest.main()
