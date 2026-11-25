/*
 * ESP8266 + MPU6050 Wristband Firmware: Real-Time 100 Hz Kinematic Streamer
 * With U8g2 OLED Display, Closed-Loop Buzzer & LED Sensory Alerts
 * --------------------------------------------------------------------------
 * Hardware Peripherals & Dedicated Pinout (Sequential D1 to D6):
 * 
 *   [BUS 1: MPU6050 Motion Sensor]
 *     - SCL -> Pin D1 (GPIO 5)
 *     - SDA -> Pin D2 (GPIO 4)
 *     - VCC -> 3.3V, GND -> GND, AD0 -> GND
 * 
 *   [BUS 2: OLED Display - COMPLETELY SEPARATE PINS!]
 *     - SCL -> Pin D3 (GPIO 0)
 *     - SDA -> Pin D4 (GPIO 2)
 *     - VCC -> 3.3V, GND -> GND
 *     - Driven independently by U8g2 SW I2C engine
 * 
 *   [ALERT ACTUATORS]
 *     - Visual Alert LED  -> Pin D5 (GPIO 14) via 220-330 ohm resistor
 *     - Active Buzzer     -> Pin D6 (GPIO 12)
 * 
 *   Each device now has its own separate physical pins on your board!
 */

#include <ESP8266WiFi.h>
#include <WiFiUdp.h>
#include <Wire.h>
#include <U8g2lib.h>

// ==========================================
// 1. NETWORK CONFIGURATION
// ==========================================
const char* WIFI_SSID     = "C";                      // Your Wi-Fi Name
const char* WIFI_PASSWORD = "12345678";               // Your Wi-Fi Password
IPAddress   targetPC(172, 24, 107, 41);               // Direct IPAddress object (no DNS overhead)
const int   UDP_PORT      = 8888;                     // Port matching the Python receiver

IPAddress   targetBroadcastIP;

// ==========================================
// 2. DEDICATED PIN ASSIGNMENTS (D1 to D7)
// ==========================================
#define MPU_ADDR            0x68    // MPU6050 I2C address
#define SAMPLE_INTERVAL_US  10000   // 10,000 us = 10 ms = 100 Hz
#define FRAMES_PER_PACKET   10      // 10 frames per UDP packet (100 ms)
#define OLED_REFRESH_MS     1000    // Refresh OLED at 1 Hz to avoid I2C blocking in 100 Hz loop

const uint8_t MY_BAND_ID    = 1;    // Primary Patient Sensing Node (Band 1)

// Bus 1 (MPU6050): Dedicated hardware pins D1 & D2
#define PIN_MPU_SCL         D1      // Pin labeled "D1" -> MPU6050 SCL
#define PIN_MPU_SDA         D2      // Pin labeled "D2" -> MPU6050 SDA

// Bus 2 (OLED Display): Dedicated separate pins D3 & D4
#define PIN_OLED_SCL        D3      // Pin labeled "D3" -> OLED SCL
#define PIN_OLED_SDA        D4      // Pin labeled "D4" -> OLED SDA

// Alert Actuators & Input: Dedicated pins D5, D6, D7
#define PIN_LED             D5      // Pin labeled "D5" -> Alert LED
#define PIN_BUZZER          D8      // Pin labeled "D6" -> Active Piezo Buzzer
#define PIN_PANIC_BUTTON    D7      // Pin labeled "D7" -> Test/Panic Button to GND

// Initialize U8g2 Graphic Display: SSD1306 128x64 on separate dedicated pins D3 and D4!
U8G2_SSD1306_128X64_NONAME_F_SW_I2C u8g2(U8G2_R0, /* clock=SCL */ PIN_OLED_SCL, /* data=SDA */ PIN_OLED_SDA, /* reset=*/ U8X8_PIN_NONE);

// Alert Modes
enum AlertMode {
    MODE_IDLE = 0,             // Normal healthy motion
    MODE_PARKINSONS = 1,       // Parkinson's rest tremor detected
    MODE_ESSENTIAL_TREMOR = 2, // Essential tremor postural/action detected
    MODE_SEIZURE_ALARM = 3,    // Violent convulsive seizure alert!
    MODE_REMOTE_ALERT_BAND2 = 4// Emergency alert received from Band 2!
};

