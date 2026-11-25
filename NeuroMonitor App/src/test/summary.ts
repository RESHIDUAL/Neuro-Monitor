// Turns stored activity results into the core-test summary.
// Rule source: architecture document v1, section 8 ("average window probabilities across the guided test").
// Only CORE activities are used. Contextual activities are never included.
import type { ActivityResultRow } from '../data/db';
import { decideTrack1, ProfileId } from '../signal/preprocess';

export type CoreSummary = {
  validWindows: number;
  pNormal: number; pPd: number; pEt: number; pSeizureMax: number;
  pattern: 'Normal' | 'Parkinsons-like' | 'ET-like';
  seizureLikeWindows: number;
} | null;

export function coreSummary(rows: ActivityResultRow[], profile: ProfileId): CoreSummary {
  const core = rows.filter((r) => r.section === 'core' && r.windows_valid > 0 && r.p_normal !== null);
  const n = core.reduce((s, r) => s + r.windows_valid, 0);
  if (n === 0) return null;
  // Window-weighted mean, equivalent to averaging every valid core window.
  const w = (k: 'p_normal' | 'p_pd' | 'p_et') => core.reduce((s, r) => s + (r[k] as number) * r.windows_valid, 0) / n;
  const pNormal = w('p_normal'); const pPd = w('p_pd'); const pEt = w('p_et');
  return {
    validWindows: n, pNormal, pPd, pEt,
    pSeizureMax: Math.max(...core.map((r) => r.p_seizure ?? 0)),
    pattern: decideTrack1(profile, { normal: pNormal, pd: pPd, et: pEt }),
    seizureLikeWindows: core.reduce((s, r) => s + (r.seizure_like_windows ?? 0), 0),
  };
}

export function patternSentence(p: 'Normal' | 'Parkinsons-like' | 'ET-like'): string {
  if (p === 'Normal') return 'Pattern consistent with normal movement';
  if (p === 'Parkinsons-like') return 'Pattern consistent with Parkinsons-like movement';
  return 'Pattern consistent with ET-like movement';
}

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`);
