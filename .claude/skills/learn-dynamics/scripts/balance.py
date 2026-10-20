"""How bass-heavy a piano sounds: energy below a cut-off (300 Hz: the left hand's register) against
above it, per bar, for recordings and renders side by side.

  balance.py score-notes.json [--bars 1-18,29-37] [--cut 300] AUDIO TIMING START [AUDIO TIMING START …]

Each AUDIO comes with the file that says when its beats happen (TIMING: an alignment.json, or the
--timing file of scripts/render-audio.ts) and where AUDIO starts in that timeline (START: the music
start a stem was cut from, 0 for a render). Prints the median over the chosen bars, in dB (negative:
more treble than bass). Recordings differ by their microphones and rooms (two pianists in one song
measured −7.5 and −1.9 dB), so aim a render between them rather than at one.
"""

import json
import sys

import librosa
import numpy as np

args = sys.argv[1:]


def opt(name, default):
    if f"--{name}" in args:
        i = args.index(f"--{name}")
        v = args[i + 1]
        del args[i : i + 2]
        return v
    return default


bar_spec = opt("bars", None)
cut = float(opt("cut", 300))
notes_path, *rest = args
measures = json.load(open(notes_path))["measures"]
bars = range(len(measures))
if bar_spec:
    bars = sorted({b for r in bar_spec.split(",") for b in range(int(r.partition("-")[0]) - 1, int(r.partition("-")[2] or r.partition("-")[0]))})

for audio, timing, start in zip(rest[0::3], rest[1::3], rest[2::3]):
    y, sr = librosa.load(audio, sr=22050, mono=True)
    power = np.abs(librosa.stft(y, n_fft=4096, hop_length=1024)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)
    times = librosa.frames_to_time(np.arange(power.shape[1]), sr=sr, hop_length=1024)
    low, high = power[(freqs > 40) & (freqs < cut)].sum(0), power[freqs >= cut].sum(0)
    onsets = json.load(open(timing))["onsets"]
    qs, ts = np.array([o[0] for o in onsets]), np.array([o[1] for o in onsets]) - float(start)
    per_bar = []
    for b in bars:
        t0, t1 = np.interp([measures[b]["q0"], measures[b]["q1"]], qs, ts)
        w = (times >= t0) & (times < t1)
        if w.any():
            per_bar.append(10 * np.log10(low[w].sum() / high[w].sum()))
    print(f"{audio}: bass minus treble {np.median(per_bar):+.1f} dB (median of {len(per_bar)} bars)")