volatile AlertMode currentAlertMode = MODE_IDLE;
unsigned long alertStartTime = 0;
const unsigned long ALERT_DURATION_MS = 3000;

// Direct Peer-to-Peer Cross-Band Alert Packet (8 bytes)
struct __attribute__((packed)) PeerAlertPacket {
    uint8_t  magic;       // Constant 0xAA for validation
    uint8_t  sender_id;   // 1 = Band 1, 2 = Band 2
    uint8_t  alert_code;  // 0=Normal, 1=PD, 2=ET, 3=Seizure Emergency
    uint8_t  severity;    // 0-100% confidence
    uint32_t timestamp;   // Milliseconds since boot
};

// 11-byte Band Heartbeat / Identification Packet (sent on connect & every 1000 ms)
struct __attribute__((packed)) BandHeartbeatPacket {
    uint8_t  magic;       // Constant 0xBB (Heartbeat identification)
    uint8_t  band_id;     // 1 = Band 1 (Patient Primary IMU)
    uint8_t  role;        // 1 = PATIENT_PRIMARY, 2 = CAREGIVER_RECEIVER
    uint8_t  battery_pct; // 0-100%
    int8_t   rssi;        // Wi-Fi signal in dBm
    uint32_t uptime_ms;   // Milliseconds since boot
    uint16_t packet_seq;  // Transmission counter
};

unsigned long lastHeartbeatMs = 0;
uint16_t heartbeatSeq = 0;

// Real-time classification telemetry received from host
uint8_t disp_prob_norm = 100;
uint8_t disp_prob_pd   = 0;
uint8_t disp_prob_et   = 0;
uint8_t disp_prob_seiz = 0;
String  disp_status_str = "NORMAL";

// Packed 16-byte kinematic uplink frame
struct __attribute__((packed)) KinematicFrame {
    uint32_t timestamp_ms; // Milliseconds since boot
    int16_t  acc_x;        // Raw acceleration X (+/- 2g range)
    int16_t  acc_y;        // Raw acceleration Y
    int16_t  acc_z;        // Raw acceleration Z
    int16_t  gyro_x;       // Raw angular rate X (+/- 250 deg/s)
    int16_t  gyro_y;       // Raw angular rate Y
    int16_t  gyro_z;       // Raw angular rate Z
};

// Compact 5-byte downlink feedback packet from Python ML host
struct __attribute__((packed)) DownlinkFeedback {
    uint8_t alert_code; // 0=Norm, 1=PD, 2=ET, 3=Seizure
    uint8_t prob_norm;  // 0-100%
    uint8_t prob_pd;    // 0-100%
    uint8_t prob_et;    // 0-100%
    uint8_t prob_seiz;  // 0-100%
};

KinematicFrame packetBuffer[FRAMES_PER_PACKET];
uint8_t frameIndex = 0;

WiFiUDP udp;
unsigned long lastSampleMicros = 0;
unsigned long lastOledRefreshMs = 0;
uint32_t packetSequence = 0;

// Sensor calibration offsets
int16_t ax_offset = 0, ay_offset = 0, az_offset = 0;
int16_t gx_offset = 0, gy_offset = 0, gz_offset = 0;

// Instantaneous acceleration magnitude for live sparkline
float current_g_mag = 1.0;

// ==========================================
// 3. MPU6050 REGISTER CONFIGURATION
// ==========================================
void writeMPURegister(uint8_t reg, uint8_t value) {
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(reg);
    Wire.write(value);
    Wire.endTransmission(true);
}

