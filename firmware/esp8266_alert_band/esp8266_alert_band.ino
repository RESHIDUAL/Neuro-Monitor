/*
 * ESP8266 Alert Band & Caregiver Receiver Firmware (Band 2)
 * Dual-Band Cross-Alert System with U8g2 OLED Display, Buzzer & LED
 * --------------------------------------------------------------------------
 * Capabilities:
 *   1. Receives real-time AI classification alerts from the Python ML host
 *   2. Directly receives and alerts on Peer-to-Peer alerts from Band 1
 *   3. If Band 1 detects an alert, Band 2 immediately triggers OLED siren + Buzzer + LED
 *   4. If Band 2 detects an alert (or button pressed), it broadcasts an alert to Band 1
 *   5. Auto-detects optional MPU6050 on D1/D2; if absent, runs seamlessly as a
 *      dedicated Caregiver Alert Receiver node.
 * 
 * Hardware Pinout (Sequential Dedicated Pins D1 to D7):
 *   - [OPTIONAL MPU6050] : SCL -> D1 (GPIO 5), SDA -> D2 (GPIO 4)
 *   - [OLED DISPLAY]     : SCL -> D3 (GPIO 0), SDA -> D4 (GPIO 2)
 *   - [ALERT LED]        : Pin D5 (GPIO 14) via 220-330 ohm resistor
 *   - [ACTIVE BUZZER]    : Pin D6 (GPIO 12)
 *   - [TEST/PANIC BUTTON]: Pin D7 (GPIO 13) to GND (internal pull-up)
 */

#include <ESP8266WiFi.h>
#include <WiFiUdp.h>
#include <Wire.h>
#include <U8g2lib.h>

// ==========================================
// 1. NETWORK & NODE CONFIGURATION
// ==========================================
const char* WIFI_SSID     = "C";                      // Your Wi-Fi Name (match Band 1)
const char* WIFI_PASSWORD = "12345678";               // Your Wi-Fi Password
IPAddress   targetPC(172, 24, 107, 41);               // Direct IP of ML Host PC
const int   UDP_PORT      = 8888;                     // Port matching receiver and Band 1

const uint8_t MY_BAND_ID  = 2;                        // This node is Band 2 (Caregiver / Partner)

IPAddress   targetBroadcastIP;
WiFiUDP     udp;

// ==========================================
// 2. HARDWARE PIN DEFINITIONS
// ==========================================
// Bus 1 (Optional MPU6050)
#define PIN_MPU_SCL         D1      // GPIO 5
#define PIN_MPU_SDA         D2      // GPIO 4
#define MPU_ADDR            0x68

// Bus 2 (OLED Display - Dedicated independent pins)
#define PIN_OLED_SCL        D3      // GPIO 0
#define PIN_OLED_SDA        D4      // GPIO 2

// Sensory Alert Actuators & Inputs
#define PIN_LED             D5      // GPIO 14 -> Red/Amber Alert LED
#define PIN_BUZZER          D7      // GPIO 12 -> Active Piezo Buzzer
#define PIN_PANIC_BUTTON    D10      // GPIO 13 -> Manual Alert/Test Button to GND

// U8g2 Software I2C Driver for SSD1306 128x64 OLED
U8G2_SSD1306_128X64_NONAME_F_SW_I2C u8g2(U8G2_R0, PIN_OLED_SCL, PIN_OLED_SDA, U8X8_PIN_NONE);

// ==========================================
// 3. PROTOCOL DATA STRUCTURES
// ==========================================
// Direct Peer-to-Peer Cross-Band Alert Packet (8 bytes)
struct __attribute__((packed)) PeerAlertPacket {
    uint8_t  magic;       // Constant 0xAA for validation
    uint8_t  sender_id;   // 1 = Band 1, 2 = Band 2
    uint8_t  alert_code;  // 0=Normal, 1=PD, 2=ET, 3=Seizure Emergency
    uint8_t  severity;    // 0-100% confidence
    uint32_t timestamp;   // Milliseconds since boot
};

// Compact 5-byte Downlink Feedback Packet from Python ML host
struct __attribute__((packed)) DownlinkFeedback {
    uint8_t alert_code; // 0=Norm, 1=PD, 2=ET, 3=Seizure
    uint8_t prob_norm;  // 0-100%
    uint8_t prob_pd;    // 0-100%
    uint8_t prob_et;    // 0-100%
    uint8_t prob_seiz;  // 0-100%
};

