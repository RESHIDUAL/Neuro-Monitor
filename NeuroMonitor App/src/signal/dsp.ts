// Signal-processing building blocks, written to match scipy.signal exactly
// (verified numerically against scipy on full windows, see tests/preprocess.test.ts).
import { RESAMPLE_H, RESAMPLE_UP, RESAMPLE_DOWN, RESAMPLE_PRE_REMOVE } from './coefficients';

export type Signal = number[]; // one channel

export function mean(x: Signal): number {
  let s = 0;
  for (const v of x) s += v;
  return s / x.length;
}

export function demean(x: Signal): Signal {
  const m = mean(x);
  return x.map((v) => v - m);
}

// scipy.signal.sosfilt with initial conditions zi (per section [z0, z1]), direct form II transposed.
function sosfilt(sos: number[][], x: Signal, zi: number[][]): Signal {
  let y = x.slice();
  for (let s = 0; s < sos.length; s++) {
    const [b0, b1, b2, , a1, a2] = sos[s];
    let z0 = zi[s][0];
    let z1 = zi[s][1];
    const out = new Array<number>(y.length);
    for (let n = 0; n < y.length; n++) {
      const xn = y[n];
      const yn = b0 * xn + z0;
      z0 = b1 * xn - a1 * yn + z1;
      z1 = b2 * xn - a2 * yn;
      out[n] = yn;
    }
    y = out;
  }
  return y;
}

// Causal filter from rest: scipy.signal.lfilter(b, a, x) with zero initial state.
// Implemented as cascaded second-order sections (same filter, better numerics).
// Track 2 uses this because notebook 13 (golden vectors) filters with lfilter, not filtfilt.
export function lfilterCausal(sos: number[][], x: Signal): Signal {
  return sosfilt(sos, x, sos.map(() => [0, 0]));
}

// scipy.signal.sosfiltfilt(sos, x) with its defaults: padtype='odd', padlen as computed by scipy,
// initial conditions sosfilt_zi scaled by the first sample of each pass.
export function sosfiltfilt(sos: number[][], zi: number[][], padlen: number, x: Signal): Signal {
  const n = x.length;
  if (n <= padlen) throw new Error(`signal length ${n} must exceed padlen ${padlen}`);
  // odd extension
  const ext: Signal = [];
  for (let i = padlen; i >= 1; i--) ext.push(2 * x[0] - x[i]);
  for (const v of x) ext.push(v);
  for (let i = n - 2; i >= n - 1 - padlen; i--) ext.push(2 * x[n - 1] - x[i]);

  const scaled = (z: number[][], v: number) => z.map(([a, b]) => [a * v, b * v]);
  const fwd = sosfilt(sos, ext, scaled(zi, ext[0]));
  const rev = fwd.slice().reverse();
  const bwd = sosfilt(sos, rev, scaled(zi, rev[0]));
  const y = bwd.reverse();
  return y.slice(padlen, padlen + n);
}

// scipy.signal.resample_poly(x, 4, 25) for a 300-sample input (default window, zero padding).
// upfirdn: upsample by inserting zeros, convolve with h, keep every DOWN-th sample.
export function resample300to48(x: Signal): Signal {
  const up = RESAMPLE_UP;
  const down = RESAMPLE_DOWN;
  const h = RESAMPLE_H;
  const nOut = Math.ceil((x.length * up) / down); // 48
  const out: Signal = [];
  for (let k = RESAMPLE_PRE_REMOVE; k < RESAMPLE_PRE_REMOVE + nOut; k++) {
    const m = k * down; // index in the upsampled, convolved sequence
    let acc = 0;
    // y[m] = sum_j h[j] * xu[m - j], with xu[i] = x[i/up] when i % up == 0
    const jStart = Math.max(0, m - (x.length - 1) * up);
    for (let j = jStart; j < h.length && j <= m; j++) {
      const i = m - j;
      if (i % up === 0) acc += h[j] * x[i / up];
    }
    out.push(acc);
  }
  return out;
}

// Splits [n][c] rows into c channels and back.
export function toChannels(rows: number[][], c: number): Signal[] {
  const ch: Signal[] = Array.from({ length: c }, () => []);
  for (const r of rows) for (let k = 0; k < c; k++) ch[k].push(r[k]);
  return ch;
}

export function toRowMajorFloat32(ch: Signal[], n: number): Float32Array {
  const c = ch.length;
  const out = new Float32Array(n * c);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) out[i * c + k] = ch[k][i];
  return out;
}
