# Neuro Monitor: Dual-Band Cross-Alert System (Band 1 & Band 2)
## Complete Hardware, Pinout, and Bidirectional Alert Guide

> **Architecture**: Peer-to-Peer Subnet Broadcast + AI Host Cloud/Edge Dual-Engine  
> **Band 1 (Patient Band)**: ESP8266 + MPU6050 + OLED + Buzzer + LED + Button  
> **Band 2 (Caregiver / Partner Band)**: ESP8266 + OLED + Buzzer + LED + Button (+ Optional MPU6050)  
> **Protocol**: Bidirectional UDP Cross-Alert (Port 8888) with 8-byte `PeerAlertPacket` & 5-byte `DownlinkFeedback`  

---

## 1. System Overview: How the Cross-Alert Works

In this dual-band setup:
1. **Band 1 -> Band 2 Alerting**:
   - If **Band 1** detects violent convulsive shaking or receives an AI Seizure/Tremor classification from the Python server (or if its emergency button is pressed):
   - Band 1 **broadcasts an emergency packet** across the local network.
   - **Band 2 immediately sounds its buzzer siren, flashes its LED strobe, and shows `BAND 1 SEIZURE!` on its OLED screen**.
2. **Band 2 -> Band 1 Alerting**:
   - If **Band 2** triggers an alarm (via its physical button, or its own MPU6050 if attached):
   - Band 2 **broadcasts an emergency packet** to the network.
   - **Band 1 immediately sounds its buzzer siren, flashes its LED, and displays `BAND 2 ALARM!` on its OLED screen**.
3. **Synchronized AI Host Feedback**:
   - The Python server (`esp8266_receiver.py`) runs the dual TFLite models (`Strided_Conv1D_BiLSTM` for tremors and `Seizure_Conv1D_BiLSTM` for seizures).
   - When any event is recognized, the server broadcasts downlink telemetry to **all bands on the network**, keeping both displays and sensory actuators in perfect synchronization.

---

## 2. Band 2 Hardware Connections & Pinout

The pins are ordered sequentially (**D1 to D7**) with **no shared pin holes**:

| # | Component | Component Pin | ESP8266 Pin Label | Function |
| :---: | :--- | :---: | :---: | :--- |
| **1** | **OLED Display (128x64)** | **VCC** | **`3.3V`** (or `VIN`) | Display Power |
| **2** | **OLED Display (128x64)** | **GND** | **`GND`** | Ground |
| **3** | **OLED Display (128x64)** | **SCL** | **`D3`** (GPIO 0) | Dedicated OLED Clock |
| **4** | **OLED Display (128x64)** | **SDA** | **`D4`** (GPIO 2) | Dedicated OLED Data |
| **5** | **Alert LED** | **(+) Anode** | **`D5`** (GPIO 14 via 220Ω) | Visual Warning Strobe |
| **6** | **Alert LED** | **(-) Cathode**| **`GND`** | Ground |
| **7** | **Active Piezo Buzzer** | **(+) Pin** | **`D6`** (GPIO 12) | Acoustic Emergency Siren |
| **8** | **Active Piezo Buzzer** | **(-) Pin** | **`GND`** | Ground |
| **9** | **Test / Panic Button** | **Terminal 1** | **`D7`** (GPIO 13) | Internal pull-up test trigger |
| **10**| **Test / Panic Button** | **Terminal 2** | **`GND`** | Ground |
| **11**| *(Optional MPU6050)* | *SCL* | *`D1`* (GPIO 5) | *Auto-detected if connected* |
| **12**| *(Optional MPU6050)* | *SDA* | *`D2`* (GPIO 4) | *Auto-detected if connected* |

> **Note on MPU6050 for Band 2**: The firmware automatically probes for an MPU6050 sensor on `D1/D2` at boot. If you connect an MPU6050, Band 2 functions as a dual-sensing wristband; if you do not connect an MPU6050, Band 2 boots smoothly as a **dedicated Caregiver Alert Receiver Band**!

---

## 3. Circuit Wiring Diagram for Band 2

