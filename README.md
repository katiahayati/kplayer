# kplayer

A lightweight score player for rehearsing with expressive timing. Load a MusicXML score, then mark where you breathe
and where phrases slow down, speed up, broaden or push forward. The accompaniment follows with smooth tempo curves,
never abrupt steps. The score file is never modified; your phrasing is saved separately.

## Setup

```sh
npx -y npm@11 install        # the system npm 10.8.2 hangs on these packages
npm run fetch-soundfont      # sound banks → public/soundfonts/ (downloads ~530 MB once, builds the piano; needs ffmpeg)
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
| Untick a breath or section in the list | Hear the piece without it, keeping its settings (**Breaths** / **Sections** switch them all) |
| **D** | Compare with and without dynamics |
| **H** | Play in a concert hall, or dry (the slider beside **Hall** sets how much) |
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
  brings out a tune) or vary a little in level and timing (so a tremolo shimmers). A **pulse** adds a metric
  lean on top of the voices: the notes on chosen beats of the bar (the big beats of a 6/4 bar, say, or only beat 4)
  play a few dB louder, optionally fading over the beat; pulses add up, so the downbeat can weigh more than the
  others. Sustain pedal can change with the harmony, compared beat by beat (or by a longer beat, such as the dotted
  half of 6/4). Two voices sharing a notehead play as one note, as a pianist strikes the key once. **Import
  voicing…** takes the dynamics from a file without touching your tempo phrasing.
- Your work autosaves in the browser for each score. **Save piece…** writes it all to one `.kplayer` file, with the
  score inside: phrasing, voicing and dynamics, tempo and part mix. **Open…** it, on any computer, to get everything
  back (if this browser had its own version of that score, Ctrl+Z returns to it). **Export JSON** saves just your
  phrasing and dynamics, to **Import…** onto the same score; **Export MIDI** writes the timed performance for use
  elsewhere. In Chrome and Edge on a computer, saving opens the system's Save dialog, so you choose the folder and
  name and can replace an older copy; other browsers download the file.

## Deploying

kplayer builds to static files (`npm run build` → `dist/`), so any web host can serve it. `npm run deploy` builds and
uploads with rsync over ssh to `KPLAYER_DEPLOY` (default: the author's site; set it to your own `host:folder/kplayer/`).
Add `-- --dry-run` to see what would change first. The sound banks (about 113 MB) go up with it and are downloaded by
each visitor's browser as soon as the page opens, so they're ready by the time you press Play.

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

## Interpretation from recordings

[kespressivo](https://github.com/katiahayati/kespressivo), kplayer's companion, listens to recordings and writes how the
performers shape a piece (tempo sections, breaths, dynamics) as performance files to **Import…** here, and voices
piano parts expressively. It has an example: Strauss's *Gesang der Apollopriesterin* with performances learned from
two recordings.

## Sounds

- Piano: [Salamander Grand Piano V3](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm, a Yamaha C5
  recorded in stereo at 16 strike strengths, [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/). `npm run
  fetch-soundfont` builds kplayer's SoundFont from it (`scripts/build-piano.ts`): the softer you play, the darker the
  tone, as on a real piano.
- Everything else: [MuseScore General](https://musescore.org/en/handbook/3/soundfonts-and-sfz-files) by S. Christian
  Collins, MIT license.

The piano bank is layered over MuseScore General and replaces only its acoustic grand. If the piano file is missing,
playback falls back to MuseScore General's piano.

Everything plays in a concert hall (about 1.8 s of reverberation, the bass kept out of it) generated by the page, not
recorded; **Hall** turns it off or sets how much, and your browser remembers the setting.

## Tests

```sh
npm test          # timing engine, the Verovio → MIDI pipeline on fixtures/song.musicxml, and a UI smoke test
npm run typecheck
```

## License

MIT (see `LICENSE`). The sound banks are fetched separately and keep their own licences (above).
