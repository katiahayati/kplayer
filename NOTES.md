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
- **Several sound banks**: `soundBankManager.priorityOrder` lists bank IDs, first wins per preset. kplayer loads the
  YDP piano (one preset, 0:0 "Grand Piano", 121 samples at 44.1 kHz, 118 MB) ahead of MuseScore General.
- **Memory**: samples are decoded to 32-bit floats as they're played, so the working set approaches 2× the 16-bit
  sample data. The Salamander Grand SF2 (1.27 GB, 48 kHz/24-bit, 16 layers) is too big for this; YDP peaks around
  240 MB. Don't decode big banks whole in Node either: on this WSL (~5.8 GB) it ran out of memory.

## Aligning recordings (tools/align_recording.py)

- synctoolbox's multiscale DTW (chroma + DLNCO onset features) aligns an orchestral recording to the piano-reduction
  score well. Peak memory for a 7-minute song is about 0.7 GB.
- **Trim silence and noise first.** A recording that starts with 13 s of digital silence, then 8 s of hiss, otherwise
  stretches the first bars over them (bars 1–2 came out at half tempo). The aligner measures the noise floor after the
  silence and starts where the level rises 10 dB above it for a second, backtracked to where the rise began.
- **Align twice.** Through long held chords there are no onsets to anchor to, and the DTW path falls back to the
  score's layout tempo, then jumps to catch up: bars come out at exactly the written tempo, followed by a spike.
  Laying the score out along a smoothed first-pass alignment for a second pass fixes this.
- **Fitting sections**: copying levels off a smoothed curve drifts (a 13 s drift over 7 minutes), because smootherstep
  between turning points spends time differently from the real curve. Solving the levels so each section's duration
  matches the recording (damped Gauss-Newton, levels kept within 15% of the measured shape) fixes it. Breaths are
  measured against the tempo just around them, not the smoothed curve, which averages them away.
- **Fit cumulative time**, not each section's duration on its own: then time one section can't produce is made up by
  the next instead of shifting the rest of the piece.
- **Following the singer** (tools/align_voice.py): Demucs (htdemucs, CPU, ~4.6 GB peak for 7 minutes) isolates the
  voice; synctoolbox aligns the score's vocal line to it, laid out along the full-score alignment so rests line up.
  Chroma can't see the boundary between two notes of the same pitch (singers hold into written rests), so entries and
  repeated pitches snap to the vocal attack that rises most from the moment before it. Judge her timing by her own
  neighbouring notes, not by the full-score alignment, which is what goes wrong where she rests.
- **Breaths** only where the singer has to steal time: punctuation with the next sung note straight after. Time taken
  in a rest is the conductor's tempo, carried by sections.
- Real performances exceed the old per-section limits (Thielemann goes from 40 to 83 BPM within three bars), so
  sections now arrive anywhere from 20% to 4× the basic tempo. Each stores that target relative to the basic tempo,
  not as a change from the section before, so editing or deleting one section leaves the others where they were.

## Tooling

- The system npm 10.8.2 hangs or crashes (`edgesOut`) installing vite 8 / vitest 4. Use `npx -y npm@11 install`.
- happy-dom stops parsing an SVG at Verovio's `<style>` element, so the UI test runs on jsdom.
