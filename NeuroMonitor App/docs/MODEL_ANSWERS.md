# Answers to the open model questions (R1 to R7 and C1 to C10)

Source: Eshwar's training notebooks (01 to 15), read on 25 Nov 2026.
Each answer says where it comes from: **Code** = read directly from the notebooks, **Assumption** = not in the code, our sensible choice.

| # | Question | Answer | Basis |
|---|---|---|---|
| R1 | Track 1 scaling | Config `channel_std` [0.0278, 0.0549, 0.0411, 0.3107, 0.1463, 0.1034]. The receiver's GLOBAL_STD is wrong. | Code: NB12 cell 9, NB13 cell 11 |
| R2 / C1 / C2 | Track 1 band-pass | None. Training only demeans and scales. The PADS accelerometer data is already gravity-free ("AC filtered"), so no filter was applied. The `bandpass_filter` block in the config is exported but never used. | Code: NB10 cell 4, NB12 cell 9, NB01 cell 13 |
| R3 | Track 2 scaling | Per-channel `channel_std` [0.2315, 0.5230, 0.2190], from UEA training windows. Not 0.428. | Code: NB12 cell 11 |
| R4 / C6 | Track 2 resampling | `scipy.signal.resample_poly(x, 4, 25, axis=0)` with the default window. The 65-tap FIR is not used in the reference path. | Code: NB13 cell 11, NB15 cell 3 |
| C5 / C7 | Track 2 filter and order | resample, then **causal** `lfilter(butter(4, [3, 7.5], fs=16))`, then demean the window, then divide by channel_std. | Code: NB13 cell 11 |
| R5 / C8 | Track 1 decision | argmax. The prior weights were tuned per fold during CV, not fixed, and the golden vectors use argmax. | Code: NB11, NB12, NB13 |
| C9 | Track 2 decision | Seizure-like if mean p(seizure) >= 0.5. The RMS threshold 5.6683 is a separate baseline and is not used. | Code: NB13 cell 7 |
| R6 | Seizure alert rule | No consecutive-window rule or cooldown exists in the code. The app shows per-window results and the per-activity average, with no automatic alert. | Code (absence) |
| R7 | Window hop | Training used non-overlapping 3 s windows (stride 300). The app uses a 1 s hop on the Live screen for display only. | Code + app choice |
| C3 | Units | Accelerometer in **g** (PADS and UEA plots are labelled g, and the std values only make sense in g). Gyroscope in rad/s. The config label "m/s^2" is a typo. | Code: NB01 cells 9 and 13 |
| C4 | Demeaning | Per 3 s window, per channel. The first 2 s (200 samples) of each recording are trimmed. | Code: NB03 cell 1, NB12 |
| C10 | Combining windows | Mean of window probabilities, then argmax (Track 1) or >= 0.5 (Track 2). | Code: NB11, NB13 |
| Axes | Apple Watch to MPU6050 mapping | No mapping is applied anywhere in the code. The app uses the band axes as they are. | Assumption (absence) |

## Change made to the app (Patch 2)

Profile B now matches the notebooks exactly. One bug was fixed: Track 2 used a zero-phase filter (`sosfiltfilt`), but the training reference uses a causal `lfilter`. On a test window, the two differed by up to 169% of the signal peak. After the fix, the app's output matches scipy with zero error on all test windows (`tools/verification/verify_preprocess.py`).

## Metrics to use in the report (from the notebooks)

- **Track 2 seizure model (exported TFLite, 138 UEA test series):** TP 29, FN 5, FP 3, TN 101. Recall 85.3% (Wilson 95% CI 69.9% to 93.6%), precision 90.6%, macro-F1 0.920. Source: NB13 cell 7. The 25/9/0 row in the CSV is a different model.
- **Track 1:** the deployed Strided Conv1D + BiLSTM was retrained on all 25,500 windows, so it has no held-out score of its own. Report the cross-validated architecture score from NB11 and say so.

## Limitations that remain

- Both models were trained on public datasets (Apple Watch for PADS, a wrist sensor for UEA), not on the MPU6050 band. The PADS data was gravity-free at source, but the band includes gravity, which per-window demeaning removes only approximately.
- UEA seizure data is **simulated** by healthy volunteers. NB02 shows that device origin can be partly predicted from the signal, so seizure versus tremor separation is not validated.
