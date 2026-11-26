#!/usr/bin/env python3
"""Guard for a public repository: fail if git tracks anything that must never be published.

    python3 -I tools/privacy_check.py          (run in CI on every push and pull request)

Blocks media, scores, notation sources, archives, signing material and the private library folder.
Images are allowed only for app resources and docs screenshots (made from the synthetic demo library).
"""
import subprocess
import sys
from pathlib import PurePosixPath

BLOCKED_EXT = {
    # audio / video
    ".mp3", ".m4a", ".aac", ".wav", ".aif", ".aiff", ".flac", ".ogg", ".oga", ".opus", ".mp4", ".mov", ".flv", ".webm",
    # notation, scores, sources
    ".sib", ".musicxml", ".mxl", ".mid", ".midi", ".mscz", ".dorico", ".pdf", ".tif", ".tiff", ".webp",
    ".docx", ".doc", ".pptx", ".ppt", ".pages", ".odt", ".logicx",
    # archives, builds, signing
    ".zip", ".7z", ".rar", ".apk", ".aab", ".jks", ".keystore", ".p12", ".pem", ".key",
}
BLOCKED_NAMES = {"keystore.properties", "local.properties", "google-services.json", ".env"}
BLOCKED_DIRS = {"library", "library-sample", "Satzmodelle"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".svg"}
IMAGE_OK_PREFIXES = ("app/android/app/src/main/res/", "docs/images/", "app/public/")
MAX_BYTES = 1_500_000


def tracked():
    out = subprocess.run(["git", "ls-files", "-z"], capture_output=True, check=True).stdout
    return [p for p in out.decode().split("\0") if p]


def main():
    problems = []
    for p in tracked():
        path = PurePosixPath(p)
        ext = path.suffix.lower()
        if ext in BLOCKED_EXT:
            problems.append(f"{p}: file type {ext} is not allowed in this public repository")
        if path.name in BLOCKED_NAMES:
            problems.append(f"{p}: private configuration file")
        if path.parts and path.parts[0] in BLOCKED_DIRS:
            problems.append(f"{p}: private library folder")
        if ext in IMAGE_EXT and not p.startswith(IMAGE_OK_PREFIXES):
            problems.append(f"{p}: images only in app resources or docs/images (demo data)")
        try:
            size = int(subprocess.run(["git", "cat-file", "-s", f":{p}"], capture_output=True, text=True).stdout or 0)
        except ValueError:
            size = 0
        if size > MAX_BYTES and not p.endswith("package-lock.json"):
            problems.append(f"{p}: {size} bytes, larger than {MAX_BYTES}")
    for line in problems:
        print("privacy:", line)
    print(f"privacy check: {len(problems)} problem(s)")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
