// The loudness meter scripts use to compare renders with recordings (EBU R128 momentary loudness).
import { describe, expect, it } from 'vitest';
import { beatLoudness, momentaryPower } from '../scripts/lib/loudness';

const sine = (amp: number, seconds: number, rate = 32000, hz = 997) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

describe('loudness', () => {
  it('reads a 997 Hz sine as its level (the K-weighting is calibrated there)', () => {
    const rate = 32000;
    for (const amp of [1, 0.5, 0.1]) {
      const x = sine(amp, 3, rate);
      const beats = beatLoudness(momentaryPower(x, x, rate), (q) => q, 2);
      // Mean square of a sine is amp²/2: −3.01 dB at full scale.
      for (const b of beats) expect(b.lufs).toBeCloseTo(10 * Math.log10((amp * amp) / 2), 1);
    }
  });

  it('follows a level change beat by beat', () => {
    const rate = 32000;
    const x = Float32Array.from([...sine(0.5, 2, rate), ...sine(0.05, 2, rate)]);
    const beats = beatLoudness(momentaryPower(x, x, rate), (q) => q, 3);
    expect(beats[0].lufs - beats[3].lufs).toBeCloseTo(20, 0);
  });
});
