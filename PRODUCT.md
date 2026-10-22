# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Today:** mainly its author, a singer rehearsing songs and arias with their piano (or reduced orchestral)
  accompaniment: Sibelius's *Var det en dröm?*, Strauss's *Morgen* and *Gesang der Apollopriesterin*.
- **The hope:** people the author shares it with: teachers, students, other singers and pianists.
- **The aspiration:** musicians in general, finding it on the public site and picking it up on their own.

So the near-term user knows the app well and works fast; the people it should grow towards have never seen it.

Where it's used: a **computer at a desk** (mouse or trackpad, keyboard shortcuts) and a **phone**. Not, so far,
a tablet on a music stand.

The job: make the accompaniment breathe with the singer (breaths where they breathe, give and take in the
tempo, the dynamics the score asks for), then listen to learn the piece and sing along with it.

## Product Purpose

Notation programs play a score mechanically: MuseScore's breath marks are short and can't be adjusted, and its
rit./accel. change tempo in audible steps. kplayer plays a MusicXML score with expressive timing instead: a
breath is a small, local broadening of the tempo around the breath point; tempo changes are smooth curves; the
score's dynamics are played, with an optional voicing on top; and it sounds on a sampled concert grand
(Salamander) in a concert hall.

Success: the piano sounds like a pianist following a singer, not a sequencer stepping between tempos, and
rehearsing with it feels closer to rehearsing with an accompanist.

## Positioning

- One continuous tempo curve shared by every part. Breaths and tempo changes stretch time smoothly; notes are
  never cut short and no gaps are inserted; audio is never time-stretched.
- The score is never modified. Everything kplayer adds (breaths, tempo changes, dynamics, tempo and mix) lives
  in a separate performance, saved in the browser and to files, including one `.kplayer` piece file with the
  score inside.
- A companion project, kespressivo (github.com/katiahayati/kespressivo), learns performances (tempo, dynamics)
  from recordings for kplayer to import.

## Operating Context

- Scores come from MuseScore or Sibelius as MusicXML (`.musicxml`, `.mxl`), often community transcriptions of
  public-domain editions (IMSLP).
- A typical session: open a score or piece; listen; click a note and press B to breathe after it; shift-click
  to select a passage and slow it down, speed it up, broaden it or push it forward; loop around a spot while
  adjusting it; compare with and without phrasing (E) or dynamics (D); sing along; save the piece.
- Runs in an ordinary browser (the author uses Brave on Windows); deployed as a static site at
  katiahayati.com/kplayer. No accounts, no server: work autosaves in the browser per score; files go through
  the system Save dialog where the browser has one, otherwise as downloads.
- The sounds (about 110 MB) start loading as soon as the page opens, so the first Play is quick.

## Capabilities and Constraints

- **Phrasing:** breaths (extra time in ms; presets), tempo changes (Slow down, Speed up to a target % of the
  basic tempo, Broaden, Push forward with a peak and hold, A tempo), on/off per item and per group, loop
  around an item, a tempo lane showing the whole piece's tempo curve.
- **Dynamics:** the score's written dynamics and hairpins; an imported voicing (voices, pulse, pedal) with
  levels adjustable in the Dynamics tab. A fuller dynamics editor was tried and parked (branch
  `dynamics-editor`): any new dynamics-editing design is to be talked through with the author first and kept
  small.
- **Sound:** Salamander Grand Piano, MuseScore General for other instruments, a synthetic concert hall, a mixer.
- **Files:** Save piece (`.kplayer`), Import / Export JSON (phrasing and dynamics), Export MIDI.
- **Undecided:** the name ("kplayer" is a working name; "kollaparte" is a candidate, not chosen). Sharing a
  piece by link was tabled; not designed.
- **Terminology in the UI:** breath, tempo change, passage, phrasing, dynamics, voicing, pulse, pedal, piece,
  hall, mixer, bar (m.), beat. Musicians' words, not engineering ones.
- Technical: Vite + React + TypeScript; Verovio renders the score as SVG; SpessaSynth plays SoundFonts. MIT
  licensed, public on GitHub.

## Brand Commitments

- No name, logo or visual identity is committed yet; don't build identity around "kplayer".
- Credits that must stay visible: Salamander Grand Piano by Alexander Holm (CC-BY 3.0); MuseScore General (MIT).

## Evidence on Hand

- A demo song (`public/demo/song.musicxml`) ships with the app.
- The author's own scores and performances are local files, not part of the app.
- kespressivo has an example: Strauss's *Gesang der Apollopriesterin* with performances learned from
  recordings.
- There are no testimonials, user numbers or reviews; don't invent any.

## Product Principles

1. **The music leads.** The score is the workspace; controls support reading and listening and stay out of
   their way.
2. **Sound like a musician.** Smooth, musically right timing and dynamics matter more than the number of
   features.
3. **Fast for the expert, learnable for the newcomer.** Keyboard shortcuts for the author, but every action
   discoverable and named in plain musical language, so someone it's shared with can pick it up.
4. **Never destructive.** The score is untouched; everything added can be switched off, compared, undone and
   saved.
5. **Small and deliberate.** Prefer simple features that do one thing well; large new editing concepts are
   discussed before they're built.