// 11-byte Band Heartbeat / Identification Packet (sent on connect & every 1000 ms)
struct __attribute__((packed)) BandHeartbeatPacket {
    uint8_t  magic;       // Constant 0xBB (Heartbeat identification)
    uint8_t  band_id;     // 2 = Band 2 (Caregiver Alert Band)
    uint8_t  role;        // 2 = CAREGIVER_RECEIVER
    uint8_t  battery_pct; // 0-100%
    int8_t   rssi;        // Wi-Fi signal in dBm
    uint32_t uptime_ms;   // Milliseconds since boot
    uint16_t packet_seq;  // Transmission counter
};

unsigned long lastHeartbeatMs = 0;
uint16_t heartbeatSeq = 0;

void sendHeartbeat() {
    BandHeartbeatPacket hb;
    hb.magic       = 0xBB;
    hb.band_id     = MY_BAND_ID; // 2 = Caregiver Band
    hb.role        = 2;          // 2 = CAREGIVER_RECEIVER
    hb.battery_pct = 100;
    hb.rssi        = WiFi.RSSI();
    hb.uptime_ms   = millis();
    hb.packet_seq  = ++heartbeatSeq;

    // Send direct to PC host
    udp.beginPacket(targetPC, UDP_PORT);
    udp.write((const uint8_t*)&hb, sizeof(hb));
    udp.endPacket();

    // Broadcast to subnet
    udp.beginPacket(targetBroadcastIP, UDP_PORT);
    udp.write((const uint8_t*)&hb, sizeof(hb));
    udp.endPacket();
}

// 16-byte Kinematic uplink frame (if MPU6050 attached)
struct __attribute__((packed)) KinematicFrame {
    uint32_t timestamp_ms;
    int16_t  acc_x;
    int16_t  acc_y;
    int16_t  acc_z;
    int16_t  gyro_x;
    int16_t  gyro_y;
    int16_t  gyro_z;
};

#define FRAMES_PER_PACKET   10
#define SAMPLE_INTERVAL_US  10000   // 100 Hz = 10 ms
#define OLED_REFRESH_MS     120     // Refresh OLED at ~8 Hz

KinematicFrame packetBuffer[FRAMES_PER_PACKET];
uint8_t frameIndex = 0;
bool hasMPU6050 = false;

// ==========================================
// 4. ALERT STATE MACHINE
// ==========================================
enum AlertMode {
    MODE_IDLE = 0,
    MODE_LOCAL_SEIZURE,
    MODE_REMOTE_SEIZURE_BAND1,
    MODE_REMOTE_TREMOR_BAND1,
    MODE_MANUAL_PANIC
};

volatile AlertMode currentAlertMode = MODE_IDLE;
unsigned long alertStartTime = 0;
const unsigned long ALERT_DURATION_MS = 3500;

// Classification & Telemetry metrics
uint8_t disp_prob_norm = 100;
uint8_t disp_prob_pd   = 0;
uint8_t disp_prob_et   = 0;
uint8_t disp_prob_seiz = 0;
String  disp_status_str = "MONITORING";
String  disp_source_str = "SYSTEM READY";

unsigned long lastSampleMicros = 0;
unsigned long lastOledRefreshMs = 0;
unsigned long lastButtonCheckMs = 0;
float current_g_mag = 1.0;

// ==========================================
// 5. BROADCAST TRANSMITTERS
// ==========================================
void sendPeerAlert(uint8_t alertCode, uint8_t severity) {
    PeerAlertPacket alert;
    alert.magic      = 0xAA;
    alert.sender_id  = MY_BAND_ID;
    alert.alert_code = alertCode;
    alert.severity   = severity;
    alert.timestamp  = millis();

    // Broadcast to subnet so Band 1 and all other nodes receive it immediately
    udp.beginPacket(targetBroadcastIP, UDP_PORT);
    udp.write((const uint8_t*)&alert, sizeof(alert));
    udp.endPacket();

    // Also send direct to PC host
    udp.beginPacket(targetPC, UDP_PORT);
    udp.write((const uint8_t*)&alert, sizeof(alert));
    udp.endPacket();

    Serial.print("[PEER ALERT] Broadcasted alert code ");
    Serial.print(alertCode);
    Serial.println(" to Band 1 & Network!");
}

