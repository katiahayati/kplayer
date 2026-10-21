// The app's concert hall (src/audio/hall.ts) for offline renders: the same high-pass,
// impulse response and level as the ConvolverNode the app plays through, by FFT convolution.

import { filterInPlace, HALL, hallImpulse, highPass } from '../../src/audio/hall';

/** Adds the hall to a dry stereo render, in place. `level` 1 is the app's default. */
export function applyHall(left: Float32Array, right: Float32Array, rate: number, level = 1): void {
  const ir = hallImpulse(rate);
  const hp = highPass(HALL.highpassHz, rate);
  [left, right].forEach((dry, c) => {
    const src = Float32Array.from(dry);
    filterInPlace(src, hp);
    const wet = convolve(src, ir[c], dry.length);
    const g = HALL.wetGain * level;
    for (let i = 0; i < dry.length; i++) dry[i] += g * wet[i];
  });
}

/** The first `length` samples of x * h, by overlap-add FFT convolution. */
export function convolve(x: Float32Array, h: Float32Array, length = x.length + h.length - 1): Float64Array {
  let size = 1;
  while (size < 2 * h.length) size *= 2;
  const block = size - h.length + 1;
  const hRe = new Float64Array(size);
  const hIm = new Float64Array(size);
  hRe.set(h);
  fft(hRe, hIm, false);
  const out = new Float64Array(length);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let start = 0; start < Math.min(x.length, length); start += block) {
    re.fill(0);
    im.fill(0);
    re.set(x.subarray(start, Math.min(x.length, start + block)));
    fft(re, im, false);
    for (let k = 0; k < size; k++) {
      const r = re[k] * hRe[k] - im[k] * hIm[k];
      im[k] = re[k] * hIm[k] + im[k] * hRe[k];
      re[k] = r;
    }
    fft(re, im, true);
    for (let k = 0; k < size && start + k < length; k++) out[start + k] += re[k];
  }
  return out;
}

/** In-place iterative radix-2 FFT; the inverse is scaled by 1/n. */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len *= 2) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1;
      let cIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tRe = re[b] * cRe - im[b] * cIm;
        const tIm = re[b] * cIm + im[b] * cRe;
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const next = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;
        cRe = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n);
}
