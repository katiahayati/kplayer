---
name: learn-dynamics
description: Learn how a performer shapes loudness from a recording and put it into kplayer. Covers the dynamic arc beat by beat (a conductor's or a pianist's), how the pianist weights the beats of the bar (the pulse), and how bass-heavy the piano sounds; then writes performance files that combine a recording's tempo with its dynamics. Use whenever the user wants kplayer's dynamics or pulse "like" a recording, asks how a pianist or conductor shapes a passage, wants to compare performers' dynamics, or says a learned dynamic shape sounds wrong somewhere. It runs after learn-performance has aligned the recording, and needs a voicing (expressive-piano).
---

# Learning dynamics from a recording

kplayer's loudness has two layers. The **levels** (marks and hairpins: the arc of the piece) come from the
score, or are learned here. The **voicing** (which strands lead, the pulse, the pedal) comes from the
expressive-piano skill and is kept as is. This skill learns from a recording:
- the arc;
- the pulse, to check or set the voicing's pulse rules;
- the bass-to-treble balance, to check the voicing.

The user is a singer and musician. Talk in bars, beats and dB, and compare with what the composer wrote.

## Before you start

- Work through steps 1–6 of the **learn-performance** skill first. They give:
  - the alignment (`analysis/X/alignment.json`);
  - for a song, the Demucs stems (`analysis/X/sep/htdemucs/music/no_vocals.wav` is the piano or orchestra);
  - a performance file with the recording's timing (`fit.kplayer.json`).
- Make a voicing with the **expressive-piano** skill. The fit keeps its balance and only learns the levels.
- `G=.claude/skills/learn-performance/scripts` (for `guard.sh`), `L=.claude/skills/learn-dynamics/scripts`.
- Memory: a fit or a render peaks around 3.5–4 GB on this machine. Run one at a time under `$G/guard.sh`, and
  stop the dev server first if `free -m` shows less than about 2.5 GB available.

## Steps

1. **The arc.** Measure the accompaniment's loudness per beat:
   `$G/guard.sh .venv/bin/python tools/dynamics_arc.py analysis/X/alignment.json analysis/X/sep/htdemucs/music/no_vocals.wav START analysis/X/arc.json`.
   START is where the stem starts in the recording: the music start it was cut from, or 0 for an
   instrumental recording itself.

2. **Fit it.**
   `$G/guard.sh npx tsx scripts/fit-dynamics.ts score.mxl analysis/X/fit.kplayer.json analysis/X/arc.json voicing.json analysis/X/dyn.kplayer.json --part 1 --source "Name"`
   takes about a minute. It renders the piano through kplayer's synth and sets a level every half bar, until
   the render's loudness follows the recording's (each relative to its median). It keeps the voicing's
   voices, pulse and pedal, and replaces its marks and hairpins.
   - How far the written levels are from the recording's shape: about 8 dB rms for Apollo's orchestra, and
     5 dB from the print's marks to Keval Shah's piano in *Var det en dröm?*.
   - After fitting, expect about 1–2 dB.
   - Recordings' ranges differ a lot: Thielemann 19 dB, Lott 30 dB, Forsberg about 35 dB (2nd–98th
     percentile).

3. **Read the result against the score:**
   `npx tsx $L/compare_levels.mts score.mxl voicing.json analysis/X/dyn.kplayer.json …` shows each file's
   level at the bar line and halfway through.
   - Bengt Forsberg followed Sibelius's marks closely with a wider range.
   - Shah played flatter. His pp shimmer came out louder than the print's pp, partly because a real piano's
     top register carries more than the synth's at the same loudness. Mention that kind of difference rather
     than presenting it as the pianist's intent.
   - Things to know:
     - **A piano can't swell a held note**, so only beats where the piano strikes count. Otherwise the fit
       chases the orchestra's sustain with ever louder attacks.
     - **Reductions copy dynamics from some instruments**, so the reduction can say pp where the orchestra
       plays out (Apollo bars 8–11, 87–88). Before blaming the stem for vocal leakage, measure the vocals stem
       too: if the singer is silent there, the orchestra really is loud.
     - Levels stay within velocity 10–120. A fit pinned at 120 (Forsberg's climaxes) means the recording's
       range is wider than the synth's.
     - Renders must not be normalised, and must start at the score's start (the core sequencer skips to the
       first note unless told not to before loading). `scripts/lib/render.ts` handles both.

