# Neuro Monitor

**Real-Time Wearable Screening System for Epileptic Seizures, Parkinson's Disease, and Essential Tremor**

Screening aid only. Not a diagnostic device. Academic prototype built as part of CIA-3 coursework.

---

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Repository Structure](#repository-structure)
- [Datasets](#datasets)
- [Model Architectures](#model-architectures)
- [Performance Results](#performance-results)
- [Hardware: Wristband Firmware](#hardware-wristband-firmware)
- [Web Dashboard](#web-dashboard)
- [Android App](#android-app)
- [Notebooks](#notebooks)
- [Setup and Installation](#setup-and-installation)
- [Clinical Disclaimer](#clinical-disclaimer)

---

## Overview

Neuro Monitor is an end-to-end intelligent edge screening and continuous monitoring system designed around low-cost wrist-worn motion sensors. It addresses the frequent clinical misdiagnosis between Parkinson's disease (PD), essential tremor (ET), and epileptic seizures, all of which produce overlapping involuntary movements in the 3 to 8 Hz range.

The system consists of three major components:

1. **Two ESP8266-based wristbands** that capture 100 Hz 6-axis IMU data (accelerometer + gyroscope) and transmit it over Wi-Fi UDP to a central server or mobile device.
2. **A Python web dashboard** (FastAPI + WebSocket) that receives live telemetry, runs TensorFlow-based classification models, and provides a clinical monitoring console for doctors.
3. **A React Native Android app** that embeds two TFLite neural network models on-device for offline inference, runs guided motor tests, provides live signal monitoring, and generates clinical PDF reports.

**Course Alignment:**
- SDG 3: Good Health and Well-being
- Thrust Area: Intelligent Edge Technologies
- Data Type: Time-series

---

## System Architecture

```
Patient Wristband (ESP8266 + MPU6050)
        |
        | UDP port 8888, 100 Hz, 12-byte packets
        |
        v
+------------------+       +--------------------+
| Python Dashboard | <---> | SQLite Database    |
| (FastAPI server) |       | (patients, logs)   |
| - TF models      |       +--------------------+
| - WebSocket live  |
| - REST API        |
+------------------+
        ^
        | HTTP / WebSocket
        v
  Browser UI (index.html + app.js + styles.css)

Patient Wristband (ESP8266 + MPU6050)
        |
        | UDP port 8888, 100 Hz, 12-byte packets
        |
        v
+----------------------------+
| Android App (React Native) |
| - TFLite on-device models  |
| - Guided motor tests       |
| - Live signal monitoring   |
| - PDF report generation    |
+----------------------------+

Caregiver Alert Band (ESP8266 + OLED + Siren)
        |
        | UDP heartbeat + cross-alert protocol
        |
        v
  Dashboard / Patient Band (two-way alert link)
```

---

## Repository Structure

```
Neuro Monitor/
|
|-- dashboard/                  # Web-based clinical monitoring dashboard
|   |-- server.py               # FastAPI server with UDP receiver and TF inference
|   |-- db.py                   # SQLite database helpers
|   |-- static/
|       |-- index.html          # Dashboard HTML
|       |-- app.js              # Dashboard JavaScript (live charts, modals, API calls)
|       |-- styles.css          # Dashboard styling
|
|-- firmware/                   # ESP8266 Arduino firmware
|   |-- esp8266_mpu6050_band/   # Patient wristband (IMU telemetry)
|   |   |-- esp8266_mpu6050_band.ino
|   |   |-- esp8266_receiver.py
|   |   |-- HARDWARE_SETUP_AND_INSTRUCTIONS.md
|   |
|   |-- esp8266_alert_band/     # Caregiver alert wristband
|       |-- esp8266_alert_band.ino
|       |-- esp8266_receiver.py
|       |-- DUAL_BAND_SETUP_AND_ALERT_GUIDE.md
|
|-- models/                     # Python model definitions
|   |-- baselines.py            # Random Forest and threshold baselines
|   |-- bilstm.py               # Bidirectional LSTM
|   |-- bigru.py                # Bidirectional GRU
|   |-- cnn_bilstm.py           # Strided Conv1D + BiLSTM (production model)
|   |-- context_bilstm.py       # Task-aware and attention-pooling variants
|
|-- preprocessing/              # Signal preprocessing pipeline
|   |-- features.py             # Handcrafted feature extraction
|   |-- filters.py              # Resampling / anti-aliasing filter utilities (Track 2 check in NB 13)
|   |-- normalization.py        # Fixed training-std scaling (divides by fixed training channel_std)
|   |-- windowing.py            # 3-second sliding window segmentation
|
|-- data_loading/               # Dataset loaders
|   |-- epilepsy_loader.py      # UEA Epilepsy dataset loader
|   |-- pads_loader.py          # PADS Parkinson's smartwatch loader
|   |-- unified_loader.py       # Unified multi-source loader
|   |-- v2_loader.py            # Version 2 loader with extended tasks
|
|-- notebooks/                  # Jupyter notebooks (01 through 15)
|   |-- 01_data_exploration.ipynb
|   |-- 02_preprocessing_and_leakage_test.ipynb
|   |-- ...
|   |-- 15_cross_check.ipynb
|
|-- results/                    # Saved outputs from training and evaluation
|   |-- metrics/                # Per-fold classification metrics
|   |-- models/                 # Saved model weights and TFLite exports
|   |-- plots/                  # Training curves and confusion matrices
|   |-- golden_vectors.json     # End-to-end test vectors for model validation
|   |-- preprocess_config.json  # Preprocessing parameters for edge deployment
|
|-- NeuroMonitor App/           # React Native Android application
|   |-- src/                    # TypeScript source (screens, services, utils)
|   |-- assets/models/          # Embedded TFLite models
|   |-- android/                # Native Android build files
|   |-- App.tsx                 # Application entry point
|   |-- BUILD_STEPS.md          # Detailed build instructions
|
|-- sc/                         # Screenshots and prototype images
|
|-- app.py                      # Standalone Gradio demo app
|-- requirements.txt            # Python dependencies
```

---

## Datasets

### Track 1: PADS (Parkinson's Disease Smartwatch Dataset)

- **Source:** Apple Watch Series 4, 100 Hz, 6-axis (accelerometer + gyroscope)
- **Subjects:** 375 total (268 PD, 28 ET, 79 Healthy)
- **Tasks used:** Relaxed, RelaxedTask, StretchHold, LiftHold, HoldWeight (5 tremor-relevant tasks)
- **Windows:** 25,500 windows of 300 samples (3 seconds at 100 Hz)
- **Preprocessing:** Initial 2-second trim to remove task-initiation artifacts

### Track 2: UEA Epilepsy

- **Source:** 3-axis accelerometer, 16 Hz
- **Series:** 275 (137 train, 138 test)
- **Classes:** Simulated generalized tonic-clonic seizures vs daily activities (walking, running, sawing)

### Methodological Integrity

Leakage tests confirmed that cross-dataset pooling causes severe confounding due to hardware and sampling rate differences. Models are therefore evaluated in separate tracks:
- **Track 1:** PADS-only within-source 3-class classification (Normal vs PD vs ET)
- **Track 2:** UEA-only within-source seizure detection (Seizure vs Non-seizure)
- **Track 3:** Cross-source pooled (retained as a labeled demonstration only)

---

## Model Architectures

All deep models satisfy the constraint of at least 2 stacked recurrent or convolutional hidden layers plus a classification head.

### Production Model: Strided Conv1D + BiLSTM

```
Input(300, 6) -> Conv1D(32, stride=2) -> Conv1D(32, stride=2) -> MaxPool(2)
             -> BiLSTM(32) -> BiLSTM(16) -> Dense(32) -> Dense(3)
Total parameters: 32,259
```

This architecture was selected for edge deployment based on the best balance of classification performance, model size (under 600 KB as TFLite), and inference latency on microcontroller-class hardware.

### Seizure Model: Conv1D + BiLSTM (Track 2)

```
Input(48, 3) -> Conv1D(32, stride=2) -> MaxPool(2)
            -> BiLSTM(32) -> BiLSTM(16) -> Dense(32) -> Dense(2)
Total parameters: 28,450
```

### Other Evaluated Architectures

| Model | Parameters | Description |
|-------|-----------|-------------|
| Strided Conv1D + BiGRU | 25,795 | GRU variant of the production model |
| CNN-BiLSTM + RF Features | 34,275 | Concatenates 30-dim handcrafted features |
| Task-Aware Conv1D + BiLSTM | 32,419 | Includes 5-dim one-hot task vector |
| Attention-Pooling Subject Model | 33,572 | Learned attention pooling across windows |
| DAE Pretrained Classifier | 32,259 | Denoising autoencoder pretraining on 11 tasks |
| Random Forest Baseline | N/A | 500 trees on 30 handcrafted features |

---

## Preprocessing Pipeline

- **Track 1 (PADS, 100 Hz, 6-axis):** Uses no frequency filter at all. Each 3-second (300-sample) window is normalized by dividing by fixed training-set channel standard deviations (`channel_std`), not by each window's own spread.
- **Track 2 (UEA Epilepsy, 16 Hz, 3-axis):** Normalized by dividing by fixed training-set channel standard deviations (`channel_std_uea`). The 65-tap FIR low-pass filter is only an anti-aliasing check in Notebook 13 for resampling 100 Hz telemetry down to 16 Hz.

---

## Performance Results

**Track 1: Tremor (PADS), tested on unseen people, 5-fold x 3 seeds**

| Model | Macro F1 | Balanced Acc | AUROC |
|-------|----------|--------------|-------|
| Strided Conv1D + BiLSTM (deployed) | 0.498 [0.427, 0.564] | 0.595 | 0.785 |
| Tuned Random Forest (30 features) | 0.594 | | |

Normal recall 89.9%, PD 45.9%, ET 42.9%. Guessing = 0.33.

**Track 2: Seizure-like (UEA), 138 held-out series**

Recall 85.3% (29/34), Precision 90.6%, Macro F1 0.920. Seizures were acted by volunteers.

---

## Hardware: Wristband Firmware

### Patient Wristband (esp8266_mpu6050_band)

- **MCU:** ESP8266 (NodeMCU or Wemos D1 Mini)
- **IMU:** MPU6050 (I2C, SDA=D2, SCL=D1)
- **Display:** SSD1306 128x64 OLED
- **Sampling:** 100 Hz via hardware timer
- **Protocol:** UDP broadcast on port 8888, 12-byte packets (6x int16 for ax, ay, az, gx, gy, gz)
- **Identification:** Sends `PATIENT_BAND` tag to the dashboard/app on connection

### Caregiver Alert Wristband (esp8266_alert_band)

- **MCU:** ESP8266
- **Display:** U8g2 OLED
- **Siren:** Piezo buzzer on pin D6
- **Protocol:** Two-way cross-alert over UDP; receives seizure alerts from the dashboard/patient band and triggers siren and OLED warning
- **Identification:** Sends `CAREGIVER_BAND` tag on heartbeat

Refer to `firmware/esp8266_mpu6050_band/HARDWARE_SETUP_AND_INSTRUCTIONS.md` and `firmware/esp8266_alert_band/DUAL_BAND_SETUP_AND_ALERT_GUIDE.md` for wiring diagrams and setup guides.

---

## Web Dashboard

The clinical monitoring dashboard is a single-page web application served by a FastAPI backend.

### Features

- **Live 100 Hz kinematic waveform display** with mean-subtracted oscillating spike rendering and dynamic amplitude auto-scaling
- **Real-time model inference** using TensorFlow on the server for tremor and seizure classification
- **Patient management** with add, edit, and registration workflows
- **Hardware status modal** showing live connection status for both patient and caregiver wristbands (IP address, packet rate, signal state)
- **Rhythmic frequency card** with 3 to 8 Hz harmonic tremor spike sparkline
- **Calendar** for scheduling patient monitoring sessions
- **Telemetry logs** with filtering by patient and clinical pattern
- **CSV data export** for offline analysis
- **Simulated watch mode** for demonstration without physical hardware

### Running the Dashboard

```bash
cd dashboard
pip install fastapi uvicorn numpy scipy tensorflow
python server.py
```

Open `http://localhost:8000` in a browser.

---

## Android App

The React Native Android app provides portable, offline-capable screening on a phone or tablet.

### Features

- **On-device TFLite inference** with two embedded models:
  - `Strided_Conv1D_BiLSTM.tflite` (569 KB) for tremor classification (Normal / PD / ET)
  - `Seizure_Conv1D_BiLSTM.tflite` (401 KB) for seizure detection
- **Wi-Fi UDP receiver** on port 8888 for live data from the patient wristband
- **Guided motor tests** matching the five PADS training tasks (rest, rest with task, stretch, lift, hold weight)
- **Live signal monitor** with real-time waveform, RMS amplitude, dominant frequency, and model output
- **Medication log** tracking medicines and dose times
- **Clinical PDF report generation** with expo-print and expo-sharing
- **Demo signal mode** for showcasing without hardware

### Tech Stack

Expo SDK 57, React Native 0.86.3, TypeScript, react-native-udp, react-native-fast-tflite, expo-sqlite, react-native-svg, expo-print, expo-sharing.

### Building the APK

Requirements: Node 24, JDK 17, Android SDK platform 36, NDK 27.1.12297006, CMake 3.22.1.

```powershell
cd "NeuroMonitor App"
npm ci
npx expo run:android --variant release
```

Or via Gradle directly:

```powershell
cd "NeuroMonitor App\android"
$env:JAVA_HOME = "path\to\jdk-17"
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a
```

See `NeuroMonitor App/BUILD_STEPS.md` for detailed instructions.

---

## Notebooks

All notebooks are fully executed and self-contained:

| Notebook | Description |
|----------|-------------|
| 01 | Dataset exploration, PSD analysis, amplitude distributions |
| 02 | Preprocessing verification, trivial feature tests, cross-dataset leakage analysis |
| 03 | Baseline models (Random Forest, RMS threshold) with 5-fold cross-validation |
| 04 | Deep neural network training and evaluation across Track 1, 2, and 3 |
| 05 | Stage 1 model selection, TFLite export, CPU latency benchmarking |
| 06 | Task-Aware Conv1D + BiLSTM and Subject Attention-Pooling models |
| 07 | DAE pretraining across 11 tasks and fine-tuning evaluation |
| 08 | Nested decision threshold tuning on Random Forest |
| 09 | Stage 1 vs Stage 2 comparison, bootstrap CIs, production architecture selection |
| 10 | Stage 2 edge deployment, TFLite export, hardware feasibility analysis |
| 11 | Threshold-tuned deep models, final selection, DAE negative finding |
| 12 | Final reconciliation, per-class metrics, 25500-window retrained export |
| 13 | Verification checks, standalone TFLite evaluation, FIR frequency response |
| 15 | Cross-source diagnostic checks and device mismatch analysis |

---

## Setup and Installation

### Python Environment

```bash
pip install -r requirements.txt
```

**Dependencies:** TensorFlow 2.15+, scikit-learn 1.3+, SciPy 1.11+, NumPy 1.26+, pandas 2.1+, matplotlib 3.8+, Gradio 4.0+

### Arduino IDE (for firmware)

1. Install ESP8266 board support via Board Manager
2. Install libraries: Adafruit MPU6050, Adafruit SSD1306, U8g2 (for alert band)
3. Configure Wi-Fi SSID and password in each `.ino` file
4. Flash the patient band sketch to one ESP8266 and the alert band sketch to the other

### Dashboard Server

```bash
pip install fastapi uvicorn numpy scipy tensorflow
cd dashboard
python server.py
```

---

## Clinical Disclaimer

This system is a screening and monitoring aid only. It is not a diagnostic device. All output is framed as "pattern consistent with" and never as a diagnosis. It cannot diagnose Parkinson's disease, essential tremor, or epilepsy. It is not a life-safety device. It never recommends medication changes. This is an academic prototype built for coursework purposes.

---

## Code and Datasets

Code: [https://github.com/RESHIDUAL/Neuro-Monitor](https://github.com/RESHIDUAL/Neuro-Monitor)

Datasets: [https://drive.google.com/drive/folders/1af5J1uRHVPLxjo3IjPQyfkKK4UQpfgND?usp=drive_link]

---
