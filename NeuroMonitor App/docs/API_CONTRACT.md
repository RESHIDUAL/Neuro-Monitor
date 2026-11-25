# Interface contracts

## A. Band to app (UDP, firmware v1)
| Item | Value |
|---|---|
| Transport | UDP, port 8888, band sends to the hotspot gateway (phone) |
| Rate | 1 packet every 100 ms |
| Packet | 160 bytes = 10 frames x 16 bytes |
| Frame | little-endian `<I h h h h h h`: timestamp_ms (uint32), acc_x, acc_y, acc_z, gyro_x, gyro_y, gyro_z (int16 counts) |
| Scale (v1) | accel 16384 counts/g (+/-2 g), gyro 131 counts/dps (+/-250 dps); gyro offsets removed on the band |
| Continuity | no sequence number; a step over 15 ms between frames counts as a gap; windows with gaps are discarded |
| Downlink | 5 bytes (alert_code, p_norm, p_pd, p_et, p_seiz). **Disabled in the app** until the OLED wording is corrected |

Packets of any other size are rejected and counted.

## B. App to models
| Model | Input | Output |
|---|---|---|
| Strided_Conv1D_BiLSTM.tflite (MD5 04dd5048...) | float32 [1, 300, 6]: acc x,y,z (g), gyro x,y,z (rad/s), 3 s at 100 Hz, preprocessed | softmax [Normal, Parkinsons-like, ET-like] |
| Seizure_Conv1D_BiLSTM.tflite (MD5 ae3e0c7c...) | float32 [1, 48, 3]: acc x,y,z resampled to 16 Hz, preprocessed | softmax [Normal, Seizure-like (simulated)] |

Both models use built-in TFLite ops only (checked with LiteRT). Zero-input reference outputs used by the self-test:
Track 1 [0.7078, 0.2887, 0.0035], Track 2 [0.8223, 0.1777].

## C. Inside the app
- `predictWindow(profile, window: PhysicalSample[300]) -> { pNormal, pPd, pEt, pSeizure, track1Pattern, seizureLike, profile }`
- `computeMeasures(window) -> { accelRmsG, gyroRmsRad, dominantHz }` (calculated, not model output)
- `hub.onSamples(listener)` delivers batches of 10 samples with their source label.
