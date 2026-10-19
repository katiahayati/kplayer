"""Measure how loud a recording is at each beat of the score: its dynamic arc.

Loudness is EBU R128 momentary loudness (K-weighted, 400 ms windows), the
standard measure of how loud something sounds, in LUFS. Use the
accompaniment's stem (Demucs's no_vocals.wav) for a song, so the singer
doesn't count. Score positions come from the alignment.

Usage:
  .venv/bin/python tools/dynamics_arc.py alignment.json AUDIO OFFSET arc.json

OFFSET is where AUDIO starts in the aligned recording, in seconds (0 for the
recording itself; the music start for a stem cut from there). Writes each
quarter note's loudness, and the recording's quietest and loudest moments.
"""

import json
import sys
from pathlib import Path

import librosa
import numpy as np
import pyloudnorm

WINDOW = 0.4  # seconds, as R128 momentary loudness
HOP = 0.05


def momentary_loudness(audio, rate):
    """LUFS every HOP seconds, over WINDOW-second windows (K-weighted)."""
    meter = pyloudnorm.Meter(rate, block_size=WINDOW)
    weighted = audio.copy()
    for f in meter._filters.values():
        weighted = f.apply_filter(weighted)
    power = np.concatenate([[0], np.cumsum(weighted.astype(np.float64) ** 2)])
    win, hop = int(WINDOW * rate), int(HOP * rate)
    starts = np.arange(0, len(weighted) - win, hop)
    mean = (power[starts + win] - power[starts]) / win
    times = (starts + win / 2) / rate
    return times, mean


def main(alignment_path, audio_path, offset, out_path):
    alignment = json.loads(Path(alignment_path).read_text())
    onsets = np.array(alignment["onsets"])
    audio, rate = librosa.load(audio_path, sr=None, mono=True)
    times, power = momentary_loudness(audio, rate)
    times = times + offset

    q_end = float(onsets[-1, 0])
    beats = []
    for q in np.arange(0, np.floor(q_end) + 1):
        t0, t1 = np.interp([q, min(q + 1, q_end)], onsets[:, 0], onsets[:, 1])
        if t1 - t0 < WINDOW:  # fast beats: at least one window, centred on the beat
            mid = (t0 + t1) / 2
            t0, t1 = mid - WINDOW / 2, mid + WINDOW / 2
        inside = (times >= t0) & (times <= t1)
        if not inside.any():
            continue
        lufs = -0.691 + 10 * np.log10(power[inside].mean() + 1e-12)
        beats.append({"q": float(q), "t": round(float(t0), 3), "lufs": round(float(lufs), 2)})
    values = np.array([b["lufs"] for b in beats])
    Path(out_path).write_text(
        json.dumps({"recording": alignment.get("recording"), "audio": Path(audio_path).name, "beats": beats})
    )
    print(
        f"{len(beats)} beats; loudness from {np.percentile(values, 2):.1f} to {np.percentile(values, 98):.1f} LUFS "
        f"(2nd–98th percentile), median {np.median(values):.1f}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4])
