---
name: learn-performance
description: Learn how a performer shapes a piece (basic tempo, rubato, accelerandos, broadenings, breaths) from a recording, and write it as a kplayer performance file to import. Use this whenever the user gives a recording (a YouTube link, an audio or video file) of a piece they have as MusicXML and wants kplayer to play it "like" that performer, wants to compare performers' tempi, or says a performance learned from a recording sounds wrong somewhere (an intro at half speed, "something weird happens in bar 83", a breath that isn't one, a section too fast). Also use it when aligning any recording to a score in this project.
---

# Learning a performance from a recording

Turn a recording of a piece into a kplayer performance file (`*.kplayer.json`, imported with **Import…**): the
performer's basic tempo, **Speed up / Slow down** sections between their tempo turning points, and **breaths** where
a singer steals time. The pipeline lives in this repo:

```
recording ──► tools/align_recording.py ──► alignment.json ─────────────┐
score.mxl ──► scripts/export-score.ts ──► score-notes.json             ├─► scripts/fit-performance.ts ──► performance file
  (song)  ──► Demucs ──► vocals.wav ──► tools/align_voice.py ──► voice.json ┘        │
                                                                          scripts/check-voice.ts (how close to the singer)
```

The user is a singer and musician. Talk in bars, beats, syllables and BPM, not in DTW paths or log tempo.

## Before you start: memory

This machine's WSL has about 5.8 GB of RAM. A job that decoded a 1.27 GB sound bank in one go crashed the whole
computer once. So run one heavy step at a time, under `scripts/guard.sh` (it kills the job above 4.8 GB used and
reports the peak), and check `free -m` first. Rough peaks: full alignment ~0.7 GB, voice alignment ~0.6 GB, Demucs
~2.8 GB on top of everything else (4.6 GB total in practice), fitting ~0.4 GB.

Setup, once: `npx -y npm@11 install` (the system npm 10.8.2 hangs here), then
`python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt`. For songs also
`.venv/bin/pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu && .venv/bin/pip install demucs==4.0.1`
(the default torch wheel pulls gigabytes of GPU libraries).

## The steps

Use a work folder `analysis/<short-name>/` (git-ignored). `G=.claude/skills/learn-performance/scripts`.

1. **Get the audio.** `yt-dlp -f bestaudio -o "%(title)s [%(id)s].%(ext)s" URL` into the project root (recordings
   there are git-ignored). Note the performers from the title.
2. **Export the score's notes:** `npx tsx scripts/export-score.ts score.mxl > analysis/X/score-notes.json`.
   Fingered tremolos are expanded and the vocal part is marked (`voicePart`).
3. **Align the whole recording:**
   `$G/guard.sh .venv/bin/python tools/align_recording.py analysis/X/score-notes.json REC analysis/X/alignment.json`.
   It prints where the music starts, the key shift and the tuning. A key shift other than 0 means the recording is
   transposed, which is fine. Then look at it: `.venv/bin/python $G/bar_tempos.py analysis/X` prints each bar's
   start time and tempo. Read "What can go wrong" before trusting it.
4. **For a song, isolate the voice** (skip for instrumental pieces). Cut from the music start the aligner printed:
   `ffmpeg -ss START -i REC -ac 2 -ar 44100 analysis/X/music.wav`, then
   `$G/guard.sh .venv/bin/python -m demucs.separate -n htdemucs --two-stems=vocals --segment 7 -o analysis/X/sep analysis/X/music.wav`
   (about 5 minutes for 7 minutes of music). If the model download fails with a DNS error, fetch
   `https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th` into
   `~/.cache/torch/hub/checkpoints/` with curl and rerun.
5. **Align the singer:**
   `$G/guard.sh .venv/bin/python tools/align_voice.py analysis/X/score-notes.json analysis/X/alignment.json analysis/X/sep/htdemucs/music/vocals.wav START analysis/X/voice.json`.
6. **Fit:** `npx tsx scripts/fit-performance.ts score.mxl analysis/X/alignment.json OUT.kplayer.json --performer "Name" --voice analysis/X/voice.json --curves analysis/X/curves.csv`
   (no `--voice` for instrumental pieces). It reports how far the file is from the recording at every note
   onset (a good fit: median ≈ 0.1 s, 90% within ≈ 0.3–0.4 s) and how jumpy its sections are.
   A faithful fit keeps the performer's local wobbles, which on piano can sound "crazy". When the user wants the
   big gestures and breaths without the futzing, refit with `--smooth 16 --turn 8 --tolerance 40 --sync 0.3`
   (four-bar smoothing, 8% turning points, no added detail, shape over exact timing). For Thielemann/Fleming that
   took 76 sections to 28 and beats changing >15% from 7 to 1, while drifting up to about 2 s from the recording
   locally. Six-bar smoothing (`--smooth 24 --turn 10`) began erasing real phrase shape. Plot both to compare.
