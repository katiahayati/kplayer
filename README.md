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
| **D** | Compare with and without dynamics |
| **Space**, double-click a note | Play/pause, play from that note |
| Click the tempo lane | Seek; select the gesture under the cursor |
| **Ctrl+Z** / **Ctrl+Shift+Z** | Undo / redo |

- A breath is set by **extra time** (e.g. 300 ms). The tempo eases down through the note before the breath, is
  slowest at the breath, and eases back up through the note after it. Everything outside those two notes stays in
  tempo, and anything held across the breath sustains. "Note" means notehead: after a tied note, only its last
  notehead broadens. If the two notes are too short for the time you ask for, kplayer says so.
- Clicking near a note or rest selects it, so you don't have to hit the inked part of a hollow notehead or a thin
  rest.
- **Slow down** / **Speed up** arrive at a tempo you set as a percentage of the basic tempo (the written tempo times
  the **Tempo** slider), e.g. "Slow down to 85%", and hold it until the next section; **A tempo** goes back to 100%.
  Because a section isn't relative to the one before it, changing or deleting an earlier rit. never moves the later
  ones. (Files from before this change are converted when loaded and play as they did.) **Broaden** and **Push forward** return by
  the end of the section. With the peak at 100% plus some "settle after" time, the next phrase starts from the
  broadened tempo and gathers itself.
- For a Broaden or Push forward you can pick the exact note its **peak** arrives on, and a note to **hold** the peak
  tempo **until**. For example: start at the rest, peak on a long held note, hold it until the next syllable, then
  ease back to tempo by the end of the phrase.
- **Dynamics.** Verovio's MIDI plays every note at one level; kplayer plays the score's written dynamics and
  hairpins instead, for every staff of the part they're written in. A **voicing** goes on top, in the **Dynamics**
  panel: strands of the texture (a melody, a tremolo blanket, repeated chords, the bass), each picked by staff, voice,
  note length, top or bottom of the chord, tremolo, and bars, with its own level in dB. Click a voice to light up its
  notes in the score; click a note to see its voice and velocity. A voice can sound slightly **ahead** (as a pianist
  brings out a tune) or vary a little in level and timing (so a tremolo shimmers). Sustain pedal can change with the
  harmony. **Import voicing…** takes the dynamics from a file without touching your tempo phrasing.
- Your work autosaves in the browser for each score. **Export JSON** saves it as a file you can import later.
  **Export MIDI** writes the timed performance for use elsewhere.

## Deploying

kplayer builds to static files (`npm run build` → `dist/`), so any web host can serve it. `npm run deploy` builds and
uploads with rsync over ssh to `KPLAYER_DEPLOY` (default: the author's site; set it to your own `host:folder/kplayer/`).
Add `-- --dry-run` to see what would change first. The sound banks (about 160 MB) go up with it and are downloaded by
each visitor's browser the first time they play.

## Example

[`examples/apollo`](examples/apollo) has a full song to try: Strauss's *Gesang der Apollopriesterin* as a piano
reduction, with tempo shaping learned from two recordings (Thielemann/Fleming and Felicity Lott), a voicing taken
from the full score, and each conductor's dynamic shape.

## How it works

Every note has a score position *q* (in quarter notes). Performance time is

T(q) = ∫ 60 / (B(q) · e^L(q)) dq

where B is the written tempo and L sums every gesture in log-tempo space. Sections are built from smootherstep, so
the tempo and its rate of change stay continuous. A breath is a smooth dip from the note before it to the note after,
sized so those notes take exactly the extra time longer. There are no pauses: every note-on and note-off goes through
the same T, so notes can only stretch with the curve, never get cut short. The timed performance is written as a
fixed-tempo MIDI file and played by SpessaSynth. Verovio renders the score and gives each note its *q*.

Dynamics work in MIDI velocity (written markings are MuseScore's velocities: pp 32, p 49, mf 72, f 88 …), and a
voice's level is in decibels relative to that: a SoundFont synth plays velocity v at 40·log10(v/127) dB, so −6 dB is
the same step at pp as at ff. `src/perf/dynamics.ts` reads each note's staff and voice from Verovio's MEI.

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

A faithful fit keeps every local tempo wobble, which can sound erratic on piano. For a calmer version that keeps the
big gestures and the breaths, add `--smooth 16 --turn 8 --tolerance 40 --sync 0.3`: four-bar smoothing, turning
points only for changes of 8% or more, no extra detail, and shape preferred over exact timing. The fit reports how
jumpy the sections are (the largest one-beat change, and how many beats change by more than 15%).

### Dynamics from a recording

The same alignment gives the conductor's dynamic shape: how loud the music is from moment to moment. Measure the
accompaniment (for a song, Demucs's `no_vocals.wav`) beat by beat, then fit: kplayer renders the piano offline
through its own synth, compares its loudness with the recording's (each relative to its median), and adjusts a
level every half bar until they match, keeping your voicing's balance on top.

```sh
.venv/bin/python tools/dynamics_arc.py /tmp/alignment.json /tmp/sep/htdemucs/music/no_vocals.wav START /tmp/arc.json
npm run fit-dynamics -- song.mxl song.performer.kplayer.json /tmp/arc.json voicing.json song.performer-dynamics.kplayer.json --part 1
npm run voice-balance -- song.mxl song.performer-dynamics.kplayer.json   # is the melody on top, bar by bar?
npm run render-audio -- song.mxl song.performer-dynamics.kplayer.json out.wav   # listen outside the browser
```

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

## License

MIT (see `LICENSE`). The sound banks are fetched separately and keep their own licences (above).
