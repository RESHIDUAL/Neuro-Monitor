# Tasks

## Done (24 Nov)
- [x] Product definition, decisions log, PRD
- [x] Model package review: both models load in LiteRT with built-in ops; conflicts listed (INTEGRATION_REVIEW.md)
- [x] Firmware and receiver review (FIRMWARE_RECEIVER_REVIEW.md)
- [x] Windows toolchain: Node 24, JDK 17, Android SDK 36, NDK, CMake, emulator
- [x] Build 1: UDP + TFLite self-tests, PASS on emulator; simulator packets decoded with 0 gaps
- [x] Build 2: full app (dashboard, guided test, live, meds, report, settings)
- [x] Preprocessing profiles A and B, matched to scipy
- [x] Release-build model loading fix (expo-asset)
- [x] Patch 1: typing fix, labels, demo timing, test survives tab switches

## 25 Nov
- [x] Release APK; model self-test PASS in release; guided test, live monitor and PDF checked
- [x] R1 to R7 answered from the training notebooks (docs/MODEL_ANSWERS.md); confirmed pipeline applied (Patches 2 to 4)
- [x] Live and test windows rebuilt from band timestamps (Patch 3)
- [x] Guided test aligned to the five PADS training tasks (Patch 5)
- [x] Project report (template) and class presentation
- [x] First real-band test: band connects, ~1.00 g at rest; ~1 packet/s received, so no model output yet
- [ ] Firmware: disable Wi-Fi sleep, remove delays in loop(), OLED updates once a second (hardware member)
- [ ] Re-test the real band with the Patch 5 APK
- [ ] Drive folder (code, notebooks, models, firmware, data links) and final PDF with the link
- [ ] Every team member submits the report on Google Classroom before 23:59

## Future work
- Wearable enclosure with battery; record labelled data with the band and fine-tune both models
- Validated alert rule linking the seizure model to the band and caretaker unit
