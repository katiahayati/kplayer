// How loud audio sounds over time: EBU R128 / ITU-R BS.1770 momentary loudness
// (K-weighted, 400 ms windows), in LUFS. The same measure as tools/dynamics_arc.py
// (pyloudnorm's filters), so recordings and renders can be compared.

const WINDOW = 0.4;
const HOP = 0.05;

/** A biquad from the RBJ cookbook, as pyloudnorm builds its K-weighting. */
function biquad(type: 'high_shelf' | 'high_pass', gainDb: number, q: number, fc: number, rate: number) {
  const A = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * fc) / rate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  let b: number[];
  let a: number[];
  if (type === 'high_shelf') {
    const s = 2 * Math.sqrt(A) * alpha;
    b = [A * (A + 1 + (A - 1) * cos + s), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - s)];
    a = [A + 1 - (A - 1) * cos + s, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - s];
  } else {
    b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    a = [1 + alpha, -2 * cos, 1 - alpha];
  }
  return { b: b.map((x) => x / a[0]), a: a.map((x) => x / a[0]) };
}

function filter(x: Float32Array, { b, a }: { b: number[]; a: number[] }): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** Mean K-weighted power in 400 ms windows every 50 ms, of the mono mix; with each window's centre time. */
export function momentaryPower(left: Float32Array, right: Float32Array, rate: number): { times: Float64Array; power: Float64Array } {
  const mono = new Float32Array(left.length);
  for (let i = 0; i < mono.length; i++) mono[i] = (left[i] + right[i]) / 2;
  const weighted = filter(filter(mono, biquad('high_shelf', 4, Math.SQRT1_2, 1500, rate)), biquad('high_pass', 0, 0.5, 38, rate));
  const cum = new Float64Array(weighted.length + 1);
  for (let i = 0; i < weighted.length; i++) cum[i + 1] = cum[i] + weighted[i] * weighted[i];
  const win = Math.round(WINDOW * rate);
  const hop = Math.round(HOP * rate);
  const n = Math.max(0, Math.floor((weighted.length - win) / hop) + 1);
  const times = new Float64Array(n);
  const power = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const s = k * hop;
    times[k] = (s + win / 2) / rate;
    power[k] = (cum[s + win] - cum[s]) / win;
  }
  return { times, power };
}

export const lufs = (power: number) => -0.691 + 10 * Math.log10(power + 1e-12);

/** Loudness of each quarter note q = 0, 1, 2…, given where each falls in time (as dynamics_arc.py). */
export function beatLoudness(m: { times: Float64Array; power: Float64Array }, timeAt: (q: number) => number, endQ: number): { q: number; lufs: number }[] {
  const out: { q: number; lufs: number }[] = [];
  for (let q = 0; q <= Math.floor(endQ); q++) {
    let t0 = timeAt(q);
    let t1 = timeAt(Math.min(q + 1, endQ));
    if (t1 - t0 < WINDOW) {
      const mid = (t0 + t1) / 2;
      t0 = mid - WINDOW / 2;
      t1 = mid + WINDOW / 2;
    }
    let sum = 0;
    let count = 0;
    for (let k = 0; k < m.times.length; k++) {
      if (m.times[k] < t0) continue;
      if (m.times[k] > t1) break;
      sum += m.power[k];
      count++;
    }
    if (count) out.push({ q, lufs: lufs(sum / count) });
  }
  return out;
}
