---
name: expressive-piano
description: Make kplayer's piano part sound played rather than sequenced, from the score and its printed edition. Covers the voicing (which strands lead and which recede), a metric pulse on the bar's real beats, the composer's dynamics, hairpins and pedal, all written as a voicing file to Import. Use whenever the user wants a piano part, accompaniment or piano reduction to be more expressive, musical or less mechanical. Also use it when a strand is too loud or buried (a tremolo as loud as the tune, a heavy bass), when the beats should be pulsed, when the pedal blurs or is missing, or when the score's dynamics were never transcribed. It also comes first when a recording's dynamics are to be learned (learn-dynamics needs a voicing).
---

# Making the piano expressive

Verovio's MIDI plays every note at one velocity with no pedal, so a song's accompaniment comes out flat.
Everything else here comes from kplayer's dynamics layer (README, "Dynamics"; types in `src/perf/types.ts`,
engine in `src/perf/dynamics.ts`), written into a **voicing file** that the user imports with **Import
voicing…**. Importing a voicing keeps their tempo phrasing. The score is never modified.

The user is a singer and musician. Talk in bars, beats, hands, voices and dB, and say what you couldn't hear:
you can measure the result but not listen to it.

`E=.claude/skills/expressive-piano/scripts`. Scripts run from the project root. Renders use about 4 GB at
peak on this machine (see the learn-performance skill on memory and `guard.sh`). The dev server alone can
hold 1.3 GB, so stop it before a render if memory is short, and restart it afterwards.

## What the engine offers

- **Marks and hairpins** (`marks`, `hairpins`, with `part`): the part's level as a MIDI velocity
  (pp 32, p 49, mp 64, mf 72, f 88, ff 101; any number works too, e.g. "poco f" ≈ 80). Give every hairpin
  an explicit `level`, or it goes one marking further.
- **Voices** (`voices`): a strand's level in dB relative to the marks (velocity × 10^(dB/40)).
  - Select notes by part, staff (1 = right hand), layer (the MusicXML voice), note length, pitch range,
    tremolo, repeated notes, top/bottom of a chord, and bars (`from`/`to`).
  - Where voices overlap, **later ones win**: general rules first, bar-range overrides after.
  - `lead` sounds a strand slightly ahead; `varyDb`/`jitterMs` keep repeated figures from ticking.
- **Pulse** (`pulse`): notes on chosen beats of the bar play louder (`every` = the beat in quarter notes,
  counted from each bar line; `beats` to pick some of them; `fade` to carry the accent through the beat).
  Pulses **add** to the voices and to each other.
- **Pedal** (`pedal` spans): `harmony` changes where the harmony does, `beat`, `bar`, or `off`.
  `every` sets the beat it works in.
- Notes of one pitch starting together (a notehead shared by two voices) are struck once
  (`mergeUnisons` in `src/perf/render.ts`). Selectors still see both copies, often a short one and a long one.

If the music needs something the engine can't express (a rolled chord, the sigh of a two-note slur, an
agogic lean on a beat), say so and offer to build it. When building one, add tests in
`tests/dynamics.test.ts`, show it in the Dynamics panel, and document it in the README. Don't fake it with
rules that only happen to work here.

## Steps

1. **What does the score already say?** Run `python3 $E/score_summary.py score.mxl`. It lists dynamics,
   hairpins, words, pedal, accents and slurs by bar. The user's transcriptions (from the kengraver project)
   usually leave expressive markings out: `~/coding/kengraver/scores/<name>/state.json` says so under
   `scope` and `not_encoded`.

2. **Get the composer's markings from the print.**
   - kengraver keeps the scanned source one system per image
     (`scores/<name>/source/p<page>-s<system>.png`, with the bars per page in `state.json`). Otherwise use
     IMSLP; its downloads need a human to pass a captcha, so ask the user to save the PDF in the project.
   - Read every system with the Read tool and write a per-bar list *before* encoding anything:
     - dynamics;
     - each hairpin's span in beats (judge its ends against the bar's notes) and which way it opens
       (the narrow end is where a crescendo starts);
     - text such as "poco a poco cresc. al f" (a long hairpin to the next mark), "poco dim.", "dim.";
     - Ped. marks and releases, by beat;
     - accents, and rolled chords.
   - Count bars from the first system and check them against the lyrics.
   - Also look for wrong notes (`python3 .claude/skills/learn-performance/scripts/accidental_clashes.py score.mxl`).
     Tell the user about any you find, and don't edit the score.
   - **For a reduction of an orchestral score, read the full score too.** A reduction moves lines between
     hands and voices, and the same notation means different things. In Apollo, the "tremolos" were muted
     cellos (a soft blanket), timpani rolls (pp), and the whole string section at the climaxes (full, but well
     under the tune). The reduction can also say pp where the orchestra plays out. Name voices after the
     instruments.

