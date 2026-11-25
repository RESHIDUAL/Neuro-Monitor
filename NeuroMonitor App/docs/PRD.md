# Product Requirements Document: Neuro Monitor App

Version 1.0, 24 Nov 2026. Owner: Member 3 (application). Submission deadline: 25 Nov 2026, 11:59 PM.

## 1. Problem
Parkinson's disease, essential tremor and epileptic seizures can all show rhythmic involuntary movement, and the
frequency bands overlap (roughly 3 to 8 Hz). Clinic visits capture only a few minutes of symptoms, patient
self-reports are vague, and tremor changes with activity and medication timing. Everyday movements such as
drinking or writing can also be confused with tremor if activity is ignored.

## 2. Product
An Android app paired with a low-cost ESP8266 + MPU6050 wristband. The app runs a guided activity test, shows
live movement analysis, keeps a medication log and produces a PDF summary for a neurologist. Both trained
models run on the phone, and all data stays on the phone.

**Value proposition:** an affordable, offline wrist monitor that gives patients, caregivers and doctors objective,
activity-aware movement information between clinic visits, presented as screening observations, never as a
diagnosis.

## 3. Users
| User | Need |
|---|---|
| Patient | Run a short guided test, log medicine doses, see simple results |
| Caregiver | Help run the test, see seizure-like movement flags |
| Neurologist | Read a PDF summary with activity-wise results, dose timing and limitations |
| Project team | Demo the system honestly, test with synthetic data before hardware is ready |

Single-user app: one phone, one patient profile, no accounts or server (decision: Option A, local only).

## 4. Confirmed decisions
- Android only, React Native + Expo + TypeScript, installable standalone APK.
- Band to phone: Wi-Fi UDP over the phone's hotspot (2.4 GHz), port 8888, 160-byte packets (firmware v1).
- Inference on the phone: `Strided_Conv1D_BiLSTM.tflite` (Track 1) and `Seizure_Conv1D_BiLSTM.tflite` (Track 2), float32.
- Guided test: 5 core PADS-aligned activities (30 s each) drive the main result. Drinking, writing and walking are
  optional, recorded separately, labelled "Activity not represented in model training data. Recorded for contextual
  monitoring only. Predictions are not validated for this activity.", and never mixed into the main result.
- Python receiver kept as a fallback demo option.
- Synthetic data and simulated predictions are always labelled.

## 5. MVP features (built)
| # | Feature | Status |
|---|---|---|
| 1 | Consent and disclaimer screen | Done |
| 2 | Wi-Fi band connection (UDP receive, decode, gap detection) | Done, tested with simulator; real band pending |
| 3 | In-app demo signal and laptop simulator, labelled synthetic | Done |
| 4 | Model inference on the phone, model self-test | Done, PASS on emulator (dev build) |
| 5 | Guided test, core and contextual sections | Done |
| 6 | Live monitor: raw signal, calculated measures, model output | Done |
| 7 | Medication log | Done |
| 8 | Dashboard (home) in the reference visual style | Done |
| 9 | Neurologist PDF report | Done, pending device check |
| 10 | Preprocessing confirmed against the training notebooks (one pipeline) | Done |

## 6. Future enhancements (not in this submission)
- Caregiver alerts (SMS/notification) with a validated alert rule (k of n windows, cooldown).
- Feedback packets to the band's OLED and buzzer, after its wording changes to "-like pattern" labels.
- Automatic activity recognition, if the model team adds an activity output.
- Clinician web dashboard and cloud sync (needs accounts, security and consent handling).
- Fine-tuning on recordings from our own MPU6050 band, and a recording mode for collecting them.
- Medication reminders, multi-day trend charts, encrypted database.

## 7. User journey
1. First launch: read the disclaimer and consent.
2. Settings: enter name, choose wrist, choose data source and preprocessing profile.
3. Turn on the phone hotspot, power the band; Home shows "Streaming".
4. Test tab: five core activities with instructions and a countdown, then optional contextual activities.
5. Results: core summary ("Pattern consistent with ...") plus per-activity details; contextual section separate.
6. Meds tab: log doses as they are taken.
7. Report tab: create and share the PDF for the neurologist.

## 8. Safety requirements
- Wording: "Pattern consistent with Parkinsons-like / ET-like / normal movement" and "Seizure-like (simulated-data model)".
- "Screening aid only. Not a diagnosis." on every result screen and the PDF.
- No medication or dosing advice. No clinical thresholds invented by the app team.
- Seizure-like windows are described as "needs attention and assessment, not a confirmed seizure".
- Limitations stated in the report: Apple Watch training data (PADS), acted seizures (UEA), not validated on this band.

## 9. Technical risks
| Risk | Mitigation |
|---|---|
| Preprocessing conflicts (receiver vs config) | Resolved from the training notebooks; one confirmed pipeline |
| Domain shift Apple Watch -> MPU6050 | Stated in report; fine-tuning listed as future work |
| Accel range +/-2 g clips vigorous shaking | Raised with hardware member; scale selectable in Settings |
| Wi-Fi: band can only use 2.4 GHz | Setup instructions; Python laptop fallback |
| Release APK asset loading | Models copied via expo-asset before loading |
| Timeline (one day) | Built in tested increments; synthetic data path works without hardware |

## 10. Acceptance criteria for the demo
- Release APK installs and runs without a laptop.
- Model self-test PASS in the release APK.
- Guided test completes and shows separated core and contextual results.
- PDF report generated and shareable.
- Live band data shown with "Live wristband" label (if the band is available), otherwise the simulator or demo
  signal, clearly labelled synthetic.
