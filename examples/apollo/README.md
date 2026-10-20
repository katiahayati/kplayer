# Example: Strauss, *Gesang der Apollopriesterin*, Op. 33 No. 2

A song for soprano and orchestra (text by Emanuel von Bodman), here as a piano reduction with the vocal line on its
own staff: `apollo-learning.mxl`. The performance files beside it were learned from two recordings with kplayer's
tools, and the voicing comes from reading Strauss's full score.

## Try it

1. Open `apollo-learning.mxl` in kplayer.
2. **Import…** one of the `.kplayer.json` files to hear that tempo shaping (it replaces your current phrasing; Export
   JSON first to keep it).
3. Or keep your own phrasing and use **Import voicing…** in the Dynamics panel with `apollo-learning.voicing.json`
   or one of the `-dynamics` files, which brings in only the dynamics.

Press **E** to compare with and without the tempo shaping, **D** with and without the dynamics.

## The files

| File | What it is |
|---|---|
| `apollo-learning.thielemann.kplayer.json` | Christian Thielemann's tempo (with Renée Fleming), fitted to the whole orchestra: ♩ = 73, 57 sections, 4 breaths |
| `apollo-learning.thielemann-sung.kplayer.json` | The same recording, following the singer: Fleming's timing at every sung note, 76 sections, 3 breaths |
| `apollo-learning.thielemann-smooth.kplayer.json` | Four-bar smoothing of the sung version: the big gestures and the breaths without the local wobbles, 28 sections |
| `apollo-learning.lott.kplayer.json` | Felicity Lott's recording: ♩ = 64, 64 sections, 2 breaths |
| `apollo-learning.voicing.json` | The voicing alone (see below), over the score's own dynamics |
| `apollo-learning.thielemann-dynamics.kplayer.json` | The smooth Thielemann tempo, plus the voicing and Thielemann's dynamic shape |
| `apollo-learning.lott-dynamics.kplayer.json` | Lott's tempo, plus the voicing and the dynamic shape of her recording |

The recordings: Thielemann/Fleming, <https://www.youtube.com/watch?v=t4HcMzqAOtQ>; Lott,
<https://www.youtube.com/watch?v=l1yR-qsf7o8>. A faithful fit keeps the performers' local tempo wobbles (some of them
the orchestra catching up with the singer), which on piano can sound erratic; the smooth version is the one to
rehearse with.

## The voicing

Verovio plays every note at one level, so a reduction's pianissimo tremolo comes out as loud as its melody. The
voicing gives each strand of the texture its own level, named after what the orchestra plays (from the full score
on [IMSLP](https://imslp.org/wiki/4_Gesänge,_Op.33_(Strauss,_Richard))):

- the strings' pulse of repeated chords, kept back;
- the muted cellos' sextuplet figure (bars 1–26, 40–42) and the timpani rolls (bars 78, 88–99), a soft blanket;
- the string section's tremolo at the climaxes (bars 64–69, 107–112), present but under the tune;
- the top moving line of the right hand (the brass fanfares, the solo violin, the clarinet, the cellos' line),
  brought out and sounding slightly ahead;
- a few bars where the reduction moves a line to the other hand (the trombones in bar 7, for example).

Pedal changes with the harmony. Rendered and measured, the melody comes out on top in 94 of 105 bars, by a median
of about 4 dB. The `-dynamics` files add each conductor's dynamic shape, fitted to the recording's loudness beat by
beat (within about 2 dB).

## How they were made

With the steps in the main README ("Learning a performance from a recording"): synctoolbox to align the recordings
to the score, Demucs to isolate the voice, `fit-performance` for the tempo, `dynamics_arc.py` and `fit-dynamics` for
the dynamic shape, and `voice-balance` to check the voicing. The `learn-performance`, `learn-dynamics` and
`expressive-piano` skills in `.claude/skills` walk through all of it.