void initMPU6050() {
    Wire.begin(D2, D1); // Pin D2 is SDA, Pin D1 is SCL
    Wire.setClock(400000); // 400 kHz Fast I2C Bus
    Serial.println("[MPU6050] Initializing sensor registers...");

    // 1. Wake up MPU6050 (Clear sleep bit)
    writeMPURegister(0x6B, 0x00);
    delay(40);

    // 2. Set Digital Low-Pass Filter (DLPF_CFG = 4 -> 21 Hz bandwidth)
    // Hardware anti-aliasing filter
    writeMPURegister(0x1A, 0x04);

    // 3. Sample Rate Divider: 1 kHz / (1 + 9) = 100 Hz
    writeMPURegister(0x19, 0x09);

    // 4. Gyroscope Configuration: +/- 250 deg/s range
    writeMPURegister(0x1B, 0x00);

    // 5. Accelerometer Configuration: +/- 2g range
    writeMPURegister(0x1C, 0x00);

    Serial.println("[MPU6050] Configured: 100 Hz, 21 Hz DLPF, +/-2g, +/-250 dps.");
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

void calibrateSensor() {
    Serial.println("[CALIB] Keep the wristband still on a table for 2 seconds...");

    // Show calibration prompt on OLED
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_7x14B_tf);
    u8g2.drawStr(12, 22, "CALIBRATING...");
    u8g2.setFont(u8g2_font_6x10_tf);
    u8g2.drawStr(8, 42, "Keep wristband still");
    u8g2.drawStr(16, 56, "on a flat table");
    u8g2.sendBuffer();

    digitalWrite(PIN_BUZZER, HIGH);
    digitalWrite(PIN_LED, HIGH);
    delay(100);
    digitalWrite(PIN_BUZZER, LOW);
    digitalWrite(PIN_LED, LOW);

    long sgx = 0, sgy = 0, sgz = 0;
    const int numSamples = 200;

    for (int i = 0; i < numSamples; i++) {
        int16_t ax, ay, az, gx, gy, gz;
        readRawMPU(ax, ay, az, gx, gy, gz);
        sgx += gx;
        sgy += gy;
        sgz += gz;
        delay(10);
    }

    gx_offset = sgx / numSamples;
    gy_offset = sgy / numSamples;
    gz_offset = sgz / numSamples;

    // Double beep: ready
    digitalWrite(PIN_BUZZER, HIGH);
    digitalWrite(PIN_LED, HIGH);
    delay(80);
    digitalWrite(PIN_BUZZER, LOW);
    digitalWrite(PIN_LED, LOW);
    delay(80);
    digitalWrite(PIN_BUZZER, HIGH);
    digitalWrite(PIN_LED, HIGH);
    delay(80);
    digitalWrite(PIN_BUZZER, LOW);
    digitalWrite(PIN_LED, LOW);

    Serial.println("[CALIB] Calibration complete!");
}

// ==========================================
// 4. CROSS-BAND PEER ALERT BROADCAST
// ==========================================
void sendPeerAlert(uint8_t alertCode, uint8_t severity) {
    PeerAlertPacket alert;
    alert.magic      = 0xAA;
    alert.sender_id  = MY_BAND_ID;
    alert.alert_code = alertCode;
    alert.severity   = severity;
    alert.timestamp  = millis();

    // Broadcast to subnet so Band 2 and other nodes receive it immediately
    udp.beginPacket(targetBroadcastIP, UDP_PORT);
    udp.write((const uint8_t*)&alert, sizeof(alert));
    udp.endPacket();

    // Also send direct to PC host
    udp.beginPacket(targetPC, UDP_PORT);
    udp.write((const uint8_t*)&alert, sizeof(alert));
    udp.endPacket();

    Serial.print("[PEER ALERT] Broadcasted alert code ");
    Serial.print(alertCode);
    Serial.println(" to Band 2 & Network!");
}

