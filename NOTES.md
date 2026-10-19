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
  Notes are 1 tick short of their written length. Velocity is a flat 90 in the fixture; dynamics are untested.
  Tempo comes through as MIDI tempo events (72, then 96 at the expanded position).
- **Element attributes** (`getElementAttr`): a measure has `n` (the printed number), a staff has `n`, and a breath
  mark has `{ staff, tstamp }` (e.g. `tstamp: '2.9'`, just before beat 3). kplayer anchors a written breath mark
  after the nearest note to its left in the same staff, using the glyphs' `translate(x, …)` positions.
- **SVG**: `g.measure > g.staff > g.layer > g.note` (chords: `g.chord > g.note`). Colour comes from
  `color="black"` on the inner `svg.definition-scale`, and paths stroke with `currentColor`. Setting
  `fill` + `color` on a group recolours it.
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

## Tooling

- The system npm 10.8.2 hangs or crashes (`edgesOut`) installing vite 8 / vitest 4. Use `npx -y npm@11 install`.
- happy-dom stops parsing an SVG at Verovio's `<style>` element, so the UI test runs on jsdom.