// ==========================================
// 6. MPU6050 SENSOR ROUTINES (AUTO-DETECTED)
// ==========================================
bool probeMPU6050() {
    Wire.begin(PIN_MPU_SDA, PIN_MPU_SCL);
    Wire.setClock(400000);
    Wire.beginTransmission(MPU_ADDR);
    byte error = Wire.endTransmission();
    return (error == 0);
}

void initMPU6050() {
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x6B); // Power management register
    Wire.write(0x00); // Wake up
    Wire.endTransmission(true);
    delay(30);

    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x1A); // DLPF
    Wire.write(0x04); // 21 Hz filter
    Wire.endTransmission(true);

    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x19); // SMPLRT_DIV
    Wire.write(0x09); // 100 Hz
    Wire.endTransmission(true);

    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x1B); // Gyro +/- 250 dps
    Wire.write(0x00);
    Wire.endTransmission(true);

    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x1C); // Accel +/- 2g
    Wire.write(0x00);
    Wire.endTransmission(true);

    Serial.println("[MPU6050] Initialized on D1/D2 at 100 Hz.");
}

void readRawMPU(int16_t &ax, int16_t &ay, int16_t &az, int16_t &gx, int16_t &gy, int16_t &gz) {
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x3B);
    Wire.endTransmission(false);
    Wire.requestFrom((uint8_t)MPU_ADDR, (size_t)14, true);

    ax = (Wire.read() << 8) | Wire.read();
    ay = (Wire.read() << 8) | Wire.read();
    az = (Wire.read() << 8) | Wire.read();
    Wire.read(); Wire.read(); // Skip temp
    gx = (Wire.read() << 8) | Wire.read();
    gy = (Wire.read() << 8) | Wire.read();
    gz = (Wire.read() << 8) | Wire.read();
}

// ==========================================
// 7. INCOMING PACKET DISPATCHER
// ==========================================
void checkIncomingPackets() {
    int packetSize = udp.parsePacket();
    if (packetSize <= 0) return;

    // A. Direct Cross-Band Peer Alert Packet (8 bytes)
    if (packetSize == sizeof(PeerAlertPacket)) {
        PeerAlertPacket alert;
        udp.read((char*)&alert, sizeof(PeerAlertPacket));

        // Validate magic header
        if (alert.magic == 0xAA && alert.sender_id != MY_BAND_ID) {
            alertStartTime = millis();
            Serial.print("[CROSS-ALERT] Received alert from Band ");
            Serial.print(alert.sender_id);
            Serial.print(" | Code: ");
            Serial.println(alert.alert_code);

            if (alert.alert_code == 3) {
                // Seizure Emergency detected on the other band!
                currentAlertMode = MODE_REMOTE_SEIZURE_BAND1;
                disp_status_str = "BAND 1 SEIZURE!";
                disp_source_str = "REMOTE ALARM: BAND 1";
                disp_prob_seiz = alert.severity > 0 ? alert.severity : 98;
            } else if (alert.alert_code == 1 || alert.alert_code == 2) {
                currentAlertMode = MODE_REMOTE_TREMOR_BAND1;
                disp_status_str = (alert.alert_code == 1) ? "BAND 1: PARKINSON" : "BAND 1: TREMOR";
                disp_source_str = "REMOTE TREMOR DETECT";
                if (alert.alert_code == 1) disp_prob_pd = alert.severity;
                else disp_prob_et = alert.severity;
            } else {
                currentAlertMode = MODE_IDLE;
                disp_status_str = "MONITORING";
                disp_source_str = "BAND 1 CLEAR";
            }
            return;
        }
    }

    // B. ML Host Downlink Telemetry Feedback (5 bytes)
    if (packetSize == sizeof(DownlinkFeedback)) {
        DownlinkFeedback fb;
        udp.read((char*)&fb, sizeof(DownlinkFeedback));

        alertStartTime = millis();
        disp_prob_norm = fb.prob_norm;
        disp_prob_pd   = fb.prob_pd;
        disp_prob_et   = fb.prob_et;
        disp_prob_seiz = fb.prob_seiz;

        if (fb.alert_code == 3) {
            currentAlertMode = MODE_REMOTE_SEIZURE_BAND1;
            disp_status_str = "! SEIZURE ALARM !";
            disp_source_str = "AI MODEL: SEIZURE";
            Serial.println("[AI ALERT] Seizure classified by ML Host!");
        } else if (fb.alert_code == 1) {
            currentAlertMode = MODE_REMOTE_TREMOR_BAND1;
            disp_status_str = "PARKINSON'S (PD)";
            disp_source_str = "AI MODEL: PD DETECT";
        } else if (fb.alert_code == 2) {
            currentAlertMode = MODE_REMOTE_TREMOR_BAND1;
            disp_status_str = "ESSENTIAL TREMOR";
            disp_source_str = "AI MODEL: ET DETECT";
        } else {
            if (currentAlertMode != MODE_MANUAL_PANIC) {
                currentAlertMode = MODE_IDLE;
                disp_status_str = "NORMAL MOTION";
                disp_source_str = "HOST SYNCED";
            }
        }
        return;
    }

    // Flush any unrecognized bytes
    while (udp.available()) udp.read();
}