4. **The pulse.** The arc is measured over 400 ms windows, too coarse to show how individual beats are
   struck. Use the piano stem's attacks instead:
   - Render the piano flat with the recording's timing:
     `$G/guard.sh npx tsx scripts/render-audio.ts score.mxl analysis/X/fit.kplayer.json analysis/X/flat.wav --flat --parts 1 --timing analysis/X/flat-timing.json`.
   - Then run
     `.venv/bin/python -I $L/pulse_profile.py analysis/X/score-notes.json analysis/X/alignment.json analysis/X/sep/htdemucs/music/no_vocals.wav START analysis/X/flat.wav analysis/X/flat-timing.json --bars 1-18,29-37 --voice-part 0`.
     It prints, for each sixteenth of the bar, how much harder the recording's attacks are than the render's,
     separately below and above 300 Hz.
   - Pick `--bars` with one running texture.
   - **Compare positions that share a texture.** In *Var det en dröm?* the left hand starts a three-eighth
     group on beats 1 and 4 and halfway through each, on the same bass note. Both pianists struck the
     big-beat ones clearly harder. The right hand's beat starts showed only a small lift at beat 4.
   - Turn the numbers into decibels with a render that has a known pulse. Measure a pulse voicing such as
     `{"voices": [], "pulse": [{"id": "b", "select": {"part": 1, "staff": [2]}, "every": 3, "gainDb": 6}]}`
     the same way. In kplayer's synth, 6 dB moved the bass about 0.4 and the treble about 0.7. A real piano's
     harder attacks are also brighter, so read converted values as upper bounds.
   - Traps, all met on real recordings:
     - **The synth's timbre differs from a piano's by register**, so one position of a figure can look
       accented in both recordings when it isn't (a second sixteenth did, by +0.3).
     - **The singer bleeds into the stem**, and new syllables cluster on some beats. `--voice-part` leaves
       out attacks within a sixteenth of a sung note; rerun with and without it.
     - **A note doubled in the render** fakes a contrast. Shared noteheads used to sound twice, and are now
       merged.
   - Timing pulses (a lean on the big beats) can be measured from the attack times too. Shah's beats 1 and 4
     ran 3–4% long, but with a ±3% error. Report a timing lean only if it's clearly larger than its error.

5. **Balance.** Measure how bass-heavy the voicing is against the recordings:
   `.venv/bin/python -I $L/balance.py analysis/X/score-notes.json --bars … REC_STEM analysis/X/alignment.json START RENDER.wav RENDER-timing.json 0`.
   Two pianists in one song measured −7.5 and −1.9 dB (bass minus treble), mostly from microphones and rooms,
   so aim a voiced render between them, not at one. Adjust the left hand's voice level, then check it again.

6. **Deliver** `<score>.<performers>.kplayer.json` in the project root (not committed unless asked).
   Combine the smoothed tempo file from learn-performance with the fitted dynamics:
   `doc = smooth.kplayer.json; doc["dynamics"] = dyn.kplayer.json["dynamics"]`, adding an `about` line that
   says whose shape it is.
   - Check it with `npx tsx .claude/skills/expressive-piano/scripts/check_voicing.mts score.mxl FILE`.
   - Tell the user that importing it replaces their phrasing (Export JSON first, or Ctrl+Z). Importing a file
     with no dynamics keeps the voicing they have. **Import voicing…** with the same file takes only its
     dynamics.
   - Summarise each performer's shape musically: where they build, how loud the climaxes are against the
     print, how soft the soft passages, and the pulse you measured.
