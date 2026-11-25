# ESP8266 + MPU6050 Wearable Wristband: Complete Hardware Guide & "What To Do"
## With U8g2 OLED Display, Closed-Loop Buzzer & LED Sensory Alerts

> **Project Track**: Neuro Monitor Embedded Edge Prototype  
> **Microcontroller**: Espressif ESP8266 (NodeMCU v2/v3, Wemos D1 Mini, ESP-12E/F)  
> **Motion Sensor**: InvenSense MPU6050 6-DoF Inertial Measurement Unit (IMU)  
> **Display**: 0.96" or 1.3" I2C Monochrome OLED (128x64 SSD1306 / SH1106) via **U8g2 Library**  
> **Actuators**: Active Piezo Buzzer (D6) + Alert LED (D5)  
> **Wireless Protocol**: Low-Latency 100 Hz Wi-Fi UDP Two-Way Streaming  
> **Status**: Verified Embedded Prototype Pipeline

---

## 1. Why Separate Pins for MPU6050 and OLED (No More Wire Sharing!)

In standard electronics, I2C devices can share a bus, but jamming two wires into the same tiny pin hole on a breadboard or ESP8266 is messy and can cause loose connections.

We have **separated them completely** so that **every single module gets its own dedicated pins**:
* **MPU6050 Motion Sensor** gets its own dedicated hardware I2C bus on **`D1`** and **`D2`**.
* **OLED Display** gets its own dedicated independent I2C bus on **`D3`** and **`D4`** (driven by U8g2 Software I2C).
* **Alert LED** gets its own dedicated pin on **`D5`**.
* **Active Buzzer** gets its own dedicated pin on **`D6`**.

Notice how clean this is: **Pins `D1, D2, D3, D4, D5, D6` in perfect sequential order!**

---

## 2. Master Wire-by-Wire Connection Table (Plug into these board labels!)

| # | From Component | Pin on Component | Plug into Stamped Pin on ESP8266 | Function |
| :---: | :--- | :---: | :---: | :--- |
| **1** | **MPU6050 Sensor** | **VCC** | **`3.3V`** (or `VIN`) | Power supply |
| **2** | **MPU6050 Sensor** | **GND** | **`GND`** | Ground |
| **3** | **MPU6050 Sensor** | **SCL** | **`D1`** | **Dedicated Sensor Clock** |
| **4** | **MPU6050 Sensor** | **SDA** | **`D2`** | **Dedicated Sensor Data** |
| **5** | **MPU6050 Sensor** | **AD0** | **`GND`** | Sets I2C address to `0x68` |
| **6** | **OLED Display (128x64)** | **VCC** | **`3.3V`** (or `VIN`) | Power supply |
| **7** | **OLED Display (128x64)** | **GND** | **`GND`** | Ground |
| **8** | **OLED Display (128x64)** | **SCL** | **`D3`** | **Dedicated OLED Clock (Separate!)** |
| **9** | **OLED Display (128x64)** | **SDA** | **`D4`** | **Dedicated OLED Data (Separate!)** |
| **10**| **Active Piezo Buzzer** | **(+) Positive** | **`D6`** | **Audio Alarm Trigger** |
| **11**| **Active Piezo Buzzer** | **(-) Negative** | **`GND`** | Ground |
| **12**| **Alert LED** | **(+) Anode** | **`D5`** (via 220Ω resistor) | **Visual Strobe Trigger** |
| **13**| **Alert LED** | **(-) Cathode** | **`GND`** | Ground |

---

## 3. Visual Circuit Diagram (Separate Pin Architecture)