void sendHeartbeat() {
    BandHeartbeatPacket hb;
    hb.magic       = 0xBB;
    hb.band_id     = MY_BAND_ID; // 1 = Patient Band
    hb.role        = 1;          // 1 = PATIENT_PRIMARY
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

// ==========================================
// 5. NON-BLOCKING BUZZER & LED STATE MACHINE
// ==========================================
void updateAlerts() {
    unsigned long now = millis();

    if (currentAlertMode != MODE_IDLE && (now - alertStartTime > ALERT_DURATION_MS)) {
        currentAlertMode = MODE_IDLE;
        disp_status_str = "NORMAL";
        digitalWrite(PIN_BUZZER, LOW);
        digitalWrite(PIN_LED, LOW);
        digitalWrite(LED_BUILTIN, HIGH);
    }

    switch (currentAlertMode) {
        case MODE_SEIZURE_ALARM:
        case MODE_REMOTE_ALERT_BAND2: {
            // Rapid emergency siren / strobe toggle every 100 ms
            bool state = ((now / 100) % 2) == 0;
            digitalWrite(PIN_BUZZER, state ? HIGH : LOW);
            digitalWrite(PIN_LED, state ? HIGH : LOW);
            digitalWrite(LED_BUILTIN, state ? LOW : HIGH);
            break;
        }
        case MODE_PARKINSONS: {
            // Double-blink pulse: cycle every 800 ms
            unsigned long cycle = now % 800;
            bool led_on = (cycle < 100) || (cycle >= 200 && cycle < 300);
            digitalWrite(PIN_LED, led_on ? HIGH : LOW);
            digitalWrite(LED_BUILTIN, led_on ? LOW : HIGH);
            digitalWrite(PIN_BUZZER, (cycle < 40) ? HIGH : LOW);
            break;
        }
        case MODE_ESSENTIAL_TREMOR: {
            // Triple-blink pulse: cycle every 1000 ms, silent buzzer
            unsigned long cycle = now % 1000;
            bool led_on = (cycle < 80) || (cycle >= 160 && cycle < 240) || (cycle >= 320 && cycle < 400);
            digitalWrite(PIN_LED, led_on ? HIGH : LOW);
            digitalWrite(LED_BUILTIN, led_on ? LOW : HIGH);
            digitalWrite(PIN_BUZZER, LOW);
            break;
        }
        case MODE_IDLE:
        default: {
            // Heartbeat blink: 20 ms pulse every 2.0 seconds
            unsigned long cycle = now % 2000;
            bool pulse = (cycle < 20);
            digitalWrite(PIN_LED, pulse ? HIGH : LOW);
            digitalWrite(LED_BUILTIN, pulse ? LOW : HIGH);
            digitalWrite(PIN_BUZZER, LOW);
            break;
        }
    }
}

// Process incoming UDP packets (Cross-Band Peer alerts + AI host telemetry)
void checkIncomingPackets() {
    int packetSize = udp.parsePacket();
    if (packetSize <= 0) return;

    // A. Cross-Band Peer Alert Packet (8 bytes)
    if (packetSize == sizeof(PeerAlertPacket)) {
        PeerAlertPacket alert;
        udp.read((char*)&alert, sizeof(PeerAlertPacket));

        if (alert.magic == 0xAA && alert.sender_id != MY_BAND_ID) {
            alertStartTime = millis();
            Serial.print("[CROSS-ALERT] Received alert from Band ");
            Serial.print(alert.sender_id);
            Serial.print(" | Code: ");
            Serial.println(alert.alert_code);

            if (alert.alert_code == 3) {
                currentAlertMode = MODE_REMOTE_ALERT_BAND2;
                disp_status_str = "BAND 2 ALARM!";
                disp_prob_seiz = alert.severity > 0 ? alert.severity : 95;
            } else if (alert.alert_code == 1 || alert.alert_code == 2) {
                currentAlertMode = (alert.alert_code == 1) ? MODE_PARKINSONS : MODE_ESSENTIAL_TREMOR;
                disp_status_str = (alert.alert_code == 1) ? "BAND 2: PD" : "BAND 2: ET";
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
            currentAlertMode = MODE_SEIZURE_ALARM;
            disp_status_str = "! SEIZURE ALARM !";
            Serial.println("[ALERT] >>> SEIZURE ALERT RECEIVED FROM HOST! <<<");
            // Also broadcast alert directly to Band 2!
            sendPeerAlert(3, fb.prob_seiz);
        } else if (fb.alert_code == 1) {
            currentAlertMode = MODE_PARKINSONS;
            disp_status_str = "PARKINSON'S (PD)";
            Serial.println("[ALERT] Parkinson's pattern received.");
        } else if (fb.alert_code == 2) {
            currentAlertMode = MODE_ESSENTIAL_TREMOR;
            disp_status_str = "ESSENTIAL TREMOR";
            Serial.println("[ALERT] Essential Tremor pattern received.");
        } else {
            if (currentAlertMode != MODE_REMOTE_ALERT_BAND2) {
                currentAlertMode = MODE_IDLE;
                disp_status_str = "HEALTHY NORMAL";
            }
        }
        return;
    }

    while (udp.available()) udp.read();
}

// ==========================================
// 5. U8G2 OLED DISPLAY RENDERING (NON-BLOCKING)
// ==========================================
void renderOLED() {
    u8g2.clearBuffer();

    if (currentAlertMode == MODE_SEIZURE_ALARM || currentAlertMode == MODE_REMOTE_ALERT_BAND2) {
        // High-contrast flashing inverted emergency screen
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
        u8g2.drawStr(12, 24, "!!! WARNING !!!");

        if (currentAlertMode == MODE_REMOTE_ALERT_BAND2) {
            u8g2.drawStr(8, 42, "BAND 2 ALARM!");
            u8g2.setFont(u8g2_font_5x8_tf);
            u8g2.drawStr(10, 56, "Cross-Alert Received");
        } else {
            u8g2.drawStr(8, 42, "SEIZURE ALERT!");
            u8g2.setFont(u8g2_font_5x8_tf);
            u8g2.drawStr(16, 56, "Assistance Required");
        }
        u8g2.setDrawColor(1);
    } else {
        // Standard Clinical Monitoring Dashboard
        // 1. Top Header Bar
        u8g2.setFont(u8g2_font_5x8_tf);
        u8g2.drawStr(0, 8, "BAND 1: PATIENT");
        u8g2.drawStr(84, 8, "100Hz WiFi");
        u8g2.drawHLine(0, 11, 128);

        // 2. Primary Classification Status Box
        u8g2.setFont(u8g2_font_6x12_tf);
        u8g2.drawStr(0, 24, "State: ");
        u8g2.setFont(u8g2_font_7x13B_tf);
        u8g2.drawStr(40, 24, disp_status_str.c_str());

        // 3. Real-Time Probability Metrics
        u8g2.setFont(u8g2_font_5x8_tf);
        char buf[32];
        snprintf(buf, sizeof(buf), "Norm:%2d%%  PD:%2d%%  ET:%2d%%", disp_prob_norm, disp_prob_pd, disp_prob_et);
        u8g2.drawStr(0, 38, buf);

        // 4. Horizontal Confidence Bar for dominant condition
        u8g2.drawFrame(0, 42, 128, 7);
        int dominant_prob = max(disp_prob_pd, max(disp_prob_et, disp_prob_norm));
        int bar_width = map(dominant_prob, 0, 100, 0, 124);
        if (bar_width > 0) {
            u8g2.drawBox(2, 44, bar_width, 3);
        }

        // 5. Bottom Info Bar: G-Force Magnitude and Seizure Probability
        snprintf(buf, sizeof(buf), "|a|: %1.2fg  Seiz Prob: %2d%%", current_g_mag, disp_prob_seiz);
        u8g2.drawStr(0, 60, buf);
    }

    u8g2.sendBuffer();
}

// ==========================================
// 6. SETUP
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
    digitalWrite(LED_BUILTIN, HIGH); // Active LOW -> OFF

    Serial.println("\n==============================================");
    Serial.println("  Neuro Monitor: ESP8266 MPU6050 Band 1 Node  ");
    Serial.println("  Dual-Band Cross-Alert Sensing Wristband     ");
    Serial.println("==============================================");

    // Overclock to 160 MHz for zero-jitter sampling
    system_update_cpu_freq(160);

    // Initialize U8g2 OLED Display
    u8g2.begin();
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_7x14B_tf);
    u8g2.drawStr(16, 24, "NEURO MONITOR");
    u8g2.setFont(u8g2_font_6x10_tf);
    u8g2.drawStr(20, 44, "Connecting WiFi...");
    u8g2.sendBuffer();

    // Connect to Wi-Fi
    Serial.print("[WIFI] Connecting to ");
    Serial.println(WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.setSleepMode(WIFI_NONE_SLEEP);
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

    // Compute subnet broadcast IP (e.g. 172.24.107.255)
    targetBroadcastIP = WiFi.localIP();
    targetBroadcastIP[3] = 255;

    Serial.print("[STREAM] Target PC IP: ");
    Serial.println(targetPC);
    Serial.print("[STREAM] Broadcast IP: ");
    Serial.println(targetBroadcastIP);

    udp.begin(UDP_PORT);

    // Initialize sensor & calibrate
    initMPU6050();
    calibrateSensor();

    Serial.println("[STREAM] 100 Hz kinematic UDP streaming active!");
    sendHeartbeat(); // Announce Band 1 immediately on boot
    lastHeartbeatMs = millis();
    lastSampleMicros = micros();
    lastOledRefreshMs = millis();
}

// ==========================================
// 7. MAIN LOOP (HIGH-PRECISION 100 Hz TIMING)
// ==========================================
void loop() {
    unsigned long now = millis();

    // Heartbeat transmission every 1000 ms to notify dashboard server that Band 1 is online
    if (now - lastHeartbeatMs >= 1000) {
        lastHeartbeatMs = now;
        sendHeartbeat();
    }

    // 0. Check physical test/panic button (Must be held continuously for > 2000 ms to prevent false triggers from floating pins)
    static unsigned long buttonHoldStart = 0;
    static unsigned long lastPanicSentMs = 0;
    if (now > 5000 && digitalRead(PIN_PANIC_BUTTON) == LOW) {
        if (buttonHoldStart == 0) buttonHoldStart = now;
        if (now - buttonHoldStart >= 2000 && now - lastPanicSentMs >= 1000) {
            Serial.println("[BUTTON] Confirmed 2s panic button hold on Band 1! Broadcasting to Band 2...");
            currentAlertMode = MODE_SEIZURE_ALARM;
            alertStartTime = now;
            disp_status_str = "MANUAL PANIC";
            sendPeerAlert(3, 100);
            buttonHoldStart = 0;
            lastPanicSentMs = now;
        }
    } else {
        buttonHoldStart = 0;
    }

    // 1. Exact 100 Hz sampling timer (10,000 us)
    unsigned long currentMicros = micros();
    if (currentMicros - lastSampleMicros >= SAMPLE_INTERVAL_US) {
        lastSampleMicros += SAMPLE_INTERVAL_US;

        int16_t ax, ay, az, gx, gy, gz;
        readRawMPU(ax, ay, az, gx, gy, gz);

        packetBuffer[frameIndex].timestamp_ms = millis();
        packetBuffer[frameIndex].acc_x        = ax;
        packetBuffer[frameIndex].acc_y        = ay;
        packetBuffer[frameIndex].acc_z        = az;
        packetBuffer[frameIndex].gyro_x       = gx - gx_offset;
        packetBuffer[frameIndex].gyro_y       = gy - gy_offset;
        packetBuffer[frameIndex].gyro_z       = gz - gz_offset;

        // Compute instant acceleration magnitude in g
        float fax = ax / 16384.0f;
        float fay = ay / 16384.0f;
        float faz = az / 16384.0f;
        current_g_mag = sqrt(fax*fax + fay*fay + faz*faz);

        frameIndex++;

        // Once 10 frames are ready, transmit UDP packet (every 100 ms)
        if (frameIndex >= FRAMES_PER_PACKET) {
            // 1. Direct Unicast to your PC IP (172.24.107.41)
            udp.beginPacket(targetPC, UDP_PORT);
            udp.write((const uint8_t*)packetBuffer, sizeof(packetBuffer));
            udp.endPacket();

            // 2. Subnet broadcast to guarantee delivery even if IP changes
            udp.beginPacket(targetBroadcastIP, UDP_PORT);
            udp.write((const uint8_t*)packetBuffer, sizeof(packetBuffer));
            udp.endPacket();

            frameIndex = 0;
            packetSequence++;

            if (packetSequence % 50 == 0) {
                Serial.print("[STREAM] Packets sent: ");
                Serial.print(packetSequence);
                Serial.print(" | Target: ");
                Serial.println(targetPC);
            }
        }
    }

    // 2. Process incoming UDP packets (Peer alerts from Band 2 + ML telemetry from host)
    checkIncomingPackets();

    // 3. Update Buzzer & LED non-blocking alert state machine
    updateAlerts();

    // 4. Update U8g2 OLED Display outside the 100 Hz timing loop
    now = millis();
    if (now - lastOledRefreshMs >= OLED_REFRESH_MS) {
        lastOledRefreshMs = now;
        renderOLED();
    }

    yield();
}
