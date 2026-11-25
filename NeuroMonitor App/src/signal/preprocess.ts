// Preprocessing. Only the confirmed training pipeline ('config') is used; the old receiver profile is kept only so old saved sessions still display a name.
// Profile B is the confirmed one: it reproduces Eshwar's training notebooks (10, 12, 13).
// Profile A (the Python receiver) is kept only for comparison.
import { demean, sosfiltfilt, lfilterCausal, resample300to48, toChannels, toRowMajorFloat32 } from './dsp';
import {
  SOS_T1_RECEIVER, ZI_T1_RECEIVER, PADLEN_T1_RECEIVER, SOS_T2, ZI_T2, PADLEN_T2,
  RECEIVER_T1_STD, RECEIVER_T2_DIVISOR, CONFIG_T1_STD, CONFIG_T2_STD,
} from './coefficients';

export type ProfileId = 'receiver' | 'config';

export const PROFILES: Record<ProfileId, { name: string; short: string; description: string[] }> = {
  receiver: {
    name: 'Old receiver pipeline (removed, wrong values)',
    short: 'Old receiver pipeline (removed)',
    description: [
      'Track 1: demean window, band-pass 0.5 to 20 Hz (zero-phase), divide by receiver GLOBAL_STD.',
      'Track 2: resample 100 to 16 Hz (resample_poly 4/25), demean, band-pass 3 to 7.5 Hz (zero-phase), divide by 0.428.',
      'Decisions: seizure-like if p > 0.50, PD-like if p > 0.65, ET-like if p > 0.55 (receiver thresholds, not in the model config).',
    ],
  },
  config: {
    name: 'Training pipeline (confirmed from notebooks 10, 12, 13)',
    short: 'Training pipeline (confirmed)',
    description: [
      'Track 1: demean each 3 s window, divide by channel_std. No band-pass (PADS data was already gravity-free; training applied none).',
      'Track 2: resample_poly 4/25, causal band-pass 3 to 7.5 Hz (lfilter), demean, divide by channel_std.',
      'Decisions: Track 1 argmax, Track 2 p >= 0.5. Activity result = mean of window probabilities (as in training).',
      'Units: accelerometer in g, gyroscope in rad/s (the config file label "m/s^2" is a typo).',
    ],
  },
};

// window: 300 rows of [ax, ay, az (g), gx, gy, gz (rad/s)]
export function preprocessTrack1(profile: ProfileId, window: number[][]): Float32Array {
  const ch = toChannels(window, 6).map(demean);
  if (profile === 'receiver') {
    const out = ch.map((c, k) => sosfiltfilt(SOS_T1_RECEIVER, ZI_T1_RECEIVER, PADLEN_T1_RECEIVER, c).map((v) => v / RECEIVER_T1_STD[k]));
    return toRowMajorFloat32(out, 300);
  }
  const out = ch.map((c, k) => c.map((v) => v / CONFIG_T1_STD[k]));
  return toRowMajorFloat32(out, 300);
}

export function preprocessTrack2(profile: ProfileId, window: number[][]): Float32Array {
  const acc = toChannels(window, 6).slice(0, 3);
  const resampled = acc.map(resample300to48);
  if (profile === 'receiver') {
    const out = resampled.map((c) => sosfiltfilt(SOS_T2, ZI_T2, PADLEN_T2, demean(c)).map((v) => v / RECEIVER_T2_DIVISOR));
    return toRowMajorFloat32(out, 48);
  }
  // Notebook 13: resample_poly(4, 25) -> lfilter(butter(4, [3, 7.5], fs=16)) -> demean -> / channel_std
  const out = resampled.map((c, k) => demean(lfilterCausal(SOS_T2, c)).map((v) => v / CONFIG_T2_STD[k]));
  return toRowMajorFloat32(out, 48);
}

export type Track1Probs = { normal: number; pd: number; et: number };

export function decideTrack1(profile: ProfileId, p: Track1Probs): 'Normal' | 'Parkinsons-like' | 'ET-like' {
  if (profile === 'receiver') {
    if (p.pd > 0.65) return 'Parkinsons-like';
    if (p.et > 0.55) return 'ET-like';
    return 'Normal';
  }
  const best = Math.max(p.normal, p.pd, p.et);
  return best === p.pd ? 'Parkinsons-like' : best === p.et ? 'ET-like' : 'Normal';
}

export const SEIZURE_THRESHOLD = 0.5; // same in receiver and config