```text
                           ESP8266 (NodeMCU / Wemos D1 Mini)
               ┌────────────────────────────────────────────────────────┐
               │                                                        │
               │   3.3V (or 5V/VIN) ───┬──────────────┬─────────────────┤
               │                GND ───┼──────────┬───┼──────────────┬──┤
               │                       │          │   │              │  │
               │        D1 (GPIO 5) ───┼──────────┼───┼───────────┐  │  │ (MPU SCL)
               │        D2 (GPIO 4) ───┼──────────┼───┼────────┐  │  │  │ (MPU SDA)
               │                       │          │   │        │  │  │  │
               │        D3 (GPIO 0) ───┼───────┐  │   │        │  │  │  │ (OLED SCL)
               │        D4 (GPIO 2) ───┼────┐  │  │   │        │  │  │  │ (OLED SDA)
               │                       │    │  │  │   │        │  │  │  │
               │        D5 (GPIO 14)───┼─┐  │  │  │   │        │  │  │  │ (LED Drive)
               │        D6 (GPIO 12)───┼┐│  │  │  │   │        │  │  │  │ (Buzzer Drive)
               └───────────────────────┼┼┼──┼──┼──┼───┼────────┼──┼──┼──┼┘
                                       │││  │  │  │   │        │  │  │  │
               ┌───────────────────────┘││  │  │  │   │        │  │  │  │
               │ ┌──────────────────────┘│  │  │  │   │        │  │  │  │
               │ │ ┌─────────────────────┘  │  │  │   │        │  │  │  │
               ▼ ▼ ▼                        ▼  ▼  ▼   ▼        ▼  ▼  ▼  ▼
       ┌───────────────┐              ┌───────────────┐   ┌────────────────────┐
       │ Active Buzzer │              │ OLED Display  │   │  MPU6050 (GY-521)  │
       ├───────────────┤              ├───────────────┤   ├────────────────────┤
       │ (+) Pin -> D6 │              │ SCL  -> D3    │   │ SCL  -> D1         │
       │ (-) Pin -> GND│              │ SDA  -> D4    │   │ SDA  -> D2         │
       └───────────────┘              │ VCC  -> 3.3V  │   │ VCC  -> 3.3V       │
       ┌───────────────┐              │ GND  -> GND   │   │ GND  -> GND        │
       │   Alert LED   │              └───────────────┘   │ AD0  -> GND        │
       ├───────────────┤                                  └────────────────────┘
       │ Anode(+)-> D5 │
       │ (via 220Ω)    │
       │ Cathode-> GND │
       └───────────────┘
```

---

## 4. Complete Bill of Materials (BOM)

| Component | Recommended Model | Approx. Cost | Purpose |
| :--- | :--- | :--- | :--- |
| **Microcontroller** | NodeMCU v2 / v3 or Wemos D1 Mini (ESP8266) | ~$2.50 - $4.00 | 100 Hz sampling loop, Wi-Fi streaming & display driver |
| **IMU Motion Sensor** | InvenSense MPU6050 (GY-521 breakout board) | ~$1.20 - $2.00 | 3-axis Accelerometer (+/-2g) + 3-axis Gyroscope (+/-250 dps) |
| **OLED Display** | 0.96" or 1.3" I2C OLED 128x64 (SSD1306 / SH1106) | ~$2.00 - $3.00 | Real-time on-wrist clinical dashboard & seizure alert banner |
| **Acoustic Buzzer** | 3.3V or 5V Active Piezo Buzzer | ~$0.50 | Audible emergency alarm and audio feedback cues |
| **Visual Alert LED** | 3mm or 5mm Red / Amber LED + 220Ω resistor | ~$0.20 | Visual warning strobe and status heartbeat |
| **Connecting Wires** | Female-to-Female Dupont Jumper Wires | ~$0.50 | Solderless breadboard / ribbon connections |
| **Power Supply** | Micro-USB Cable to 5V Power Bank OR 3.7V LiPo + TP4056 | ~$2.00 - $5.00 | Wearable power source |
| **Wristband Mount** | Velcro strap or sports watch cuff | ~$1.50 | Securing sensor and OLED firmly to the wrist |

---

## 5. On-Wrist OLED Display Dashboard & Alert Modes

Driven by the **U8g2** library, the OLED provides a real-time clinical dashboard right on the patient's arm:

### Normal Operation Screen
```text
┌──────────────────────────────┐
│ NEURO MONITOR     100Hz WiFi │  <-- Status & Network Header
│──────────────────────────────│
│ State: HEALTHY NORMAL        │  <-- Live Diagnostic State
│ Norm:91%  PD: 6%  ET: 3%     │  <-- Model Probabilities
│ [████████████████████      ] │  <-- Confidence Bar
│ |a|: 1.01g    Seiz Prob:  0% │  <-- Motion G-Force & Seizure
└──────────────────────────────┘
```

### Emergency Seizure Alert Screen (Flashing High-Contrast Inverted Box)
```text
┌──────────────────────────────┐
│ ████████████████████████████ │
│ █      !!! WARNING !!!     █ │  <-- Inverted flashing strobe
│ █       SEIZURE ALERT!     █ │
│ █    Assistance Required   █ │  <-- Emergency cue for caregiver
│ ████████████████████████████ │
└──────────────────────────────┘
```

### Alert Modes Summary

