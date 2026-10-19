"""The steady tempo that best fits a stretch of audio, measured from its attacks alone (no score alignment):
slides a pulse grid with SUB attacks per quarter note over the onset strength. Use it to check a passage
with a regular figuration (e.g. six notes per beat in an accompaniment) independently of the alignment.
Usage: .venv/bin/python pulse_grid.py AUDIO START_S END_S SUB   (AUDIO: e.g. analysis/X/sep/htdemucs/music/no_vocals.wav,
whose time 0 is the music start)"""
import subprocess, sys
import librosa
import numpy as np

path, t0, t1, sub = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4])
sr, hop = 22050, 128
raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t0), "-t", str(t1 - t0), "-i", path, "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                     capture_output=True, check=True).stdout
env = librosa.onset.onset_strength(y=np.frombuffer(raw, dtype=np.float32), sr=sr, hop_length=hop)
env = (env - env.mean()) / (env.std() + 1e-9)
fps, dur = sr / hop, len(env) / (sr / hop)


def fit(bpm):
    period = 60 / bpm / sub
    return max(env[(np.arange(phase, dur, period) * fps).astype(int)].mean() for phase in np.arange(0, period, 0.01))


bpms = np.arange(40, 130.01, 0.5)
vals = np.array([fit(b) for b in bpms])
best = np.argsort(-vals)[:4]
print(f"{t0:.1f}–{t1:.1f} s, {sub} attacks per quarter: best " + ", ".join(f"{bpms[i]:.1f} BPM (fit {vals[i]:.2f})" for i in best))