7. **Check against the singer:** `npx tsx scripts/check-voice.ts score.mxl OUT.kplayer.json analysis/X/voice.json`
   gives the median and the bars more than 0.3 s off. Plot with `.venv/bin/python $G/plot_fit.py analysis/X`
   (writes `analysis/X/fit.png`; look at it with Read). Real shaping is smooth phrase-level waves; spikes of ±30%
   within a beat are worth a look.
   Then check against evidence the alignment didn't produce. `$G/guard.sh .venv/bin/python $G/pitch_truth.py analysis/X`
   measures when the singer's pitch moves to each new note, and
   `npx tsx $G/check_against_pitch.mts score.mxl analysis/X OUT.kplayer.json` scores the alignments and the file
   against it, with the file started together with the recording at bar 1, the way the user plays along. Good
   results so far: singer alignment median ≈ 0.04–0.07 s, file ≈ 0.1 s, 90% within ≈ 0.35–0.4 s. For passages with
   no singing (an orchestral opening), `.venv/bin/python $G/pulse_grid.py analysis/X/sep/htdemucs/music/no_vocals.wav
   START END SUB` finds the steady tempo that best fits the attacks, where SUB is the attacks per quarter note in the
   texture (six in a sextuplet figuration). Times are seconds into `no_vocals.wav`, which starts at the music start.
8. **Compare performers**, if there's more than one: `.venv/bin/python $G/compare.py analysis/A analysis/B -- 1-11 12-20 …`
   prints each performance's average tempo for the bar ranges you give (pick the score's sections or phrases).
9. **Deliver** the file to the project root as `<score>.<performer>.kplayer.json` (not committed unless asked). Tell
   the user that importing replaces their current phrasing for that score (Export JSON first to keep it, or Ctrl+Z).
   Summarize the performer's shaping musically: basic tempo, where they broaden or press, the breaths (bar,
   syllable, milliseconds), and how close the file gets.

## What can go wrong, and how to see it

These all happened on real recordings; each check takes seconds.

- **The opening is stretched** (the user hears the intro "in half time"). Recordings often start with silence and
  then seconds of hiss before the first chord. `align_recording.py` skips both by measuring the noise floor, but
  check the printed start and `bar_tempos.py`: bar 1 should look like its neighbours, not half their tempo. To
  check by ear, compare with the level in the first seconds after the printed start.
- **Bars at exactly the written tempo, then a spike** (e.g. 60.0 then 150 BPM). Long held chords give the aligner
  nothing to anchor to. The two-pass alignment exists for this; if it persists locally, suspect that passage.
- **Same-pitch boundaries.** Where a singer holds a note into a written rest and re-enters on the same pitch, pitch
  content can't show the new note. `align_voice.py` snaps such entries to the clearest re-attack. If a bar still
  sounds off, look at the singer directly: `.venv/bin/python $G/pitch_at.py analysis/X START_S DURATION_S` prints
  her pitch and level every 0.2 s. A rise out of near-silence is the entry.
- **"Breaths" that aren't.** A breath is a small broaden of the tempo from the note before to the note after; only
  time the singer has to steal counts (punctuation with the next sung note straight after). Time taken in a rest,
  or by cutting a note short, is the conductor's tempo and belongs to the sections. The fitter already works this
  way; keep it so.
- **"Something weird in bar N"**: run `npx tsx $G/inspect_bars.mts score.mxl OUT.kplayer.json analysis/X FIRST LAST`.
  It lists each sung note's time from the full-score alignment, from the singer, and in the file, plus the gestures
  touching those bars. A singer time far from the full-score one at an entry usually means the full-score alignment
  is wrong there (the orchestra had no clear landmark), not the singer.
- **Is the alignment right at all?** Spot-check a passage independently: pitch-track the singer (`pitch_at.py`)
  and compare her note starts with `voice.json`. In earlier checks, the voice alignment was within about 0.06 s of
  pitch-measured note starts.
- **"It used to line up and now it doesn't"**: first ask about the **Tempo** slider in the top bar. It scales the
  whole file, and lowering it by mistake made a correct file sound badly aligned once. Then compare the way they
  listen: both started at bar 1 (`check_against_pitch.mts`), not lined up by the median (`check-voice.ts`), which
  hides constant offsets.
- **User disagrees with a tempo** ("it zips along at 88–90"): measure, don't argue. Time a stretch between two sung
  notes from the pitch track (beats ÷ seconds × 60) and give them timestamps to check with a stopwatch. The user
  was wrong once and right once (the intro), so check either way.

## Why the fitter works the way it does

Read `NOTES.md` ("Aligning recordings") for the background. In short: tempo is fitted on a smoothed curve, then the
levels at the turning points are solved so the file stays in sync with the recording at every turning point
(cumulative time, not per section, or one miss shifts everything after it). Levels stay within 15% of the measured
shape so local noise can't make wild swings. Each section stores the tempo it arrives at as a fraction of the basic
tempo (`target`), not a change from the one before, so the user can delete sections without moving the rest.
Targets may go from 20% to 4× the basic tempo, because real performances go that far (40 → 83 BPM within three bars). If you change the fitter, rerun
`npx vitest run` and the steps above on a recording you have already checked, and compare the reports.