| Movement State | Command | OLED Display Status | Buzzer Audio | Alert LED Visual |
| :--- | :--- | :--- | :--- | :--- |
| **Normal Movement** | `'N'` | `State: HEALTHY NORMAL` | Silent | Heartbeat pulse (every 2s) |
| **Parkinson's Tremor** | `'P'` | `State: PARKINSON'S (PD)` | Soft chirp (40 ms) | Double-blink pulse |
| **Essential Tremor** | `'E'` | `State: ESSENTIAL TREMOR` | Silent | Triple-blink pulse |
| **SEIZURE EMERGENCY** | `'S'` | `!!! WARNING: SEIZURE ALERT !!!` | Continuous rapid siren | High-speed strobe (100 ms) |

---

## 5. Software Setup & Flashing the ESP8266 (Step-by-Step)

### Step 1: Install U8g2 Library in Arduino IDE
1. Open Arduino IDE.
2. Go to **Sketch $\rightarrow$ Include Library $\rightarrow$ Manage Libraries...** (or press `Ctrl+Shift+I`).
3. In the search bar, type **`U8g2`**.
4. Find **U8g2 by oliver** and click **Install**.

### Step 2: Configure the Firmware
1. Open [`esp8266_mpu6050_band.ino`](file:///c:/Users/Eshwar%20G/Desktop/Working/Neuro%20Monitor/firmware/esp8266_mpu6050_band/esp8266_mpu6050_band.ino).
2. Find your computer's local Wi-Fi IP address:
   * **Windows**: Run `ipconfig` in Command Prompt / PowerShell, look for `IPv4 Address` (e.g. `192.168.1.105`).
   * **Mac / Linux**: Run `ifconfig` or `ip a`.
3. Update lines 35–38 with your Wi-Fi details and computer IP:
   ```cpp
   const char* WIFI_SSID     = "Your_WiFi_Name";
   const char* WIFI_PASSWORD = "Your_WiFi_Password";
   const char* TARGET_IP     = "192.168.1.105";   // Put YOUR PC's IP here!
   const int   UDP_PORT      = 8888;
   ```

### Step 3: Board Settings & Flash
In Arduino IDE **Tools** menu:
* **Board**: `NodeMCU 1.0 (ESP-12E Module)` or `LOLIN(WEMOS) D1 R2 & mini`
* **CPU Frequency**: **160 MHz** *(Crucial: 160 MHz guarantees zero microsecond jitter in the 100 Hz sampling loop while updating the display)*
* **Upload Speed**: `921600` or `115200`
* **Port**: Select the COM port corresponding to your connected ESP8266.
* Click **Upload** ($\rightarrow$).

---

## 6. Running the Complete System

### Step 1: Start the Python Receiver on Your PC
Open a terminal in the project directory and run:
```bash
python firmware/esp8266_mpu6050_band/esp8266_receiver.py
```
You will see:
```text
===========================================================================
  Neuro Monitor: Real-Time ESP8266 MPU6050 + U8g2 OLED Receiver
  [With Closed-Loop OLED Display & Buzzer/LED Alerts]
  Listening on UDP 0.0.0.0:8888 ...
  Press Ctrl+C to terminate.
===========================================================================
```

### Step 2: Power On the Wristband
1. Connect the ESP8266 to USB or battery.
2. The OLED will show `NEURO MONITOR: Connecting WiFi...`.
3. **Calibration Phase**: The band will **beep once** and display `CALIBRATING... Keep wristband still on a flat table`.
4. After 2 seconds, it will **beep twice** to confirm calibration complete.
5. The OLED will switch to the live clinical dashboard, showing real-time acceleration magnitude and streaming 100 Hz kinematic packets.

### Step 3: Watch Real-Time Classification & Feedback
Every 1.0 second, a new 3-second window is processed by both TensorFlow Lite engines:
* In your terminal, the exact probabilities are displayed.
* Simultaneously, a 5-byte telemetry packet is fired over UDP back to the wristband.
* The **OLED updates its bars and condition name**, the **LED pulses/strobes**, and the **Buzzer sounds** accordingly!

---

## 7. How to Test the 4 Movement States

1. **Testing Healthy Normal Movement**:
   * Wear the band and move your hand normally or type on a keyboard $\rightarrow$ OLED shows `HEALTHY NORMAL` (Norm $>80\%$), LED gives a gentle heartbeat pulse, Buzzer remains silent.
2. **Testing Parkinson's Rest Tremor**:
   * Rest your arm fully supported on your lap. Oscillate your hand gently at 4–6 Hz with a subtle rotational wrist twisting ("pill-rolling") $\rightarrow$ OLED displays `PARKINSON'S (PD)`, LED double-blinks with a soft chirp.
3. **Testing Essential Tremor (Postural & Kinetic)**:
   * Hold your arm outstretched horizontally against gravity. Vibrate your hand rapidly up and down at 6–8 Hz $\rightarrow$ OLED displays `ESSENTIAL TREMOR`, LED triple-blinks.
4. **Testing Seizure-Like Clonic Convulsions**:
   * Vibrate the entire forearm violently in continuous, high-amplitude bursts ($>1.5g$) $\rightarrow$ OLED flashes inverted warning box **`!!! WARNING: SEIZURE ALERT !!!`**, **Active Buzzer sounds loud continuous siren beeps, and LED strobes violently**!

---
*All code and guides are archived and maintained inside `overall context/`.*