// ==========================================
// 8. NON-BLOCKING BUZZER & LED STATE MACHINE
// ==========================================
void updateAlerts() {
    unsigned long now = millis();

    // Auto-clear alert when duration expires
    if (currentAlertMode != MODE_IDLE && (now - alertStartTime > ALERT_DURATION_MS)) {
        currentAlertMode = MODE_IDLE;
        disp_status_str = "MONITORING";
        disp_source_str = "SYSTEM READY";
        digitalWrite(PIN_BUZZER, LOW);
        digitalWrite(PIN_LED, LOW);
        digitalWrite(LED_BUILTIN, HIGH);
    }

    switch (currentAlertMode) {
        case MODE_REMOTE_SEIZURE_BAND1:
        case MODE_LOCAL_SEIZURE:
        case MODE_MANUAL_PANIC: {
            // Rapid high-priority emergency siren: toggle every 100 ms
            bool state = ((now / 100) % 2) == 0;
            digitalWrite(PIN_BUZZER, state ? HIGH : LOW);
            digitalWrite(PIN_LED, state ? HIGH : LOW);
            digitalWrite(LED_BUILTIN, state ? LOW : HIGH);
            break;
        }

        case MODE_REMOTE_TREMOR_BAND1: {
            // Pulsed notification: 2 short beeps every 800 ms
            unsigned long cycle = now % 800;
            bool led_on = (cycle < 100) || (cycle >= 200 && cycle < 300);
            digitalWrite(PIN_LED, led_on ? HIGH : LOW);
            digitalWrite(LED_BUILTIN, led_on ? LOW : HIGH);
            digitalWrite(PIN_BUZZER, (cycle < 50) ? HIGH : LOW);
            break;
        }

        case MODE_IDLE:
        default: {
            // Gentle heartbeat pulse: 25 ms flash every 2.5 seconds, silent buzzer
            unsigned long cycle = now % 2500;
            bool pulse = (cycle < 25);
            digitalWrite(PIN_LED, pulse ? HIGH : LOW);
            digitalWrite(LED_BUILTIN, pulse ? LOW : HIGH);
            digitalWrite(PIN_BUZZER, LOW);
            break;
        }
    }
}

