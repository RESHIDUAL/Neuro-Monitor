# Architecture (v3, as built in Build 2)

## Topology
```
ESP8266 + MPU6050 band --(UDP, 160 B every 100 ms, port 8888)--> Android phone (hotspot owner)
                                                                  all processing and storage on the phone
```
Fallback: the same firmware sends to a Windows laptop hotspot running `esp8266_receiver.py`.

## Data flow inside the app
```
UDP socket (react-native-udp) ──> decodePacket (src/protocol/packet.ts)
                                      │ 10 frames: timestamp + 6 int16
                                      ▼
                               toPhysical (units.ts): g and rad/s, scale from Settings
                                      ▼
In-app demo generator ───────> StreamHub (src/stream/hub.ts): 30 s ring buffer, status, source label
                                      ▼
                   ┌──────────────────┴──────────────────┐
           Guided test (TestScreen)               Live monitor (LiveScreen)
           2 s trim, 3 s windows on an even        latest 3 s every 1 s
           100 Hz grid rebuilt from timestamps     (src/signal/regrid.ts)
                   └──────────────────┬──────────────────┘
                                      ▼
             predictWindow (src/ml/runner.ts)
               preprocessTrack1 / preprocessTrack2 (src/signal/preprocess.ts, confirmed pipeline)
               Strided_Conv1D_BiLSTM.tflite [1,300,6] -> Normal / Parkinsons-like / ET-like
               Seizure_Conv1D_BiLSTM.tflite [1,48,3]  -> Normal / Seizure-like (simulated)
                                      ▼
             computeMeasures (src/signal/measures.ts): RMS amplitude, dominant frequency
                                      ▼
             SQLite (src/data/db.ts) ──> Home, Results, Report (PDF via expo-print)
```

## Module boundaries
- The UI never decodes packets or touches models directly; it calls the hub, `predictWindow` and the database.
- Preprocessing is pure TypeScript and is checked against scipy (`tests/`).
- Every stored result carries `data_source` (LIVE_BAND, SIMULATOR, DEMO) and the preprocessing `profile` (always `config`, the confirmed pipeline, from Patch 4).

## Preprocessing (confirmed against the training notebooks, 25 Nov 2026)
| | Track 1 (tremor) | Track 2 (seizure-like) |
|---|---|---|
| Input | 300 x 6 at 100 Hz, g and rad/s | 3 accelerometer channels, resample_poly(4,25) to 48 x 3 |
| Filter | none (PADS data is already gravity-free) | causal Butterworth order 4, 3 to 7.5 Hz (lfilter) |
| Scaling | demean each window, divide by channel_std | demean each window, divide by channel_std |
| Decision | argmax | seizure-like if p > 0.5 |

Source: Eshwar's notebooks 10, 12 and 13 (`docs/MODEL_ANSWERS.md`). The TypeScript output matches scipy with zero
error on the test windows (`tools/verification/verify_preprocess.py`). The earlier receiver-script profile (A) was
removed in Patch 4 because its values did not match training.

## Model loading
Bundled models are copied to the app cache with expo-asset and loaded from a `file://` path. Loading them by resource
name failed in the release APK ("no protocol"), so this path is required.

## Security and privacy
No network access beyond the local UDP socket, no accounts, no cloud. Data lives in the app's private SQLite database.
Android permission: INTERNET only. The app targets SDK 36, so Android 17's local-network permission does not apply yet.
