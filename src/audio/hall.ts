// A concert hall for the piano. The synth plays dry, as if close-miked in a dead room;
// this is the room: a synthetic impulse response, decaying noise in octave bands (the low
// notes ring longer than the high ones, as in a hall) after a short pre-delay and a few
// early reflections. The app plays it through a ConvolverNode; kespressivo's offline renders
// convolve with the same response (its scripts/lib/hall.ts), so both sound alike.

export const HALL = {
  /** Reverberation time in the middle of the range (500 Hz–1 kHz), seconds. */
  rt: 1.8,
  /** Bass below this is kept out of the hall, so it stays clear. */
  highpassHz: 110,
  /**
   * Level of the hall against the direct sound, for an impulse response of unit energy. Set so that
   * in Var det en dröm? (Salamander piano) the hall is 9 dB below the direct sound, as in the clip
   * that was chosen.
   */
  wetGain: 0.214,
};

/** Each octave band's reverberation time, relative to `rt`. */
const BANDS: [hz: number, rt: number][] = [
  [125, 1.15],
  [250, 1.08],
  [500, 1],
  [1000, 0.95],
  [2000, 0.83],
  [4000, 0.66],
  [8000, 0.5],
  [16000, 0.33],
];

/** The hall's impulse response, left and right, scaled to unit energy. The same for the same arguments. */
export function hallImpulse(rate: number, rt = HALL.rt, seed = 7): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const n = Math.round(rate * rt * 1.8);
  const preDelay = Math.round(0.018 * rate);
  const random = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const channels = [0, 1].map(() => {
    const tail = new Float64Array(n);
    for (const [hz, k] of BANDS) {
      if (hz > 0.45 * rate) continue;
      // An octave band-pass, applied twice for steeper sides.
      const bp = bandPass(hz, Math.SQRT2, rate);
      const noise = Float64Array.from({ length: n }, gauss);
      filterInPlace(noise, bp);
      filterInPlace(noise, bp);
      const decay = -6.91 / (rt * k * rate);
      for (let i = 0; i < n; i++) tail[i] += noise[i] * Math.exp(decay * i);
    }
    // The diffuse sound builds up over the first tens of milliseconds.
    for (let i = 0; i < n; i++) tail[i] *= 1 - Math.exp(-i / (0.025 * rate));
    const out = new Float64Array(n);
    out.set(tail.subarray(0, n - preDelay), preDelay);
    let early = 0;
    for (let i = 0; i < 2000; i++) early += tail[i] * tail[i];
    early = Math.sqrt(early / 2000);
    for (let r = 0; r < 14; r++) {
      const d = 0.006 + 0.079 * random();
      out[Math.round(d * rate)] += (random() < 0.5 ? -1 : 1) * 2.5 * Math.exp(-d / 0.05) * early;
    }
    return out;
  });
  let energy = 0;
  for (const c of channels) for (const v of c) energy += v * v;
  const scale = 1 / Math.sqrt(energy / channels.length);
  return [Float32Array.from(channels[0], (v) => v * scale), Float32Array.from(channels[1], (v) => v * scale)];
}

export interface Biquad {
  b: [number, number, number];
  a: [number, number];
}

/** RBJ cookbook band-pass with 0 dB peak gain. */
function bandPass(hz: number, q: number, rate: number): Biquad {
  const w = (2 * Math.PI * hz) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return { b: [alpha / a0, 0, -alpha / a0], a: [(-2 * Math.cos(w)) / a0, (1 - alpha) / a0] };
}

/** RBJ cookbook high-pass; Q = √½ is a Butterworth, as Web Audio's BiquadFilterNode with Q = −3.01 dB. */
export function highPass(hz: number, rate: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * hz) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  return { b: [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0], a: [(-2 * c) / a0, (1 - alpha) / a0] };
}

export function filterInPlace(x: Float32Array | Float64Array, { b, a }: Biquad): void {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    x[i] = y0;
  }
}

/** A small seeded random number generator, so the hall is the same every time. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
