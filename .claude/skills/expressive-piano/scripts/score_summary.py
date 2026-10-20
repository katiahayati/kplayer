"""What a MusicXML score says about how to play it, bar by bar: meter and key changes, dynamics,
hairpins, words (tempo text, "poco a poco cresc."), metronome marks, pedal, fermatas, accents.
A transcription that left these out shows bars with nothing but lyrics.

  python3 score_summary.py score.mxl|score.musicxml

Standard library only. Words are printed as they are, so a song's lyrics written as words show too.
"""

import re
import sys
import zipfile
from pathlib import Path


def read(path: str) -> str:
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            root = re.search(r'full-path="([^"]+)"', z.read("META-INF/container.xml").decode()).group(1)
            return z.read(root).decode("utf-8")
    return Path(path).read_text(encoding="utf-8")


def main(path: str) -> None:
    x = read(path)
    names = dict(re.findall(r'<score-part id="([^"]+)">.*?<part-name[^>]*>(.*?)</part-name>', x, re.S))
    title = re.findall(r"<work-title>(.*?)</work-title>|<movement-title>(.*?)</movement-title>", x)
    print("title:", " / ".join(t for pair in title for t in pair if t) or "-")
    for pid, body in re.findall(r'<part id="([^"]+)">(.*?)</part>', x, re.S):
        bars = re.findall(r'<measure [^>]*number="([^"]+)"[^>]*>(.*?)</measure>', body, re.S)
        staves = re.search(r"<staves>(\d+)</staves>", body)
        print(f"\npart {pid} ({names.get(pid, '?')}): {len(bars)} bars, {staves.group(1) if staves else 1} staff/staves")
        empty = 0
        for n, m in bars:
            bits = []
            for t in re.findall(r"<time[^>]*>(.*?)</time>", m, re.S):
                bits.append(f"time {''.join(re.findall(r'<beats>(.*?)</beats>', t))}/{''.join(re.findall(r'<beat-type>(.*?)</beat-type>', t))}")
            for k in re.findall(r"<fifths>(-?\d+)</fifths>", m):
                bits.append(f"key {k} fifths")
            bits += [f"dyn {d}" for d in re.findall(r"<dynamics[^>]*>\s*<([\w-]+)", m)]
            bits += [f"hairpin {w}" for w in re.findall(r'<wedge type="(\w+)"', m)]
            bits += [f"words '{w}'" for w in re.findall(r"<words[^>]*>(.*?)</words>", m)]
            bits += [f"♩={b}" for b in re.findall(r"<per-minute>(.*?)</per-minute>", m)]
            bits += [f"tempo {t}" for t in re.findall(r'<sound[^>]*\stempo="([^"]+)"', m)]
            bits += [f"pedal {p}" for p in re.findall(r'<pedal type="(\w+)"', m)]
            for tag in ("fermata", "accent", "strong-accent", "staccato", "tenuto", "arpeggiate", "slur"):
                c = len(re.findall(rf"<{tag}\b", m))
                if c:
                    bits.append(f"{c}×{tag}")
            if bits:
                print(f"  bar {n}: " + ", ".join(bits))
            else:
                empty += 1
        if empty:
            print(f"  ({empty} bars with none of these)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
