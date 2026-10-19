# kplayer

A lightweight score player for rehearsing with expressive timing. Load a MusicXML score, then mark where you breathe
and where phrases slow down, speed up, broaden or push forward. The accompaniment follows with smooth tempo curves,
never abrupt steps. The score file is never modified; your phrasing is saved separately.

## Setup

```sh
npx -y npm@11 install        # the system npm 10.8.2 hangs on these packages
npm run fetch-soundfont      # sound banks (~80 MB download) → public/soundfonts/
npm run dev                  # then open http://localhost:5173 in your browser
```

Export your score from MuseScore or Sibelius as MusicXML (`.musicxml` or `.mxl`).

## Using it

| Do this | To |
|---|---|
| Click a note, press **B** | Breathe after it: that note is held a little longer, everyone waits, and the next note comes in on tempo |
| Click a note, shift-click another | Select a section, then choose **Slow down**, **Speed up**, **Broaden**, **Push forward** or **A tempo** |
| "Use the score's N breath marks" | Turn the breath marks already written in the score into real breaths |
| Select a breath or section, press **L** | Loop from a measure before to a measure after it, while you adjust its sliders |
| **E** | Compare with and without your phrasing |
| **Space**, double-click a note | Play/pause, play from that note |
| Click the tempo lane | Seek; select the gesture under the cursor |
| **Ctrl+Z** / **Ctrl+Shift+Z** | Undo / redo |

- A breath is set by **extra time** (e.g. 300 ms). Only the note before the breath stretches. Anything the piano
  plays under that note stretches evenly with it, and anything held across it sustains. The music is in tempo right
  up to that note and from the next note on. A note can stretch to at most 4× its length; past that, kplayer says so.
- Clicking near a note or rest selects it, so you don't have to hit the inked part of a hollow notehead or a thin
  rest.
- **Slow down** / **Speed up** hold their new tempo until an **A tempo**. **Broaden** and **Push forward** return by
  the end of the section. With the peak at 100% plus some "settle after" time, the next phrase starts from the
  broadened tempo and gathers itself.
- For a Broaden or Push forward you can pick the exact note its **peak** arrives on, and a note to **hold** the peak
  tempo **until**. For example: start at the rest, peak on a long held note, hold it until the next syllable, then
  ease back to tempo by the end of the phrase.
- Your work autosaves in the browser for each score. **Export JSON** saves it as a file you can import later.
  **Export MIDI** writes the timed performance for use elsewhere.

## How it works

Every note has a score position *q* (in quarter notes). Performance time is

T(q) = ∫ 60 / (B(q) · e^L(q)) dq

where B is the written tempo and L sums every gesture in log-tempo space. Sections are built from smootherstep, so
the tempo and its rate of change stay continuous. A breath is a constant slowdown over just the note before it,
sized so that note takes exactly the extra time longer. There are no pauses: every note-on and note-off goes through
the same T, so notes can only stretch with the curve, never get cut short. The timed performance is written as a
fixed-tempo MIDI file and played by SpessaSynth. Verovio renders the score and gives each note its *q*.

Code map: `src/perf/` holds the timing engine (pure TypeScript, tested), `src/score/` the Verovio loading and score
view, `src/audio/` the synth wrapper, and `src/ui/` the panels. See `NOTES.md` for findings about the libraries.

## Sounds

- Piano: [YDP Grand Piano](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html) by FreePats, built from Zenph
  Studios' Yamaha Disklavier Pro samples, [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- Everything else: [MuseScore General](https://musescore.org/en/handbook/3/soundfonts-and-sfz-files) by S. Christian
  Collins, MIT license.

The piano bank is layered over MuseScore General and replaces only its acoustic grand. If the piano file is missing,
playback falls back to MuseScore General's piano.

## Tests

```sh
npm test          # timing engine, the Verovio → MIDI pipeline on fixtures/song.musicxml, and a UI smoke test
npm run typecheck
```
