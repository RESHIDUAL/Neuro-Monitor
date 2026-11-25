# Neuro Monitor (Android app)

Android app for the Context-Aware Wearable Neuro-Monitor project (MSc Neural Networks and Deep Learning, team of three).
It receives 6-axis motion data from an ESP8266 + MPU6050 wristband over Wi-Fi (UDP), runs two Conv1D-BiLSTM
TFLite models on the phone, and shows guided-test results, live monitoring, a medication log and a PDF report
for a neurologist.

**Screening aid only. Not a diagnosis.** Academic prototype. It cannot diagnose Parkinson's disease, essential tremor
or epilepsy, it is not a life-safety device, and it never recommends medication changes.

## What it does
- **Guided test**: five activities matching the five PADS training tasks (rest with eyes closed, rest with mental
  arithmetic, lift and stretch arms, keep arms lifted, hold a ~1 kg weight), 30 s each. These give the main result.
  Optional finger-to-nose, drinking, writing and walking are recorded separately and labelled as not validated.
- **Live monitor**: raw signal, calculated measures (RMS amplitude, dominant frequency) and model output, every second.
- **Medications**: log medicines and dose times. Shown against test times in the report.
- **Report**: PDF with core results, a separate contextual section, medication log and limitations.
- **Settings**: patient profile, data source (Wi-Fi band or in-app demo signal), preprocessing profile, sensor range,
  model self-test.

## Tech stack (pinned)
Expo SDK 57.0.34, React Native 0.86.3, TypeScript. react-native-udp 4.1.7, react-native-fast-tflite 3.0.1
(+ react-native-nitro-modules 0.37.2), expo-sqlite 57.0.7, react-native-svg 15.15.4, expo-print 57.0.2,
expo-sharing 57.0.27, expo-asset 57.0.22, expo-keep-awake 57.0.2. Android only.

## Build (Windows)
Requirements: Node 24, JDK 17, Android SDK platform 36, NDK 27.1.12297006, CMake 3.22.1.
```powershell
npm ci
npx expo run:android                       # development build on emulator or phone
cd android
.\gradlew assembleRelease "-PreactNativeArchitectures=x86_64,arm64-v8a"
# APK: android\app\build\outputs\apk\release\app-release.apk
```
Full step-by-step setup: `BUILD_STEPS.md`.

## Testing without the band
- In-app demo signal: More -> Data source -> In-app demo signal (labelled SYNTHETIC everywhere).
- Laptop simulator into the emulator:
  `adb emu redir add udp:8888:8888` then `python tools\band_simulator.py --mode rest|tremor5|tremor7|shake`.

## Using the real band
Phone hotspot on 2.4 GHz with the band's Wi-Fi name and password. Firmware sends 160-byte UDP packets to the
hotspot gateway (the phone) on port 8888. App: More -> Data source -> Wi-Fi wristband (UDP).

## Preprocessing (confirmed 25 Nov 2026)
The app uses one preprocessing pipeline, confirmed line by line against the training notebooks (see
`docs/MODEL_ANSWERS.md`). The earlier open questions R1 to R7 (`docs/INTEGRATION_REVIEW.md`,
`docs/FIRMWARE_RECEIVER_REVIEW.md`) are kept as a record and are answered there.

## Known open items
- Real-band test: the first test received about 1 packet/s instead of 10. The app now rebuilds an even 100 Hz grid from
  timestamps; the firmware fix (disable Wi-Fi sleep, remove delays and frequent OLED updates in `loop()`) is with the
  hardware member.
- The band and caretaker unit's LED/buzzer shaking alert runs in firmware and is not linked to the models.

## Folder layout
```
App.tsx               app shell, consent, bottom navigation
src/protocol          UDP packet decoder, unit conversion
src/stream            stream hub (UDP band, laptop simulator, in-app demo)
src/signal            filters, resampling, two preprocessing profiles, calculated measures
src/ml                model loading and inference
src/test              guided-test protocol and summary rules
src/data              SQLite storage
src/report            PDF report
src/screens, src/ui   screens and shared components
assets/models         the two .tflite models, preprocess_config.json, golden_vectors.json
tools                 band_simulator.py
tests                 decoder and preprocessing checks
docs                  PRD, architecture, database, API contract, design, tasks, changelog, reviews
```
