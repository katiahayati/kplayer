"""Time the singer's notes by aligning the score's vocal line to an isolated vocal track.

Same synctoolbox alignment as tools/align_recording.py, with only the vocal
line on the score side and only the voice on the recording side (separated
with Demucs, for example). The vocal line is laid out along the full-score
alignment, so the singer's rests already line up and the alignment only has to
correct how she places her notes.

Usage:
  .venv/bin/python tools/align_voice.py score-notes.json alignment.json vocals.wav OFFSET voice.json

OFFSET is where vocals.wav starts in the recording, in seconds. Writes each
sung note's score position, its time from the full-score alignment, and its
time from the voice alignment.
"""

import json
import sys
from pathlib import Path

import librosa
import numpy as np
from synctoolbox.dtw.utils import shift_chroma_vectors

from align_recording import FS, align, audio_features, decode, score_features

PAD = 2.0  # seconds of vocal track kept either side of the sung span
SNAP = 0.8  # seconds: how far an entry may move to a vocal attack


def main(notes_path, alignment_path, vocals_path, offset, out_path):
    score = json.loads(Path(notes_path).read_text())
    full = json.loads(Path(alignment_path).read_text())
    onsets = np.array(full["onsets"])
    full_time = lambda q: np.interp(q, onsets[:, 0], onsets[:, 1])
    voice_part = score.get("voicePart", 0)
    notes = sorted((n for n in score["notes"] if n["part"] == voice_part), key=lambda n: n["qOn"])
    if not notes:
        sys.exit("The score has no vocal line (no part with lyrics).")

    # The sung span, in recording time, and the matching stretch of the vocal track.
    start = float(full_time(notes[0]["qOn"])) - PAD
    end = float(full_time(max(n["qOff"] for n in notes))) + PAD
    vocals = decode(Path(vocals_path))
    crop = vocals[max(0, int((start - offset) * FS)) : int((end - offset) * FS)]
    start = offset + max(0, int((start - offset) * FS)) / FS
    print(f"vocal track: {len(crop) / FS:.1f} s from {start:.2f} s", file=sys.stderr)

    a_chroma, a_dlnco, _ = audio_features(crop)
    layout = lambda q: full_time(q) - start
    s_chroma, s_dlnco = score_features(notes, layout)
    # Silent stretches give all-zero features; keep the cost finite there.
    for f in (a_chroma, a_dlnco, s_chroma, s_dlnco):
        np.nan_to_num(f, copy=False)
    shift = int(full.get("keyShift", 0))
    audio_t, score_t = align(a_chroma, a_dlnco, shift_chroma_vectors(s_chroma, shift), shift_chroma_vectors(s_dlnco, shift))

    # Where the pitch doesn't change (an entry after a rest, or a repeated note), chroma can't
    # see where one note ends and the next begins: a singer often holds into a written rest.
    # There, snap to a vocal attack: the one that rises most from the moment before it (a
    # re-articulation, not a bump inside a held note), preferring nearer ones.
    attacks = librosa.onset.onset_detect(y=crop, sr=FS, units="time", backtrack=True)
    hop = 256
    level = 20 * np.log10(librosa.feature.rms(y=crop, hop_length=hop)[0] + 1e-9)
    frame = lambda t: min(len(level) - 1, max(0, int(t * FS / hop)))
    rise = np.array([level[frame(a + 0.1)] - level[frame(a - 0.3) : frame(a) + 1].min() for a in attacks])
    attacks = attacks + start

    results = []
    for i, n in enumerate(notes):
        expected = float(full_time(n["qOn"]))
        found = float(np.interp(layout(n["qOn"]), score_t, audio_t)) + start
        how = "dtw"
        prev = notes[i - 1] if i else None
        if prev is None or n["qOn"] - prev["qOff"] > 0.05 or n["pitch"] == prev["pitch"]:
            near = np.nonzero(np.abs(attacks - found) <= SNAP)[0]
            if len(near):
                best = near[np.argmax(rise[near] - 20 * np.abs(attacks[near] - found))]
                found, how = float(attacks[best]), "dtw+attack"
        results.append({"q": n["qOn"], "pitch": n["pitch"], "expected": round(expected, 3), "found": round(found, 3), "how": how})
    Path(out_path).write_text(json.dumps({"voicePart": voice_part, "notes": results}))
    diffs = np.array([r["found"] - r["expected"] for r in results])
    print(
        f"{len(results)} sung notes aligned; vs the full-score alignment: median {np.median(np.abs(diffs)):.2f} s apart, "
        f"90% within {np.percentile(np.abs(diffs), 90):.2f} s, largest {np.max(np.abs(diffs)):.2f} s",
        file=sys.stderr,
    )


if __name__ == "__main__":
    if len(sys.argv) != 6:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), sys.argv[5])
