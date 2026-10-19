"""An independent reference for checking alignments: when the singer's pitch moves to each new note
(legato notes a semitone or more apart), from pyin on the isolated vocal track, smoothed over one vibrato cycle.
Writes analysis/X/truth.json. Usage: .venv/bin/python pitch_truth.py analysis/X
(about 3.5 GB peak for 6 minutes of singing: run it under guard.sh)"""
import json, sys, warnings
import librosa
import numpy as np

warnings.filterwarnings("ignore")
work = sys.argv[1]
s = json.load(open(f"{work}/score-notes.json"))
al = json.load(open(f"{work}/alignment.json"))
a = np.array(al["onsets"])
T = lambda q: float(np.interp(q, a[:, 0], a[:, 1]))
notes = sorted([n for n in s["notes"] if n["part"] == s.get("voicePart", 0)], key=lambda n: n["qOn"])
y, sr = librosa.load(f"{work}/sep/htdemucs/music/vocals.wav", sr=16000, mono=True)
f0, voiced, _ = librosa.pyin(y, fmin=150, fmax=1300, sr=sr, frame_length=2048, hop_length=160)
pitch = np.where(voiced, librosa.hz_to_midi(f0), np.nan)
smooth = np.nanmedian(np.lib.stride_tricks.sliding_window_view(np.pad(pitch, 7, constant_values=np.nan), 15), axis=1)
tt = al.get("musicStart", 0.0) + np.arange(len(smooth)) * 0.01
dist = lambda x, p: np.abs((x - p + 6) % 12 - 6)
out = []
for prev, n in zip(notes, notes[1:]):
    if n["qOn"] - prev["qOff"] > 0.05 or abs(n["pitch"] - prev["pitch"]) < 1:
        continue
    expected = T(n["qOn"])
    idx = np.nonzero((tt > expected - 1.2) & (tt < expected + 1.2))[0]
    closer = ~np.isnan(smooth) & (dist(smooth, n["pitch"]) < dist(smooth, prev["pitch"])) & (dist(smooth, n["pitch"]) < 1.2)
    starts = [j for j in idx if closer[j] and closer[j : j + 8].all() and not closer[j - 1]]
    if starts:
        out.append({"q": n["qOn"], "t": round(float(tt[min(starts, key=lambda k: abs(tt[k] - expected))]), 3)})
json.dump(out, open(f"{work}/truth.json", "w"))
print(f"{len(out)} pitch-change note starts measured → {work}/truth.json")
