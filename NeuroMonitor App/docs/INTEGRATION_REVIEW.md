# Neuro Monitor App: Integration Review of the Model Package

Version 1, 24 Nov 2026. Prepared by the app team (Member 3).
Source: `overall context.zip` (MASTER_PROJECT_DOCUMENTATION_A_TO_Z.md, models/, metrics/).

Status labels used below:
- **VERIFIED**: checked by running the files, not just reading the docs.
- **CONFIRMED (doc)**: stated consistently in the docs and config.
- **CONFLICT**: two sources disagree. The app does not pick one silently.
- **MISSING**: not in the package.

---

## 1. What was verified by actually running the files

All `.tflite` files were loaded with the LiteRT interpreter (`ai-edge-litert`), which supports built-in ops only (no Flex). Each model ran with a zero input.

| File | Loads with built-in ops only | Input | Output | Zero-input output |
|---|---|---|---|---|
| Strided_Conv1D_BiLSTM.tflite | VERIFIED | [1, 300, 6] float32 | [1, 3] float32 | [0.7078, 0.2887, 0.0035] |
| Strided_Conv1D_BiLSTM_quant.tflite | VERIFIED | [1, 300, 6] float32 | [1, 3] float32 | [0.7049, 0.2916, 0.0035] |
| Seizure_Conv1D_BiLSTM.tflite | VERIFIED | [1, 48, 3] float32 | [1, 2] float32 | [0.8223, 0.1777] |
| Seizure_Conv1D_BiLSTM_quant.tflite | VERIFIED | [1, 48, 3] float32 | [1, 2] float32 | [0.8213, 0.1787] |

- No Flex/SELECT_TF_OPS ops in any file. The BiLSTM is unrolled into standard ops, so it should run in a standard Android TFLite runtime.
- The "_quant" files keep float32 input and output (dynamic-range weight quantisation). Their outputs differ slightly from the float models.
- `best_model.*`, `v2_best_model.*` and `Strided_Conv1D_BiLSTM.*` have the same architecture but **different weights** (different MD5 hashes and different outputs on the same input).

**Files the app will ship:** `Strided_Conv1D_BiLSTM.tflite` and `Seizure_Conv1D_BiLSTM.tflite` (float32).
Reasons: the documentation names them as the final exports, the golden vectors are labelled with these names, and they avoid quantisation differences. The size saving from the quantised versions (about 90 KB) does not matter on a phone.

Not shipped: `.keras`, DAE encoder weights, `best_model*`, `v2_best_model*`, `*_quant`.

The coefficients themselves were also checked:
- Track 1 band-pass `b`/`a` = Butterworth order 4, **0.5 to 15 Hz** at 100 Hz (exact match).
- Track 2 band-pass `b`/`a` = Butterworth order 4, 3.0 to 7.5 Hz at 16 Hz (exact match).
- Track 2 65-tap FIR = `scipy.signal.firwin(65, 7.0, window="hamming", fs=100)` (exact match).

---

## 2. Conflicts that need an answer (app is blocked on these)

### C1. Is the Track 1 band-pass filter applied at inference? (CRITICAL)
- Master doc, section 5 step 3: Track 1 uses a band-pass filter before scaling.
- Golden vectors for Track 1: `preprocessed = (raw - constant per channel) / channel_std` **exactly** (offset is identical across all 5 samples in all 5 vectors). No band-pass filter is applied.
- **Question:** Was the deployed Strided model trained on band-pass filtered data or not? The app must match training.

### C2. Track 1 band-pass range
- Config: 0.5 to 15 Hz (and the coefficients really are 0.5 to 15 Hz).
- Master doc: 0.5 to 20 Hz.
- **Question:** Which one was used in training? (Only matters if the answer to C1 is "filtered".)

### C3. Accelerometer units (CRITICAL, a 9.81x scale error if wrong)
- Config Track 1: accelerometer in **m/s^2**.
- Master doc sections 3, 4 and glossary: accelerometer in **g**.
- Config Track 2: **no units given** for the UEA accelerometer data.
- **Questions:** Exact units for Track 1 accel? Exact units for Track 2 accel? The MPU6050 values will be converted to match.

### C4. Demeaning scope
- Master doc step 2: subtract the channel mean over the **whole task recording**.
- Golden vectors: a constant is subtracted per window (consistent with per-window demeaning, but cannot be proven with only 5 samples).
- On a live stream there is no "whole recording". **Question:** At inference, should the app subtract (a) the mean of each 3 s window, or (b) the mean of the whole guided activity, or (c) something else? Also, is the 2 s transient trim applied at the start of each activity?

### C5. Filtering method
- **Question:** For each filter, was it `lfilter` (causal) or `filtfilt` (zero-phase)? Applied per window or on the continuous recording? Any initial conditions (`lfilter_zi`)?

### C6. Track 2 resampling method
- Config says "65-tap FIR anti-aliasing filter **or** polyphase resample(4, 25)". These are not the same computation.
- The 65 taps were designed at fs = 100 Hz. `resample_poly(x, 4, 25)` designs its own filter at the upsampled rate by default.
- **Question:** Send the exact Python lines used to turn a 300-sample 100 Hz window into 48 samples. If `resample_poly` was used, state the `window` argument.