3. **Survey the texture.**
   - `npx tsx $E/texture.mts score.mxl` shows each bar's staves and voices: notes, range and lengths, with
     repeated layouts marked.
   - `npx tsx $E/bar_notes.mts score.mxl 19 26 38` lists every note of the unusual bars.
   - Name the strands:
     - the tune (in a song it's usually the singer's, not the piano's);
     - running figuration;
     - inner lines (often double-stemmed notes);
     - the bass, and the rhythm it repeats in;
     - held notes.
   - Note where the layout changes: those bars need bar ranges.
   - Find the bar's **real beat**. In *Var det en dröm?* (6/4), the left hand plays three-eighth groups
     (bass, high, middle), the right hand plays quarter-note groups of sixteenths, and the harmony moves by
     dotted halves.

4. **Write the voicing.** Use a short Python snippet that writes the JSON. Anchors are
   `{"measureIndex": bar − 1, "offsetQ": quarters into the bar, "label": "bar"}`. For a piano reduction,
   `voicing-example.json` in this skill's folder is a starting point. Starting points that worked (in dB
   against the marks):

   | Strand | Var det en dröm | Apollo (reduction) |
   |---|---|---|
   | Running sixteenths under a singer | −4, vary 1 | sextuplet blanket −10 |
   | Held inner line (double-stemmed) | −1 | held chords −5 |
   | Left hand overall | −4.5 | bass −4 |
   | Repeated-chord pulse | | −11 |
   | Bass on each group's first note (pulse, every 1.5) | +2 | |
   | Bass on the big beats (pulse, every 3) | +3 more | |
   | Right hand at beat 4 (pulse, `beats: [1]`, fade 0.5) | +1.5 | |
   | High shimmer / held bell note in a pp passage | −5 / +3 | |
   | Accented closing chords | +3 | |

   Notes on the choices:
   - **Pulse the beats the music moves in, not every notated beat.** Two pianists in *Var det en dröm?*
     struck the bass harder on the big beats than halfway through them, and lifted the right hand a little
     at beat 4. The downbeat wasn't stronger. The learn-dynamics skill measures this from a recording.
   - Select the bass of a broken-chord left hand by **note length** (its eighths) and pulse every group;
     `bottom` doesn't work there. `top` and `bottom` act per onset, so in a single-note figure every note is
     both the top and the bottom.
   - Keep a rule out of other passages with `minPitch`, note length or a bar range. A short-note rule caught
     the left hand's chords in bars 21 and 23 until `minPitch` kept it in the treble.
   - **Pedal** with `harmony` and `every` set to the real beat (3 in 6/4; usually 1 in 4/4, 2 in alla breve).
     Compared quarter by quarter, a bass played every other eighth reads as a new harmony on each beat, so the
     pedal changed on beats 3 and 6 where the print never does. Put `off` spans where the print is dry.

5. **Check it.**
   - `npx tsx $E/check_voicing.mts score.mxl voicing.json [BAR…]` lists the problems first: anchors outside
     the score, voices with no notes, notes clipped at velocity 127. Then, per bar, it shows the level, each
     voice's velocities, the notes no voice took, and where the pedal changes.
   - Compare the pedal changes with the print's Ped. marks.
   - Look for:
     - a rule leaking into a passage it wasn't meant for;
     - loud voices left inside a pp passage;
     - the bass towering over everything;
     - clipping.
   - With the tune inside the piano (a reduction), run `scripts/voice-balance.ts` (README). It renders and
     measures whether the melody is on top: aim for most bars, by 3–6 dB.
   - With a recording, the learn-dynamics skill compares bass-to-treble balance.

6. **Deliver.**
   - Save `<score>.voicing.json` in the project root (not committed unless asked), with an `about` line
     saying what it does.
   - Tell the user: **Import voicing…** keeps their phrasing, **D** switches dynamics on and off, and the
     Dynamics panel lists each voice, pulse and pedal span with on/off and a level slider.
   - Summarise musically: which strands lead, where the pulse falls, Sibelius's or the composer's marks you
     added, the pedalling.