// ==========================================
// 9. OLED DISPLAY RENDERING (U8G2)
// ==========================================
void renderOLED() {
    u8g2.clearBuffer();

    if (currentAlertMode == MODE_REMOTE_SEIZURE_BAND1 ||
        currentAlertMode == MODE_LOCAL_SEIZURE ||
        currentAlertMode == MODE_MANUAL_PANIC) {
        
        // High-contrast inverted flashing emergency screen
        bool flash = ((millis() / 250) % 2) == 0;
        if (flash) {
            u8g2.drawBox(0, 0, 128, 64);
            u8g2.setDrawColor(0); // Invert text
        } else {
            u8g2.drawFrame(0, 0, 128, 64);
            u8g2.drawFrame(2, 2, 124, 60);
            u8g2.setDrawColor(1);
        }

        u8g2.setFont(u8g2_font_7x14B_tf);
        u8g2.drawStr(10, 20, "!! ALARM !!");
        
        u8g2.setFont(u8g2_font_6x12_tf);
        if (currentAlertMode == MODE_REMOTE_SEIZURE_BAND1) {
            u8g2.drawStr(8, 36, "BAND 1 SEIZURE!");
            u8g2.setFont(u8g2_font_5x8_tf);
            u8g2.drawStr(12, 52, "Check Patient Now!");
        } else if (currentAlertMode == MODE_MANUAL_PANIC) {
            u8g2.drawStr(14, 36, "MANUAL PANIC!");
            u8g2.setFont(u8g2_font_5x8_tf);
            u8g2.drawStr(14, 52, "Broadcasting Alert");
        } else {
            u8g2.drawStr(10, 36, "LOCAL SEIZURE!");
            u8g2.setFont(u8g2_font_5x8_tf);
            u8g2.drawStr(12, 52, "Alerting Band 1...");
        }
        u8g2.setDrawColor(1);

    } else {
        // Standard Dual-Band Monitoring Dashboard
        // 1. Top Header Bar
        u8g2.setFont(u8g2_font_5x8_tf);
        u8g2.drawStr(0, 8, "BAND 2: CAREGIVER");
        u8g2.drawStr(82, 8, hasMPU6050 ? "IMU+SYNC" : "SYNC OK");
        u8g2.drawHLine(0, 11, 128);

        // 2. State & Cross-Band Origin
        u8g2.setFont(u8g2_font_6x10_tf);
        u8g2.drawStr(0, 23, "State: ");
        u8g2.setFont(u8g2_font_6x12_tf);
        u8g2.drawStr(42, 23, disp_status_str.c_str());

        // 3. Source Origin Line
        u8g2.setFont(u8g2_font_5x8_tf);
        u8g2.drawStr(0, 35, "Src: ");
        u8g2.drawStr(28, 35, disp_source_str.c_str());

        // 4. Probability Summary / Confidence Bar
        char buf[32];
        snprintf(buf, sizeof(buf), "Norm:%d%%  PD:%d%%  Seiz:%d%%", disp_prob_norm, disp_prob_pd, disp_prob_seiz);
        u8g2.drawStr(0, 47, buf);

        u8g2.drawFrame(0, 51, 128, 5);
        int max_p = max(disp_prob_seiz, max(disp_prob_pd, disp_prob_et));
        int bar_w = map(max_p, 0, 100, 0, 124);
        if (bar_w > 0) {
            u8g2.drawBox(2, 52, bar_w, 3);
        }

        // 5. Bottom Link & Motion status
        if (hasMPU6050) {
            snprintf(buf, sizeof(buf), "|a|: %1.2fg  P2P: Ready", current_g_mag);
        } else {
            snprintf(buf, sizeof(buf), "P2P Link: OK | Btn: Test");
        }
        u8g2.drawStr(0, 62, buf);
    }

    u8g2.sendBuffer();
}

