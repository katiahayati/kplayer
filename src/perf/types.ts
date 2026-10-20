// The performance document: everything kplayer adds on top of a score. It is
// saved as a sidecar JSON file and never modifies the score itself.

/** A score position: a measure (by order in the score) plus quarter notes into it. */
export interface Anchor {
  /** 0-based index of the measure in score order. */
  measureIndex: number;
  /** Quarter notes from the start of the measure. */
  offsetQ: number;
  /** Printed measure number, for people reading the JSON. Not used to resolve. */
  label?: string;
}

interface GestureBase {
  id: string;
  enabled?: boolean;
}

/**
 * Time for a breath: the note before the breath point is held longer (the
 * shared tempo slows only while it sounds) and the next note comes in on tempo.
 */
export interface BreathGesture extends GestureBase {
  type: 'breath';
  /** The breath point: the end of the note before the breath. */
  at: Anchor;
  /** Staff of the note before the breath (Verovio staff n). Without it, the shortest note ending here is used. */
  staff?: string;
  /** How much longer the note before the breath is held, in milliseconds. */
  extraMs: number;
}

/**
 * A gradual tempo change (rit. / accel.) that arrives at `target` and holds it
 * until the next section. The target is relative to the basic tempo, not to the
 * section before, so changing or deleting earlier sections never moves it.
 */
export interface RampGesture extends GestureBase {
  type: 'ramp';
  from: Anchor;
  to: Anchor;
  /** Tempo reached at `to`, as a fraction of the basic tempo (written tempo × tempo factor), e.g. 0.85. */
  target: number;
}

/** Smoothly returns to the written tempo, cancelling earlier ramps. */
export interface ATempoGesture extends GestureBase {
  type: 'aTempo';
  from: Anchor;
  to: Anchor;
}

/** A phrase that broadens or pushes forward, then returns to the surrounding tempo. */
export interface ShapeGesture extends GestureBase {
  type: 'shape';
  gesture: 'broaden' | 'push';
  from: Anchor;
  to: Anchor;
  /** Fractional tempo change at the peak, e.g. 0.10 = 10%. */
  amount: number;
  /** Where the peak falls within the section, 0..1. Used unless `peakAt` is set. */
  peak: number;
  /** The note the peak arrives on (its onset). */
  peakAt?: Anchor;
  /** Hold the peak tempo until this note (its onset), then ease back. */
  holdUntil?: Anchor;
  /** Quarter notes after `to` over which the tempo returns (used when peak is at the very end). */
  releaseQ: number;
}

export type Gesture = BreathGesture | RampGesture | ATempoGesture | ShapeGesture;

export interface PartSetting {
  mute: boolean;
  /** 0..1 */
  volume: number;
}

/** Which notes a voice is: all of them unless narrowed. Staff and layer numbers are as in the score. */
export interface NoteSelector {
  /** Part index (as in `parts`). */
  part?: number;
  /** Staff within the part, from 1 (a piano's right hand is 1, left hand 2). */
  staff?: number[];
  /** Voice (MusicXML voice / MEI layer). MuseScore numbers a piano's right-hand voices 1–4 and left-hand 5–8. */
  layer?: number[];
  /** Only (true) or never (false) the rapid notes of fingered tremolos. */
  tremolo?: boolean;
  /** Only the highest (or lowest) note at each moment among the notes selected so far. */
  top?: boolean;
  bottom?: boolean;
  /** Only notes from this pitch up / up to this pitch (MIDI numbers). */
  minPitch?: number;
  maxPitch?: number;
  /** Only notes at least / at most this long, in quarter notes (tied notes count whole): long melody notes vs figuration. */
  minLength?: number;
  maxLength?: number;
  /**
   * Only (true) or never (false) re-struck notes: the same voice plays the same pitch at its onset just
   * before or just after (within a beat). Separates a pulse of repeated chords from moving lines.
   */
  repeated?: boolean;
}

/**
 * A strand of the texture with its own level: the melody brought out, a tremolo
 * kept as a soft blanket. Where voices overlap, the later one in the list wins.
 */
