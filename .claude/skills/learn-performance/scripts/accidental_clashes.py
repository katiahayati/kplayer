"""Find likely wrong notes in a MusicXML score: a note and its flat/sharp/natural starting together.

A common slip when entering a score: a flat written in one octave and forgotten in the other (an octave
B-flat 4 / B 5). Chromatic music also produces real clashes, so this only lists candidates; check each
against the composer's score.

Usage: python3 accidental_clashes.py score.mxl|score.musicxml
"""

import re
import sys
import zipfile


def read(path):
    if path.endswith('.mxl'):
        with zipfile.ZipFile(path) as z:
            name = next(n for n in z.namelist() if n.endswith(('.xml', '.musicxml')) and not n.startswith('META-INF'))
            return z.read(name).decode('utf8')
    return open(path, encoding='utf8').read()


def main(path):
    s = read(path)
    names = dict(re.findall(r'<score-part id="([^"]+)">.*?<part-name>([^<]*)</part-name>', s, re.S))
    acc = {-2: 'bb', -1: 'b', 0: '', 1: '#', 2: 'x'}
    for pid, body in re.findall(r'<part id="([^"]+)">(.*?)</part>', s, re.S):
        divs = 1
        for num, meas in re.findall(r'<measure number="([^"]+)"[^>]*>(.*?)</measure>', body, re.S):
            d = re.search(r'<divisions>(\d+)</divisions>', meas)
            if d:
                divs = int(d.group(1))
            pos = last = 0
            notes = []
            for el in re.finditer(r'<(note|backup|forward)\b[^>]*>(.*?)</\1>', meas, re.S):
                kind, n = el.group(1), el.group(2)
                dur = int(re.search(r'<duration>(\d+)</duration>', n).group(1)) if '<duration>' in n else 0
                if kind == 'backup':
                    pos -= dur
                    continue
                if kind == 'forward':
                    pos += dur
                    continue
                if '<grace' in n:
                    continue
                chord = '<chord/>' in n
                start = last if chord else pos
                if not chord:
                    last, pos = pos, pos + dur
                step = re.search(r'<step>(\w)</step>', n)
                if not step:
                    continue
                alter = re.search(r'<alter>(-?\d)</alter>', n)
                octave = re.search(r'<octave>(\d)</octave>', n).group(1)
                voice = re.search(r'<voice>(\d+)</voice>', n)
                notes.append((start, step.group(1), int(alter.group(1)) if alter else 0, octave, voice.group(1) if voice else '?'))
            seen = set()
            for i, a in enumerate(notes):
                for b in notes[i + 1:]:
                    if a[0] == b[0] and a[1] == b[1] and a[2] != b[2] and (a[0], a[1]) not in seen:
                        seen.add((a[0], a[1]))
                        print(f"{names.get(pid, pid)}, bar {num}, beat {a[0] / divs + 1:g}: "
                              f"{a[1]}{acc[a[2]]}{a[3]} (voice {a[4]}) with {b[1]}{acc[b[2]]}{b[3]} (voice {b[4]})")


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
