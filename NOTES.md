# Phase 0 spike notes (Verovio 6.3.0, spessasynth_lib 4.3.14)

Run `npm run spike -- path/to/score.musicxml` to reprint these for any score.

## Verovio

- **Timemap entries** are `{ tstamp (ms), qstamp (quarter notes), tempo?, measureOn?, on?: id[], off?: id[] }`.
  `qstamp` is the score position the time map is built on.
- **Repeats are expanded** in both the timemap and the MIDI. Repeated elements get `-rend2`, `-rend3`… appended
  to their IDs; the SVG only has the base IDs. The fixture (5 bars, bars 3–4 repeated) plays 28 quarters, not 20.
  Gestures are anchored to a measure, so one in a repeated measure applies on every pass.
- **Ties** are merged into one MIDI note, while the timemap still lists each tied notehead separately (good for
  highlighting).
- **MIDI**: PPQ 120, one track per staff (staff n → track n − 1). Staves of one instrument share a channel, so
  kplayer groups tracks by channel into parts (Voice, Piano).
  Notes are 1 tick short of their written length. **Velocity is a flat 90 for every note, dynamics or not**
  (checked on a full song with p … fff). The MEI has the dynamics: `<dynam staff tstamp val>` with `val` the MIDI
  velocity the notation program gave it (MuseScore exports one), and `<hairpin form tstamp tstamp2="1m+3">`.
  `getTimesForElement` returns nothing for them, so kplayer places them from the measure and beat (beats in the
  meter's unit: a 3/2 bar's beat is a half note). Tuplets can land a tick off their timemap position in the MIDI.
- **Pitches from MEI**: `pname`, `oct` and `accid` / `accid.ges` (on the note or its `<accid>` child) give the same
  pitch as `getMIDIValuesForElement` for all 3,419 notes of a real score, in 37 ms instead of 2.5 s.
  Tempo comes through as MIDI tempo events (72, then 96 at the expanded position).
- **Element attributes** (`getElementAttr`): a measure has `n` (the printed number), a staff has `n`, and a breath
  mark has `{ staff, tstamp }` (e.g. `tstamp: '2.9'`, just before beat 3). kplayer anchors a written breath mark
  after the nearest note to its left in the same staff, using the glyphs' `translate(x, …)` positions.
- **SVG**: `g.measure > g.staff > g.layer > g.note` (chords: `g.chord > g.note`). Colour comes from
  `color="black"` on the inner `svg.definition-scale`, and paths stroke with `currentColor`. Setting
  `fill` + `color` on a group recolours it.
- **Tremolos**: Verovio's MIDI plays a *fingered* (two-note) tremolo as its two written notes one after the other,
  each held for half the span, with no alternation. Single-note tremolos it already plays as repeated notes. The MEI
  has `<fTrem beams="3">` with the two notes (or chords) as children, and `getMIDIValuesForElement` gives each note's
  pitch, so `src/score/tremolos.ts` swaps the written notes for the alternation.
- The `verovio/esm` wrapper already JSON-parses results (`renderToTimemap`, `getElementAttr`).
  `loadData` returns `1`/`0`, not a boolean.

## SpessaSynth

- `WorkletSynthesizer(ctx)` after `ctx.audioWorklet.addModule(spessasynth_processor.min.js)`; sound banks
  are added with `synth.soundBankManager.addSoundBank(buf, id)`.
- `Sequencer(synth, { skipToFirstNoteOn: false })`, `loadNewSongList([{ binary }])` (doesn't auto-play),
  `currentTime` (seek), `currentHighResolutionTime` (smoothed, for the playhead), `loopCount = Infinity`.
- **Loop points** come from `loopStart` / `loopEnd` marker meta events; without them, the loop runs from the
  first note-on to the last voice event. **CC2, CC4, CC111 and CC116–119 are also read as loop points**, so kplayer
  never copies them into the performance MIDI.
- Seeking while paused updates the paused clock only once the worklet answers with `timeChange`.
- **Several sound banks**: `soundBankManager.priorityOrder` lists bank IDs, first wins per preset. kplayer loads its
  piano (one preset, 0:0 "Grand Piano") ahead of MuseScore General.
- **No reverb unless asked**: the reverb send (CC91) defaults to 0 and Verovio's MIDI never sets it, so everything
  plays dry, which sounds like MIDI. kplayer adds its own hall after the synth (`src/audio/hall.ts`) instead of
  SpessaSynth's built-in GS reverb, whose return is weak (its CC91 modulator is 20% at full send).
- **Loading before a click works**: an AudioContext made at page load starts suspended, but `addModule`, the
  worklet synth and `addSoundBank` all complete while it is; `resume()` from the Play click is all that's left.
- **Preloading**: the sequencer decodes every sample the loaded song uses as it loads it (`preload`, on by default),
  so handing it the piece paused means the first notes don't stall. Decoded samples stay cached.
- **SF3 in Node**: `await BasicSoundBank.isSF3DecoderReady` before rendering, or Ogg samples decode as silence.
- **Memory**: samples are decoded to 32-bit floats as they're first used. An SF2's file is kept as well, so its
  working set approaches 3× the 16-bit data; an SF3 keeps only the small compressed file plus what's decoded. Don't
  decode big banks whole in Node: on this WSL (~5.8 GB) it ran out of memory.

## The piano (scripts/build-piano.ts)

- The old piano, **YDP** (FreePats' Disklavier samples), was mono and played one recording for every velocity from
  0 to 73: pp, p and mf had the same tone, a hard strike turned down. Its five layers were all loud strikes.
- **Salamander Grand Piano V3** (Yamaha C5, CC-BY 3.0) has 16 strike strengths, every minor third, in stereo. From
  the 44.1 kHz/16-bit release (489 MB): every recording is scaled to the attack loudness of its key's hardest strike,
  so loudness follows the SoundFont velocity curve (40·log10(v/127) dB, as kplayer's dynamics assume; per note and
  velocity it matches YDP within 1–2 dB) and the strike only sets the tone. The 7–28 ms of silence before each
  attack is cut, and each recording a second after it has died away by 40 dB (12 s at most). Encoded as Ogg Vorbis
  (q6) the bank is 73 MB, against 1.16 GB as 16-bit PCM. Releases: 0.8 s with dampers, 4 s above them (F#6 up).
- Salamander's SFZ leaves out `pitch_keycenter` for C4: the SFZ default is 60. Read as 0, C4 played from the wrong
  root, quiet and shrill.
- Salamander's stereo is a wide spaced pair (left/right correlation ≈ 0.2): measure loudness by the channels' power,
  not their sum, which loses up to 7 dB on some notes.
- Not used yet: its release noises (key up), pedal noises and string-resonance releases. A SoundFont can't trigger on
  release, but kplayer writes the MIDI, so it could add them as notes on a channel of their own.
- Rendering Var det en dröm? (2 minutes) in Node, the 16-layer Salamander SF3 took about 300 MB more memory than
  YDP's SF2 (heap and buffers 1.07 GB against 0.78 GB; an 8-layer build took about 180 MB more).

## Tooling

- The system npm 10.8.2 hangs or crashes (`edgesOut`) installing vite 8 / vitest 4. Use `npx -y npm@11 install`.
- happy-dom stops parsing an SVG at Verovio's `<style>` element, so the UI test runs on jsdom.
