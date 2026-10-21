// The concert hall the piano plays in (src/audio/hall.ts). kespressivo's render-audio --hall uses it too.
import { describe, expect, it } from 'vitest';
import { filterInPlace, hallImpulse, highPass } from '../src/audio/hall';

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
});
