// Calculated measurements (signal processing, NOT model output).
// No clinical severity scale is applied: amplitude is reported as a number with units.
import type { PhysicalSample } from '../protocol/units';

export type Measures = {
  accelRmsG: number; // RMS of demeaned acceleration (vector), in g
  gyroRmsRad: number; // RMS of demeaned angular velocity (vector), in rad/s
  dominantHz: number; // peak of the acceleration power spectrum between 1 and 15 Hz
};

export function computeMeasures(w: PhysicalSample[], fs = 100): Measures {
  const n = w.length;
  const keys: (keyof PhysicalSample)[] = ['ax', 'ay', 'az', 'gx', 'gy', 'gz'];
  const means = keys.map((k) => w.reduce((s, p) => s + (p[k] as number), 0) / n);
  const dm = keys.map((k, i) => w.map((p) => (p[k] as number) - means[i]));
  const rms = (chs: number[][]) => Math.sqrt(chs.reduce((s, c) => s + c.reduce((a, v) => a + v * v, 0), 0) / n);

  // Direct DFT over 1-15 Hz (resolution fs/n), summed over the three accelerometer axes.
  let bestHz = 0;
  let bestPow = -1;
  for (let k = Math.ceil((1 * n) / fs); k <= Math.floor((15 * n) / fs); k++) {
    let pow = 0;
    for (let a = 0; a < 3; a++) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < n; i++) {
        const ang = (2 * Math.PI * k * i) / n;
        re += dm[a][i] * Math.cos(ang);
        im -= dm[a][i] * Math.sin(ang);
      }
      pow += re * re + im * im;
    }
    if (pow > bestPow) { bestPow = pow; bestHz = (k * fs) / n; }
  }
  return { accelRmsG: rms(dm.slice(0, 3)), gyroRmsRad: rms(dm.slice(3)), dominantHz: bestHz };
}

// The band has no sequence number; a window is usable only if consecutive timestamps
// are 15 ms apart or less (frames are 10 ms apart).
export function isContinuous(w: PhysicalSample[]): boolean {
  for (let i = 1; i < w.length; i++) {
    const step = w[i].t - w[i - 1].t;
    if (step < 0 || step > 15) return false;
  }
  return true;
}
