# Changelog

## Patch 5 (25 Nov 2026)
- Guided test core activities now map one-to-one to the five PADS training tasks (Relaxed, RelaxedTask, StretchHold, LiftHold, HoldWeight). Wing posture removed; finger-to-nose moved to contextual (not in training).

## Patch 4 (25 Nov 2026)
- Profile A (old receiver pipeline) removed from Settings; the app always uses the confirmed training pipeline.
- PDF no longer says "unconfirmed".

## Patch 2 and 3 (25 Nov 2026)
- Preprocessing confirmed from Eshwar's training notebooks (see MODEL_ANSWERS.md).
- Track 2, Profile B: causal lfilter band-pass (3 to 7.5 Hz), replacing zero-phase sosfiltfilt, to match notebook 13.
- Profile B renamed "confirmed" and set as the default; the "preprocessing unconfirmed" labels were removed.
- verify_preprocess.py reference updated to notebook 13; all four outputs PASS against scipy.
- Real band fix: windows are rebuilt on an even 100 Hz grid from the band's timestamps (src/signal/regrid.ts). Holes up to 50 ms are interpolated; longer holes split the signal and are never bridged.
- Live screen shows the band's real sample rate and frame-step median/max, to diagnose the band.

## Build 2 + Patch 1 (24 Nov 2026, evening)
- Settings typing no longer drops letters (screen updates before saving).
- Home: "Sessions" card renamed "Seizure-like"; cleaner streaming label.
- In-app demo signal keeps real time (100 samples per second).
- Guided test keeps running when switching tabs.
- Results: note that dominant frequency at very low amplitude reflects sensor noise.

## Build 2 (24 Nov 2026)
- Full app: consent, Home dashboard, guided test (5 core + 3 contextual), live monitor, medications, PDF report, settings.
- Two preprocessing profiles (receiver script / model package), user-selected, labelled unconfirmed.
- In-app demo signal (synthetic, labelled).
- Models loaded through expo-asset (fixes "no protocol" error in release APKs).
- Added expo-sqlite, react-native-svg, expo-print, expo-sharing, expo-keep-awake, expo-asset.

## Build 1 (24 Nov 2026)
- UDP receiver and 160-byte packet decoder with gap detection.
- Model runtime self-test for both TFLite models (PASS on emulator, max difference 4e-5).
- Laptop band simulator (`tools/band_simulator.py`).
- BLE library removed after the hardware switched to Wi-Fi UDP.
