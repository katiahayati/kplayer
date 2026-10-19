"""The singer's pitch and level every 0.2 s around a moment, from the isolated vocal track.
A rise out of near-silence is an entry; a pitch change is a new note.
Usage: .venv/bin/python pitch_at.py analysis/X START_SECONDS DURATION_SECONDS [VOCALS_OFFSET]
VOCALS_OFFSET is where vocals.wav starts in the recording (the music start); default: from alignment.json."""
import json, sys
import librosa
import numpy as np

work, t0, dur = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
offset = float(sys.argv[4]) if len(sys.argv) > 4 else json.load(open(f"{work}/alignment.json")).get("musicStart", 0.0)
y, sr = librosa.load(f"{work}/sep/htdemucs/music/vocals.wav", sr=16000, mono=True, offset=max(0, t0 - offset), duration=dur)
f0, voiced, _ = librosa.pyin(y, fmin=150, fmax=1300, sr=sr, frame_length=2048, hop_length=160)
rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=160)[0]
tt = t0 + np.arange(len(f0)) * 0.01
midi = librosa.hz_to_midi(f0)
for t in np.arange(t0, t0 + dur, 0.2):
    k = (tt >= t) & (tt < t + 0.2)
    sung = k & voiced
    pitch = librosa.midi_to_note(int(round(np.nanmedian(midi[sung]))), unicode=False) if sung.any() else "—"
    print(f"{t:7.1f} s   voiced {voiced[k].mean():4.0%}   {pitch:>4}   {20 * np.log10(rms[k].mean() + 1e-9):5.0f} dB")