// ==========================================
// 10. SETUP
// ==========================================
void setup() {
    Serial.begin(115200);
    delay(300);

    pinMode(PIN_LED, OUTPUT);
    pinMode(PIN_BUZZER, OUTPUT);
    pinMode(PIN_PANIC_BUTTON, INPUT_PULLUP);
    pinMode(LED_BUILTIN, OUTPUT);

    digitalWrite(PIN_LED, LOW);
    digitalWrite(PIN_BUZZER, LOW);
    digitalWrite(LED_BUILTIN, HIGH); // Active LOW

    Serial.println("\n==============================================");
    Serial.println("  Neuro Monitor: ESP8266 Alert Band (Band 2)  ");
    Serial.println("  Dual-Band Cross-Alert & Caregiver Receiver  ");
    Serial.println("==============================================");

    system_update_cpu_freq(160); // 160 MHz

    // Initialize OLED Display on dedicated pins D3 & D4
    u8g2.begin();
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_7x14B_tf);
    u8g2.drawStr(12, 22, "ALERT BAND 2");
    u8g2.setFont(u8g2_font_6x10_tf);
    u8g2.drawStr(16, 42, "Dual-Band Link");
    u8g2.drawStr(18, 56, "Connecting WiFi...");
    u8g2.sendBuffer();

    // Connect to Wi-Fi
    Serial.print("[WIFI] Connecting to ");
    Serial.println(WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    while (WiFi.status() != WL_CONNECTED) {
        digitalWrite(PIN_LED, !digitalRead(PIN_LED));
        delay(250);
        Serial.print(".");
    }
    digitalWrite(PIN_LED, LOW);

    Serial.println("\n[WIFI] Connected!");
    Serial.print("[WIFI] Local IP: ");
    Serial.println(WiFi.localIP());

    targetBroadcastIP = WiFi.localIP();
    targetBroadcastIP[3] = 255;

    Serial.print("[STREAM] Subnet Broadcast: ");
    Serial.println(targetBroadcastIP);

    udp.begin(UDP_PORT);

    // Auto-detect MPU6050
    hasMPU6050 = probeMPU6050();
    if (hasMPU6050) {
        Serial.println("[HARDWARE] MPU6050 detected on D1/D2! Enabling 100 Hz kinematic stream.");
        initMPU6050();
    } else {
        Serial.println("[HARDWARE] No MPU6050 detected on D1/D2. Running as Dedicated Caregiver Alert Node.");
    }

    // Startup beep confirmation: 2 short beeps
    digitalWrite(PIN_BUZZER, HIGH);
    digitalWrite(PIN_LED, HIGH);
    delay(80);
    digitalWrite(PIN_BUZZER, LOW);
    digitalWrite(PIN_LED, LOW);
    delay(60);
    digitalWrite(PIN_BUZZER, HIGH);
    digitalWrite(PIN_LED, HIGH);
    delay(80);
    digitalWrite(PIN_BUZZER, LOW);
    digitalWrite(PIN_LED, LOW);

    lastSampleMicros = micros();
    lastOledRefreshMs = millis();
    lastHeartbeatMs = millis();
    sendHeartbeat(); // Announce Band 2 immediately to dashboard
}

// ==========================================
// 11. MAIN LOOP (CAREGIVER RECEIVER & MONITORING ONLY)
// ==========================================
void loop() {
    unsigned long now = millis();

    // 0. Send heartbeat every 1000 ms so dashboard sees Band 2 online
    if (now - lastHeartbeatMs >= 1000) {
        lastHeartbeatMs = now;
        sendHeartbeat();
    }

    // Caregiver Band is strictly for alert reception and monitoring
    // It does not initiate false cross-alerts

    // 1. Kinematic sampling loop (if MPU6050 present, streams to host only)
    if (hasMPU6050) {
        unsigned long currentMicros = micros();
        if (currentMicros - lastSampleMicros >= SAMPLE_INTERVAL_US) {
            lastSampleMicros += SAMPLE_INTERVAL_US;

            int16_t ax, ay, az, gx, gy, gz;
            readRawMPU(ax, ay, az, gx, gy, gz);

            packetBuffer[frameIndex].timestamp_ms = millis();
            packetBuffer[frameIndex].acc_x        = ax;
            packetBuffer[frameIndex].acc_y        = ay;
            packetBuffer[frameIndex].acc_z        = az;
            packetBuffer[frameIndex].gyro_x       = gx;
            packetBuffer[frameIndex].gyro_y       = gy;
            packetBuffer[frameIndex].gyro_z       = gz;

            float fax = ax / 16384.0f;
            float fay = ay / 16384.0f;
            float faz = az / 16384.0f;
            current_g_mag = sqrt(fax*fax + fay*fay + faz*faz);

            frameIndex++;

            if (frameIndex >= FRAMES_PER_PACKET) {
                // Stream to PC host
                udp.beginPacket(targetPC, UDP_PORT);
                udp.write((const uint8_t*)packetBuffer, sizeof(packetBuffer));
                udp.endPacket();

                frameIndex = 0;
            }
        }
    }

    // 2. Process incoming UDP alerts from Band 1 (Patient Band) & AI host telemetry
    checkIncomingPackets();

    // 3. Update buzzer and LED actuators
    updateAlerts();

    // 4. Update OLED Graphic Display
    if (now - lastOledRefreshMs >= OLED_REFRESH_MS) {
        lastOledRefreshMs = now;
        renderOLED();
    }

    yield();
}
