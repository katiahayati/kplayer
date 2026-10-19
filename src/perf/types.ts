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

export interface PerformanceDoc {
  version: 2;
  score?: { name: string; sha256: string };
  /** Multiplies every written tempo. */
  tempoFactor: number;
  /** Keyed by part (MIDI track) index. */
  parts: Record<string, PartSetting>;
  gestures: Gesture[];
}

export function emptyDoc(): PerformanceDoc {
  return { version: 2, tempoFactor: 1, parts: {}, gestures: [] };
}
