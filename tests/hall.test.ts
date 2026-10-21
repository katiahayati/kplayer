// The concert hall the piano plays in (src/audio/hall.ts), and the offline version of it.
import { describe, expect, it } from 'vitest';
import { filterInPlace, hallImpulse, highPass } from '../src/audio/hall';
import { applyHall, convolve } from '../scripts/lib/hall';

/** Seconds for the energy still to come to fall from −5 to −35 dB, times two (T30, as a hall's RT60). */
function rt60(x: Float32Array, rate: number): number {
  const rest = new Float64Array(x.length);
  let sum = 0;
  for (let i = x.length - 1; i >= 0; i--) rest[i] = sum += x[i] * x[i];
  const at = (db: number) => rest.findIndex((e) => 10 * Math.log10(e / rest[0]) < db);
  return ((at(-35) - at(-5)) / rate) * 2;
}

describe('hall', () => {
  const rate = 44100;
  const [left, right] = hallImpulse(rate);

  it('is the same every time, with unit energy and two different sides', () => {
    const [again] = hallImpulse(rate);
    expect(again).toEqual(left);
    let e = 0;
    let lr = 0;
    for (let i = 0; i < left.length; i++) (e += (left[i] ** 2 + right[i] ** 2) / 2), (lr += left[i] * right[i]);
    expect(e).toBeCloseTo(1, 3);
    expect(Math.abs(lr)).toBeLessThan(0.1); // decorrelated: a wide room, not a mono echo
  });

  it('rings for about 1.8 s, the treble dying sooner than the whole', () => {
    expect(rt60(left, rate)).toBeGreaterThan(1.5);
    expect(rt60(left, rate)).toBeLessThan(2.1);
    const treble = Float32Array.from(left);
    filterInPlace(treble, highPass(4000, rate));
    expect(rt60(treble, rate)).toBeLessThan(rt60(left, rate) - 0.3);
  });

  it('starts after a short pre-delay', () => {
    const first = left.findIndex((v) => Math.abs(v) > 1e-6);
    expect(first / rate).toBeGreaterThan(0.005);
    expect(first / rate).toBeLessThan(0.02);
  });

  it('convolves by FFT as directly', () => {
    const x = Float32Array.from({ length: 3000 }, (_, i) => Math.sin(i * 0.37) + ((i * 7919) % 13) / 13 - 0.5);
    const h = Float32Array.from({ length: 700 }, (_, i) => Math.exp(-i / 100) * Math.cos(i * 0.9));
    const fast = convolve(x, h);
    expect(fast.length).toBe(x.length + h.length - 1);
    for (const n of [0, 1, 699, 1500, 2999, 3698]) {
      let direct = 0;
      for (let k = Math.max(0, n - x.length + 1); k <= Math.min(n, h.length - 1); k++) direct += h[k] * x[n - k];
      expect(fast[n]).toBeCloseTo(direct, 9);
    }
    expect(convolve(x, h, 100)).toHaveLength(100);
  });

  it('adds a tail to a click, and nothing to silence', () => {
    const n = rate * 3;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    applyHall(l, r, rate);
    expect(l.every((v) => v === 0)).toBe(true);
    l[0] = r[0] = 1;
    applyHall(l, r, rate);
    const energy = (from: number, to: number) => l.subarray(from * rate, to * rate).reduce((s, v) => s + v * v, 0);
    expect(energy(0.5, 1)).toBeGreaterThan(0);
    expect(energy(0.5, 1)).toBeGreaterThan(energy(1.5, 2) * 10);
  });
});
