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
| Click a note, press **B** | Breathe after it: a small broaden from that note to the next one, slowest at the breath |
| Click a note, shift-click another | Select a section, then choose **Slow down**, **Speed up**, **Broaden**, **Push forward** or **A tempo** |
| "Use the score's N breath marks" | Turn the breath marks already written in the score into real breaths |
| Select a breath or section, press **L** | Loop from a measure before to a measure after it, while you adjust its sliders |
| **E** | Compare with and without your phrasing |
| **Space**, double-click a note | Play/pause, play from that note |
| Click the tempo lane | Seek; select the gesture under the cursor |
| **Ctrl+Z** / **Ctrl+Shift+Z** | Undo / redo |

- A breath is set by **extra time** (e.g. 300 ms). The tempo eases down through the note before the breath, is
  slowest at the breath, and eases back up through the note after it. Everything outside those two notes stays in
  tempo, and anything held across the breath sustains. "Note" means notehead: after a tied note, only its last
  notehead broadens. If the two notes are too short for the time you ask for, kplayer says so.
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
the tempo and its rate of change stay continuous. A breath is a smooth dip from the note before it to the note after,
sized so those notes take exactly the extra time longer. There are no pauses: every note-on and note-off goes through
the same T, so notes can only stretch with the curve, never get cut short. The timed performance is written as a
fixed-tempo MIDI file and played by SpessaSynth. Verovio renders the score and gives each note its *q*.

Code map: `src/perf/` holds the timing engine (pure TypeScript, tested), `src/score/` the Verovio loading and score
view, `src/audio/` the synth wrapper, and `src/ui/` the panels. See `NOTES.md` for findings about the libraries.

## Learning a performance from a recording

kplayer can listen to a recording of the piece and write a performance file with the performer's tempo shaping:
their basic tempo, **Speed up** / **Slow down** sections between their tempo turning points, and **breaths** where
the singer takes extra time at a phrase end. Import the result with **Import…**.

```sh
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt   # once
npm run export-score -- song.mxl > /tmp/song-notes.json
.venv/bin/python tools/align_recording.py /tmp/song-notes.json recording.webm /tmp/alignment.json
npm run fit-performance -- song.mxl /tmp/alignment.json song.performer.kplayer.json --performer "Performer"
```

For a song, it can follow the singer more closely. Isolate the voice with [Demucs](https://github.com/facebookresearch/demucs),
align the score's vocal line to it, and pass the result to the fit:

```sh
.venv/bin/pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu && .venv/bin/pip install demucs==4.0.1   # once
ffmpeg -ss START -i recording.webm -ac 2 -ar 44100 /tmp/music.wav     # START: where the music begins (printed by the aligner)
.venv/bin/python -m demucs.separate -n htdemucs --two-stems=vocals --segment 7 -o /tmp/sep /tmp/music.wav
.venv/bin/python tools/align_voice.py /tmp/song-notes.json /tmp/alignment.json /tmp/sep/htdemucs/music/vocals.wav START /tmp/voice.json
npm run fit-performance -- song.mxl /tmp/alignment.json song.performer.kplayer.json --performer "Performer" --voice /tmp/voice.json
npm run check-voice -- song.mxl song.performer.kplayer.json /tmp/voice.json   # how closely a file follows the singer
```

Demucs needs about 4.5 GB of memory for a 7-minute song.

The aligner ([synctoolbox](https://github.com/meinardmueller/synctoolbox)) lines the recording up with the score
note by note: any key or tuning difference, and silence at either end, are handled. The fitting step then checks
the result with kplayer's own timing engine and prints how closely it follows the recording. The score must match
the recording's music: the same cuts, repeats and notes, though a piano reduction of an orchestral piece works fine.

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
