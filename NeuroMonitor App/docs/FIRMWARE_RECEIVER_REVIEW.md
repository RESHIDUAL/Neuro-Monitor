# Neuro Monitor: Review of the Wi-Fi UDP Firmware and Python Receiver

Version 1, 24 Nov 2026. Prepared by the app team (Member 3) for Eshwar.
Files reviewed: `firmware/esp8266_mpu6050_band/esp8266_mpu6050_band.ino`, `esp8266_receiver.py`, `HARDWARE_SETUP_AND_INSTRUCTIONS.md`.
Models, `preprocess_config.json` and `golden_vectors.json` are byte-identical to the previous package, so all questions in INTEGRATION_REVIEW.md still stand.

## 1. Confirmed packet format (from the firmware source)

| Item | Value |
|---|---|
| Transport | UDP over Wi-Fi, port 8888 |
| Packet | 10 frames x 16 bytes = 160 bytes, every 100 ms |
| Frame layout | little-endian `<I h h h h h h`: timestamp_ms (uint32), acc_x, acc_y, acc_z, gyro_x, gyro_y, gyro_z (int16) |
| Sampling | 100 Hz (micros() timer), MPU6050 DLPF_CFG = 4 (about 21 Hz) |
| Ranges | accel +/-2 g (16384 LSB/g), gyro +/-250 dps (131 LSB/dps) |
| Calibration | gyro offsets subtracted on the band; accel sent raw (gravity included) |
| Sequence number | **not sent** (`packetSequence` is counted but never transmitted). The app will detect gaps from `timestamp_ms` jumps. |
| Downlink | 5 bytes `<B B B B B`: alert_code (0 Normal, 1 PD, 2 ET, 3 Seizure), prob_norm, prob_pd, prob_et, prob_seiz (0 to 100) |

## 2. Conflicts between the receiver and the model package (CRITICAL)

The app must use one preprocessing definition. The receiver and the config currently disagree on almost every step.

| # | Step | esp8266_receiver.py | preprocess_config.json / golden vectors |
|---|---|---|---|
| R1 | Track 1 channel scaling | `GLOBAL_STD = [0.281, 0.312, 0.345, 0.890, 0.940, 1.020]` (comment says "from preprocess_config.json") | `channel_std = [0.0278, 0.0549, 0.0411, 0.3107, 0.1463, 0.1034]`. About 10x different for the accelerometer. |
| R2 | Track 1 band-pass | Butterworth 0.5 to **20** Hz, `sosfiltfilt` | Coefficients are 0.5 to **15** Hz. Golden vectors show **no filter** at all. |
| R3 | Track 2 scaling | single divisor `0.428` | per-channel `[0.2315, 0.5230, 0.2190]` |
| R4 | Track 2 resampling | `resample_poly(4, 25)` with its default Kaiser window | 65-tap Hamming FIR (or resample_poly, "or" is ambiguous) |
| R5 | Decision thresholds | PD if p > 0.65, ET if p > 0.55, seizure if p > 0.50 | Config has argmax or prior weights [1.5, 1.0, 3.0]. The 0.65 and 0.55 values do not appear anywhere in the package. |
| R6 | Seizure alarm | fires on a **single** 3 s window, re-evaluated every 1 s | No consecutive-window rule or cooldown defined |
| R7 | Window hop | 100 samples (1 s, overlapping) | stride 300 (training). Fine for live use, but it means up to 3 alarms per real event. |

**Question for Eshwar:** Which one matches how the models were trained, the receiver or the config? Please fix the other one, so the laptop fallback and the phone app give identical outputs for the same window.

## 3. Firmware changes requested (small, all in the .ino)

1. **Send to the gateway, not a fixed IP.** Replace `udp.beginPacket(TARGET_IP, UDP_PORT)` with `udp.beginPacket(WiFi.gatewayIP(), UDP_PORT)`.
   Whoever runs the hotspot (the phone, or a Windows laptop for the Python fallback) is the gateway, so the same firmware works for both without reflashing. Android picks the hotspot IP itself, and it can change between sessions, so a hard-coded IP is fragile.
2. **Wi-Fi name and password.** Use something clear, e.g. SSID `NeuroMonitor`, and tell us the password. The phone hotspot will be set to match.
3. **Safety wording on the OLED** (project rule: no diagnostic labels):
   - "HEALTHY NORMAL" -> "Normal pattern"
   - "PARKINSON'S (PD)" -> "PD-like pattern"
   - "ESSENTIAL TREMOR" -> "ET-like pattern"
   - "SEIZURE ALERT! Assistance Required" -> "Seizure-like movement. Check on wearer"
4. **Sensor ranges (decision needed).** +/-2 g and +/-250 dps will clip during vigorous shaking. The seizure-like test in the guide asks for more than 1.5 g, which is close to the limit. The earlier architecture document used +/-4 g and +/-500 dps. If changed, the scale factors become 8192 LSB/g and 65.5 LSB/dps. Tell us which ranges the final firmware uses.
5. Optional: add a sequence number. **Only if** you also update the receiver; otherwise keep the 160-byte format unchanged.

## 4. Documentation fixes

- MASTER doc says the OLED shares the MPU6050 I2C bus (SDA=D2, SCL=D1); the firmware and the hardware guide use a separate bus on D3/D4.
- The hardware guide's "How to test" section asks the wearer to act PD, ET and seizure movements. In the report and demo, call this an **acted demonstration**, not a validation.
- The ESP8266 only supports 2.4 GHz Wi-Fi. Add a note that the hotspot must use the 2.4 GHz band.
