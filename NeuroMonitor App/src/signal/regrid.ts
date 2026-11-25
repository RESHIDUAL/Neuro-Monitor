// Rebuilds an even 100 Hz signal from the band's own timestamps.
// The real ESP8266 band does not always deliver frames exactly 10 ms apart (Wi-Fi delays,
// a busy loop), so counting samples is not enough. Each frame carries timestamp_ms, so we
// place samples on a 10 ms grid by linear interpolation. Holes longer than MAX_HOLE_MS are
// never filled: the signal is split there and no window crosses the break.
import type { PhysicalSample } from '../protocol/units';

export const STEP_MS = 10; // 100 Hz, the rate the models were trained on
export const MAX_HOLE_MS = 50; // largest hole bridged by interpolation (keeps content up to 10 Hz)
export const WINDOW = 300; // 3 s

const KEYS = ['ax', 'ay', 'az', 'gx', 'gy', 'gz'] as const;

// Splits at backwards steps (band restart) and holes > MAX_HOLE_MS; drops duplicate timestamps.
function segments(samples: PhysicalSample[]): PhysicalSample[][] {
  const out: PhysicalSample[][] = [];
  let cur: PhysicalSample[] = [];
  for (const s of samples) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const step = s.t - prev.t;
      if (step === 0) continue;
      if (step < 0 || step > MAX_HOLE_MS) { out.push(cur); cur = []; }
    }
    cur.push(s);
  }
  if (cur.length) out.push(cur);
  return out;
}

// Linear interpolation of one segment onto a grid starting at tStart, every STEP_MS, up to its end.
function toGrid(seg: PhysicalSample[], tStart: number): PhysicalSample[] {
  const out: PhysicalSample[] = [];
  let j = 0;
  for (let t = tStart; t <= seg[seg.length - 1].t; t += STEP_MS) {
    while (j < seg.length - 2 && seg[j + 1].t < t) j++;
    const a = seg[j];
    const b = seg[j + 1] ?? a;
    const f = b.t === a.t ? 0 : Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    const p = { t } as PhysicalSample;
    for (const k of KEYS) p[k] = a[k] + f * (b[k] - a[k]);
    out.push(p);
  }
  return out;
}

// Live screen: the most recent full 3 s window, or null if the last 3 s contain a break.
export function latestWindow(buf: PhysicalSample[]): PhysicalSample[] | null {
  if (buf.length < 2) return null;
  const segs = segments(buf.slice(-1500));
  const last = segs[segs.length - 1];
  const tEnd = last[last.length - 1].t;
  const tStart = tEnd - (WINDOW - 1) * STEP_MS;
  if (last[0].t > tStart) return null;
  const g = toGrid(last, tStart);
  return g.length >= WINDOW ? g.slice(0, WINDOW) : null;
}

// Guided test: all non-overlapping 3 s windows of one activity, after trimming the first trimMs.
export function activityWindows(samples: PhysicalSample[], trimMs: number): { windows: PhysicalSample[][]; expected: number } {
  if (samples.length < 2) return { windows: [], expected: 0 };
  const t0 = samples[0].t + trimMs;
  const tLast = samples[samples.length - 1].t;
  const expected = Math.max(0, Math.floor(((tLast - t0) / STEP_MS + 1) / WINDOW));
  const windows: PhysicalSample[][] = [];
  for (const seg of segments(samples.filter((s) => s.t >= t0 - MAX_HOLE_MS))) {
    const start = Math.max(seg[0].t, t0);
    if (seg[seg.length - 1].t < start) continue;
    const g = toGrid(seg, start);
    for (let i = 0; i + WINDOW <= g.length; i += WINDOW) windows.push(g.slice(i, i + WINDOW));
  }
  return { windows, expected };
}

// Timing of the incoming frames, shown on the Live screen to diagnose the band.
export function frameTiming(buf: PhysicalSample[]): { medianMs: number; maxMs: number; ratePerSec: number } | null {
  const w = buf.slice(-300);
  if (w.length < 3) return null;
  const steps: number[] = [];
  for (let i = 1; i < w.length; i++) { const d = w[i].t - w[i - 1].t; if (d > 0) steps.push(d); }
  if (!steps.length) return null;
  const sorted = [...steps].sort((x, y) => x - y);
  const span = w[w.length - 1].t - w[0].t;
  return { medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted[sorted.length - 1], ratePerSec: span > 0 ? ((w.length - 1) * 1000) / span : 0 };
}