```text
                           ESP8266 (NodeMCU / Wemos D1 Mini)
               ┌────────────────────────────────────────────────────────┐
               │                                                        │
               │   3.3V (or 5V/VIN) ───┬──────────────┬─────────────────┤
               │                GND ───┼──────────┬───┼──────────────┬──┤
               │                       │          │   │              │  │
               │        D1 (GPIO 5) ───┼──────────┼───┼───────────┐  │  │ (Optional MPU SCL)
               │        D2 (GPIO 4) ───┼──────────┼───┼────────┐  │  │  │ (Optional MPU SDA)
               │                       │          │   │        │  │  │  │
               │        D3 (GPIO 0) ───┼───────┐  │   │        │  │  │  │ (OLED SCL)
               │        D4 (GPIO 2) ───┼────┐  │  │   │        │  │  │  │ (OLED SDA)
               │                       │    │  │  │   │        │  │  │  │
               │        D5 (GPIO 14)───┼─┐  │  │  │   │        │  │  │  │ (LED Drive)
               │        D6 (GPIO 12)───┼┐│  │  │  │   │        │  │  │  │ (Buzzer Drive)
               │        D7 (GPIO 13)───┼┼┼──┼──┼──┼───┼─┐      │  │  │  │ (Test Panic Button)
               └───────────────────────┼┼┼──┼──┼──┼───┼─┼──────┼──┼──┼──┼┘
                                       │││  │  │  │   │ │      │  │  │  │
               ┌───────────────────────┘││  │  │  │   │ │      │  │  │  │
               │ ┌──────────────────────┘│  │  │  │   │ │      │  │  │  │
               │ │ ┌─────────────────────┘  │  │  │   │ │      │  │  │  │
               ▼ ▼ ▼                        ▼  ▼  ▼   ▼ ▼      ▼  ▼  ▼  ▼
       ┌───────────────┐              ┌───────────────┐ ┌───────────────┐
       │ Active Buzzer │              │ OLED Display  │ │ Panic Button  │
       ├───────────────┤              ├───────────────┤ ├───────────────┤
       │ (+) Pin -> D6 │              │ SCL  -> D3    │ │ Pin 1 -> D7   │
       │ (-) Pin -> GND│              │ SDA  -> D4    │ │ Pin 2 -> GND  │
       └───────────────┘              │ VCC  -> 3.3V  │ └───────────────┘
       ┌───────────────┐              │ GND  -> GND   │
       │   Alert LED   │              └───────────────┘
       ├───────────────┤
       │ Anode(+)-> D5 │
       │ (via 220Ω)    │
       │ Cathode-> GND │
       └───────────────┘
```

---

## 4. How to Flash the Firmwares

### For Band 1 (Patient Band):
1. Open Arduino IDE.
2. Open file: `firmware/esp8266_mpu6050_band/esp8266_mpu6050_band.ino`.
3. Check `WIFI_SSID` and `WIFI_PASSWORD` match your home/hotspot network.
4. Set board to **NodeMCU 1.0 (ESP-12E Module)** or **LOLIN(WEMOS) D1 R2 & mini**.
5. Set CPU Frequency to **160 MHz**.
6. Select the COM port for Band 1 and click **Upload**.

### For Band 2 (Caregiver / Partner Band):
1. Open Arduino IDE.
2. Open file: `firmware/esp8266_alert_band/esp8266_alert_band.ino`.
3. Verify `WIFI_SSID` and `WIFI_PASSWORD` are identical to Band 1 (they must be on the same Wi-Fi network to cross-alert).
4. Plug in Band 2's ESP8266 board, select its COM port, and click **Upload**.

---

## 5. How to Test the Cross-Band Alerting

### Test A: Physical Button Cross-Alert Test (Instant Verification)
1. Power up both Band 1 and Band 2. Both OLEDs should connect to Wi-Fi and show `SYNC OK` / `MONITORING`.
2. Press the button on **Band 1** (or connect a wire between **D7** and **GND** for half a second):
   - **Band 2** immediately sounds its buzzer siren, flashes its LED, and displays:
     ```text
     !! ALARM !!
     BAND 1 SEIZURE!
     Check Patient Now!
     ```
3. Press the button on **Band 2** (connect **D7** to **GND**):
   - **Band 1** immediately sounds its buzzer siren, flashes its LED, and displays:
     ```text
     !!! WARNING !!!
     BAND 2 ALARM!
     Cross-Alert Received
     ```

### Test B: Real-Time AI Inference Dual-Band Alert Test
1. Run the host receiver on your PC:
   ```powershell
   python "firmware\esp8266_mpu6050_band\esp8266_receiver.py"
   ```
2. Shake Band 1 with rapid rhythmic motion (simulating tremor or convulsive seizure):
   - The Python server calculates probabilities in real time (e.g., `Seizure: 94.2%`).
   - The server transmits downlink telemetry over broadcast.
   - **Both Band 1 AND Band 2 simultaneously trigger their emergency alarms**!