export interface VoiceRule {
  id: string;
  /** What it is, e.g. "Brass melody", "Cellos, tremolo". */
  name: string;
  enabled?: boolean;
  /** Where it applies; the whole piece when absent. `to` is exclusive. */
  from?: Anchor;
  to?: Anchor;
  select: NoteSelector;
  /** Level relative to the written dynamic, in decibels (−6 is clearly softer, −12 a different plane). */
  gainDb: number;
  /** Sound slightly ahead of the other notes, as a pianist brings out a melody. */
  lead?: boolean;
  /** Random variation of each note's level, ± decibels, so repeated figures shimmer instead of ticking. */
  varyDb?: number;
  /** Random variation of each note's timing, ± milliseconds: an unmeasured tremolo isn't metronomic. */
  jitterMs?: number;
}

/**
 * A metric pulse: the notes struck on a beat of the bar play louder, and the accent can fade over the
 * notes that follow. Beats count from each bar's start. Pulses add up, to each other and to the voices,
 * so a bass can lean on the big beats of a 6/4 bar while its voice keeps its own level.
 */
export interface PulseRule {
  id: string;
  /** What it is, e.g. "Bass, big beats". */
  name?: string;
  enabled?: boolean;
  /** Where it applies; the whole piece when absent. `to` is exclusive. */
  from?: Anchor;
  to?: Anchor;
  /** Which notes; every note when absent. */
  select?: NoteSelector;
  /** The beat, in quarter notes: 3 for the dotted half of 6/4, 6 for its downbeat alone. */
  every: number;
  /** Only these beats of the bar, counted from 0 (with `every: 3` in 6/4, [1] is beat 4); every beat when absent. */
  beats?: number[];
  /** Louder on the beat, in decibels (negative for softer). */
  gainDb: number;
  /** How far the accent carries, as a fraction of the beat: 0 for the notes on the beat alone, 1 to fade over all of it. */
  fade?: number;
}

/** A dynamic the score doesn't write (taken from the full score, say). */
export interface DynamicMarkGesture {
  id: string;
  at: Anchor;
  /** A marking ("pp", "mf"…) or a MIDI velocity. */
  level: string | number;
  /** Part index; every part when absent. */
  part?: number;
}

/** A crescendo or diminuendo the score doesn't write. */
export interface HairpinGesture {
  id: string;
  from: Anchor;
  to: Anchor;
  form: 'cres' | 'dim';
  /** Where it arrives; the next written dynamic, or one marking further, when absent. */
  level?: string | number;
  part?: number;
}

/** Sustain pedal over a stretch: changed with the harmony, every beat, every bar, or off. */
export interface PedalSpan {
  id: string;
  enabled?: boolean;
  from: Anchor;
  to: Anchor;
  mode: 'harmony' | 'beat' | 'bar' | 'off';
  part?: number;
}

/** How loud each note plays: the score's dynamics (or the performance's own), and the voicing on top. */
export interface DynamicsDoc {
  /**
   * Play the score's written dynamics and hairpins (the default). Off when `marks` and `hairpins` give
   * the whole shape themselves, as a shape learned from a recording does; then parts the performance
   * gives no dynamics of its own still play the score's.
   */
  written?: boolean;
  voices: VoiceRule[];
  pulse?: PulseRule[];
  marks?: DynamicMarkGesture[];
  hairpins?: HairpinGesture[];
  pedal?: PedalSpan[];
  /** How far ahead a leading voice sounds, in milliseconds. */
  leadMs?: number;
}

export interface PerformanceDoc {
  version: 2;
  score?: { name: string; sha256: string };
  /** Multiplies every written tempo. */
  tempoFactor: number;
  /** Keyed by part (MIDI track) index. */
  parts: Record<string, PartSetting>;
  gestures: Gesture[];
  dynamics?: DynamicsDoc;
}

export function emptyDoc(): PerformanceDoc {
  return { version: 2, tempoFactor: 1, parts: {}, gestures: [] };
}