### C7. Track 2 step order
- Config: resample, then band-pass, then demean, then divide by std.
- Master doc section 5: demean, then band-pass, then scale (generic order).
- **Question:** Confirm the Track 2 order used for the golden vectors.

### C8. Track 1 decision rule
- Config offers `untuned: argmax` and `tuned_prior_weights: [1.5, 1.0, 3.0]`.
- The detailed metrics show the tuned version performs worse (Macro-F1 0.388 vs 0.460 for the BiLSTM row).
- **Questions:** Which rule should the app use? If prior weights: multiply probabilities then argmax, or renormalise first?

### C9. Track 2 decision and alert rule
- Config: `series_probability_threshold: 0.5` and `train_rms_threshold: 5.6683`.
- The metrics show the RMS threshold rule is a separate baseline (recall 47%).
- **Questions:** Should the app use only the 0.5 probability threshold? What is the RMS threshold for, and in what units? Is there a rule for consecutive windows and a cooldown before alerting (e.g. k of n windows)? If none exists, the app will show per-window results only, with no automatic alert.

### C10. Session aggregation for Track 1
- **Question:** How should several 3 s windows from one guided activity become one result (mean of probabilities, majority vote, other)?

---

## 3. Gaps in the golden vectors (MISSING)

- Each vector contains only the **first 5 samples** of the window, not the full 300 x 6 (Track 1) or 300 x 3 (Track 2) window. The app cannot run a full end-to-end check against the expected probabilities.
- All 5 Track 2 vectors give about [0.822, 0.178], which is the model's response to near-zero input. They never test a seizure-like case.
- **Request:** a new `golden_vectors_full.json` produced by the **exact inference function**, containing for each case: the full raw 100 Hz window, the full preprocessed tensor fed to the model, and the output probabilities. Please include at least one strong case per class (Normal, Parkinsons-like, ET-like, Seizure-like).

---

## 4. Documentation issues to fix before submission (report accuracy)

- **Track 2 metrics disagree.** Master doc section 12: TP 29, FN 5, FP 3, recall 85.29%, precision 90.62%. `v2_track2_statistical_summary.csv`: TP 25, FN 9, FP 0, recall 73.5%, precision 1.0, and the row is named "Strided Conv1D + BiLSTM", not "Seizure_Conv1D_BiLSTM".
- **Track 1 metrics are attributed to the wrong model.** The "67.9% ET recall, 83.5% Normal recall, Macro-F1 0.4604" figures match the "Untuned Plain Conv1D+BiLSTM" row of the per-class CSV. The consolidated CSV gives the Strided model Macro-F1 0.498 and balanced accuracy 0.595.
- The deployed Strided model was retrained on all 25,500 windows, so it has no held-out score of its own. The report should say the CV metrics describe the architecture, not this exact file.
- Architecture text for the Strided model lists no pooling layer, but the exported file contains a MAX_POOL_2D op.
- "120-byte binary GATT packets" (master doc section 14) vs 68-byte packets (architecture document v1). The hardware member must confirm.
- Claims about features the app does not implement: "Persistent Episode Rule" and "AES-256 encrypted database". Either remove them or give exact parameters to implement.
- The FDA classification claim (MDDS/CDS, 21 CFR 880.6310) is not appropriate for a student prototype that no regulator has reviewed. Suggest replacing it with "Academic prototype. Not evaluated or cleared by any regulator. Not a diagnostic or life-safety device."

---

## 5. Still needed from the hardware member

Confirmed from the package: MPU6050 only (heart rate and EDA dropped), ESP32 streams over BLE, 100 Hz sampling, DLPF_CFG = 4 (about 21 Hz), inference runs on the phone.

Still needed (exact values):
1. BLE advertised device name
2. Service UUID
3. Data characteristic UUID (notify)
4. Control characteristic UUID (write) and command bytes (start, stop, vibrate)
5. Status characteristic UUID and format (battery, firmware)
6. Packet size: 68 bytes or 120 bytes? MTU requested
7. Packet byte layout: field, type, byte offset, endianness (sequence number? timestamp?)
8. Samples per packet and time between packets
9. Channel order in the packet
10. Raw int16 counts or converted units? Accel full-scale range (e.g. +/-4 g) and gyro range (e.g. +/-500 dps)
11. Measured sampling rate (is it exactly 100 Hz, timer-driven?)
12. Push-button event flag: yes/no, which bit
13. Vibration motor on the band: yes/no
14. Wrist placement and the direction of the X, Y, Z axes (a photo with arrows)
15. nRF Connect screenshot showing notifications arriving
16. A 1 to 2 minute raw log (1 min at rest, 1 min shaking)
17. When can the band be tested with a phone?

For the model member, related to hardware: the Apple Watch axis directions used in PADS, so the MPU6050 axes can be mapped to them (or a statement that no mapping is applied).
