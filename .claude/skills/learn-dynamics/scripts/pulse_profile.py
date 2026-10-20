"""How a pianist weights the beats of the bar: the attack strength at each sixteenth of the bar in a
recording's piano, against a flat render of the same score (so the texture itself, which hand plays
where, cancels out).

  pulse_profile.py score-notes.json alignment.json STEM STEM_START RENDER.wav RENDER-timing.json
                   [--part 1] [--bars 1-18,29-37] [--voice-part 0]

STEM is the recording's piano (Demucs's no_vocals.wav), starting STEM_START seconds into the aligned
recording. RENDER is `scripts/render-audio.ts … --flat --parts 1 --timing RENDER-timing.json` with the
recording's fitted timing. --bars picks bars with one running texture (positions in a bar only compare
within one). --voice-part leaves out attacks within a sixteenth of a sung note, whose bleed into the
stem would otherwise look like an accent.

Attack strength is the peak of librosa's spectral flux near the aligned onset, below 300 Hz (the bass)
and above (the right hand), relative to the median over the bar around it. Prints, for each sixteenth
of the bar where notes start, recording minus render (log flux; positive = struck harder than its
neighbours, compared with the flat render), ± one standard deviation over bars. To turn it into
decibels, render with a known accent (a pulse rule) and measure that the same way: in kplayer's synth,
6 dB moved the bass about 0.4 and the treble about 0.7. A real piano's harder attacks are also
brighter, so converted numbers are upper bounds.
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


part = int(opt("part", 1))
voice_part = opt("voice-part", None)
bar_spec = opt("bars", None)
notes_path, align_path, stem, stem_start, render, render_timing = args
score = json.load(open(notes_path))
measures = score["measures"]
bars = set(range(len(measures)))
if bar_spec:
    bars = set()
    for r in bar_spec.split(","):
        a, _, b = r.partition("-")
        bars |= set(range(int(a) - 1, int(b or a)))
sung = [n["qOn"] for n in score["notes"] if voice_part is not None and n["part"] == int(voice_part)]
onsets = sorted({round(n["qOn"], 4) for n in score["notes"] if n["part"] == part})


def bar_of(q):
    return next(i for i, m in enumerate(measures) if q < m["q1"] - 1e-6 or i == len(measures) - 1)


def attacks(wav, timing, start):
    """Each onset's flux peak (overall, low, high), searched around the aligned time plus the flux's lag."""
    al = json.load(open(timing))
    qs = np.array([o[0] for o in al["onsets"]])
    ts = np.array([o[1] for o in al["onsets"]]) - start
    y, sr = librosa.load(wav, sr=22050, mono=True)
    hop = 128
    cut = int(np.searchsorted(librosa.mel_frequencies(n_mels=128, fmax=sr / 2), 300))
    bands = librosa.onset.onset_strength_multi(y=y, sr=sr, hop_length=hop, channels=[0, cut, 128])
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    times = librosa.times_like(env, sr=sr, hop_length=hop)

    def peaks(lag):
        out = {}
        for q in onsets:
            t = float(np.interp(q, qs, ts))
            w = (times >= t + lag - 0.04) & (times <= t + lag + 0.04)
            if w.any() and t >= 0.05:
                k = int(np.argmax(np.where(w, env, -1)))
                out[q] = (t, float(times[k]), max(bands[0][k], 1e-3), max(bands[1][k], 1e-3))
        return out

    lag = float(np.median([v[1] - v[0] for v in peaks(0.0).values()]))
    return {q: v[2:] for q, v in peaks(lag).items()}


def relative(att, band):
    qs = np.array(sorted(att))
    lf = np.log([att[q][band] for q in qs])
    return {q: lf[i] - np.median(lf[(qs >= q - 3) & (qs < q + 3)]) for i, q in enumerate(qs)}


rec = attacks(stem, align_path, float(stem_start))
ren = attacks(render, render_timing, 0.0)
rng = np.random.default_rng(1)
for band, name in [(0, "bass (below 300 Hz)"), (1, "right hand (above 300 Hz)")]:
    a, b = relative(rec, band), relative(ren, band)
    by_slot = {}
    for q in a:
        bar = bar_of(q)
        if q not in b or bar not in bars or any(abs(q - s) < 0.25 for s in sung):
            continue
        slot = round((q - measures[bar]["q0"]) * 4)
        by_slot.setdefault(slot, {}).setdefault(bar, []).append(a[q] - b[q])
    slots = sorted(s for s, v in by_slot.items() if len(v) >= 3)
    mean = lambda bs: np.array([np.mean([x for bar in bs for x in by_slot[s].get(bar, [])] or [np.nan]) for s in slots])
    used = sorted(bars)
    d = mean(used)
    centre = np.nanmean(d)
    sd = np.nanstd([mean(list(rng.choice(used, len(used)))) - centre for _ in range(150)], axis=0)
    print(f"{name}: sixteenth of the bar (from 0), recording minus render")
    for s, v, e in zip(slots, d - centre, sd):
        print(f"  {s:3d}  {v:+.2f} ± {e:.2f}  ({sum(len(x) for x in by_slot[s].values())} attacks)")
