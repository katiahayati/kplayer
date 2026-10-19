import type { BreathGesture } from './types';

export type BreathPresetKey = 'catch' | 'normal' | 'full';

export const BREATH_PRESETS: Record<BreathPresetKey, { label: string } & Pick<BreathGesture, 'extraMs'>> = {
  catch: { label: 'Catch breath', extraMs: 150 },
  normal: { label: 'Normal', extraMs: 300 },
  full: { label: 'Full breath', extraMs: 600 },
};

export const DEFAULT_BREATH_PRESET: BreathPresetKey = 'normal';

export const SECTION_DEFAULTS = {
  /** A new Slow down / Speed up starts 15% away from the tempo where it begins. */
  ramp: { change: 0.15 },
  shape: { amount: 0.1, peak: 0.65, releaseQ: 0 },
};
