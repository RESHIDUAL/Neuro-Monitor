"""
esp8266_receiver.py
Real-Time Kinematic UDP Receiver & Dual-Engine TFLite Inference Host
With Closed-Loop U8g2 OLED Telemetry & Buzzer/LED Alerts
---------------------------------------------------------------------
Receives 100 Hz 6-axis binary UDP packets from the ESP8266 + MPU6050 wristband,
applies verified clinical digital preprocessing, runs both Tremor and Seizure
TensorFlow Lite models, and sends closed-loop 5-byte telemetry feedback packets
back to the wristband to update its U8g2 OLED Display, Buzzer, and LED in real time!
"""

import os
import sys
import time
import socket
import struct
import json
import numpy as np
from scipy import signal

# Suppress TF info logs
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
import tensorflow as tf

# ==========================================
# 1. CONFIGURATION & NETWORK
# ==========================================
UDP_HOST = "0.0.0.0"       # Listen on all local network interfaces
UDP_PORT = 8888            # Must match UDP_PORT in esp8266_mpu6050_band.ino
WINDOW_SIZE = 300          # 3.0 seconds at 100 Hz
WINDOW_STRIDE = 100        # Slide every 1.0 second (100 samples)
SAMPLE_RATE = 100          # 100 Hz native wristband rate

# Conversion factors
ACCEL_SCALE = 1.0 / 16384.0            # LSB to g (+/- 2g range)
GYRO_SCALE  = (1.0 / 131.0) * (np.pi / 180.0) # LSB to deg/s to rad/s

# Global Standard Deviation Scaling Factors from preprocess_config.json
GLOBAL_STD = np.array([0.281, 0.312, 0.345, 0.890, 0.940, 1.020], dtype=np.float32)

# ==========================================
# 2. LOAD DEPLOYED TFLITE MODELS
# ==========================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, "..", ".."))

TREMOR_MODEL_PATH = os.path.join(PROJECT_ROOT, "overall context", "models", "Strided_Conv1D_BiLSTM.tflite")
SEIZURE_MODEL_PATH = os.path.join(PROJECT_ROOT, "overall context", "models", "Seizure_Conv1D_BiLSTM.tflite")

if not os.path.exists(TREMOR_MODEL_PATH):
    TREMOR_MODEL_PATH = os.path.join(PROJECT_ROOT, "results", "models", "Strided_Conv1D_BiLSTM.tflite")
if not os.path.exists(SEIZURE_MODEL_PATH):
    SEIZURE_MODEL_PATH = os.path.join(PROJECT_ROOT, "results", "models", "Seizure_Conv1D_BiLSTM.tflite")

print(f"[MODEL] Loading Tremor Model:  {TREMOR_MODEL_PATH}")
tremor_interp = tf.lite.Interpreter(model_path=TREMOR_MODEL_PATH)
tremor_interp.allocate_tensors()
tremor_in_idx  = tremor_interp.get_input_details()[0]["index"]
tremor_out_idx = tremor_interp.get_output_details()[0]["index"]

print(f"[MODEL] Loading Seizure Model: {SEIZURE_MODEL_PATH}")
seizure_interp = tf.lite.Interpreter(model_path=SEIZURE_MODEL_PATH)
seizure_interp.allocate_tensors()
seizure_in_idx  = seizure_interp.get_input_details()[0]["index"]
seizure_out_idx = seizure_interp.get_output_details()[0]["index"]

# Design Butterworth Bandpass Filter (0.5 to 20.0 Hz at 100 Hz)
sos_tremor = signal.butter(4, [0.5, 20.0], btype="bandpass", fs=100.0, output="sos")

# Design Butterworth Bandpass Filter for Seizure (3.0 to 7.5 Hz at 16 Hz)
sos_seizure = signal.butter(4, [3.0, 7.5], btype="bandpass", fs=16.0, output="sos")

# ==========================================
# 3. REAL-TIME SIGNAL PROCESSING PIPELINE
# ==========================================
def preprocess_tremor_window(raw_win):
    demeaned = raw_win - np.mean(raw_win, axis=0, keepdims=True)
    filtered = signal.sosfiltfilt(sos_tremor, demeaned, axis=0)
    normed = filtered / GLOBAL_STD
    return np.expand_dims(normed.astype(np.float32), axis=0)

def preprocess_seizure_window(raw_win):
    accel = raw_win[:, :3]
    resampled_accel = signal.resample_poly(accel, up=4, down=25, axis=0)
    demeaned = resampled_accel - np.mean(resampled_accel, axis=0, keepdims=True)
    filtered = signal.sosfiltfilt(sos_seizure, demeaned, axis=0)
    normed = filtered / 0.428
    return np.expand_dims(normed[:48].astype(np.float32), axis=0)

def draw_bar(val, width=20):
    filled = int(round(val * width))
    return "[" + "#" * filled + " " * (width - filled) + "]"

# ==========================================
# 4. MAIN UDP RECEIVER & FEEDBACK LOOP
# ==========================================
def start_receiver():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.bind((UDP_HOST, UDP_PORT))
    
    print("\n" + "="*75)
    print("  Neuro Monitor: Real-Time ESP8266 MPU6050 + U8g2 OLED Receiver")
    print("  [With Closed-Loop OLED Display & Buzzer/LED Alerts]")
    print(f"  Listening on UDP {UDP_HOST}:{UDP_PORT} ...")
    print("  Press Ctrl+C to terminate.")
    print("="*75 + "\n")
    
    window_buffer = [] # Holds rolling samples of shape (6,)
    sample_count = 0
    active_bands = set() # Dynamically tracks all active ESP8266 band IP addresses
    
    FRAME_STRUCT = struct.Struct("<Ihhhhhh") # timestamp_ms (4B), 6 x int16 (12B) = 16B
    FRAME_SIZE = FRAME_STRUCT.size # 16 bytes
    
    # 8-byte Direct Peer Alert Packet: magic(1B), sender_id(1B), alert_code(1B), severity(1B), ts(4B)
    PEER_ALERT_STRUCT = struct.Struct("<BBBBI")

    # 5-byte Downlink Telemetry Packet: alert_code, p_norm, p_pd, p_et, p_seiz (all uint8)
    FEEDBACK_STRUCT = struct.Struct("<BBBBB")
    
    try:
        while True:
            data, addr = sock.recvfrom(2048)
            active_bands.add(addr[0])

            # Check if this is a Cross-Band Peer Alert Packet (8 bytes)
            if len(data) == PEER_ALERT_STRUCT.size:
                magic, sender_id, alert_code, severity, ts = PEER_ALERT_STRUCT.unpack(data)
                if magic == 0xAA:
                    labels = {0: "CLEAR", 1: "PARKINSONS", 2: "ESSENTIAL TREMOR", 3: "SEIZURE EMERGENCY"}
                    lbl = labels.get(alert_code, f"CODE_{alert_code}")
                    print(f"\n[PEER CROSS-ALERT] >>> Band {sender_id} triggered {lbl} (Severity: {severity}%) <<<")
                    print(f"  Forwarding alert broadcast to all bands on subnet...")
                    # Re-broadcast to all bands to guarantee delivery
                    try:
                        sock.sendto(data, ('<broadcast>', UDP_PORT))
                        parts = addr[0].split('.')
                        if len(parts) == 4:
                            sock.sendto(data, (f"{parts[0]}.{parts[1]}.{parts[2]}.255", UDP_PORT))
                    except Exception:
                        pass
                    continue
            
            num_frames = len(data) // FRAME_SIZE
            if num_frames == 0:
                continue
            
            for i in range(num_frames):
                raw_frame = data[i * FRAME_SIZE : (i + 1) * FRAME_SIZE]
                t_ms, ax_raw, ay_raw, az_raw, gx_raw, gy_raw, gz_raw = FRAME_STRUCT.unpack(raw_frame)
                
                ax = ax_raw * ACCEL_SCALE
                ay = ay_raw * ACCEL_SCALE
                az = az_raw * ACCEL_SCALE
                gx = gx_raw * GYRO_SCALE
                gy = gy_raw * GYRO_SCALE
                gz = gz_raw * GYRO_SCALE
                
                window_buffer.append([ax, ay, az, gx, gy, gz])
                sample_count += 1
            
            # When we have accumulated 300 samples (3.0 seconds)
            if len(window_buffer) >= WINDOW_SIZE:
                cur_win = np.array(window_buffer[:WINDOW_SIZE], dtype=np.float32)
                window_buffer = window_buffer[WINDOW_STRIDE:]
                
                # 1. Run Track 1 (Tremor Engine: Healthy Normal vs PD vs ET)
                t_start = time.perf_counter()
                tremor_input = preprocess_tremor_window(cur_win)
                tremor_interp.set_tensor(tremor_in_idx, tremor_input)
                tremor_interp.invoke()
                tremor_probs = tremor_interp.get_tensor(tremor_out_idx)[0] # [P_Norm, P_PD, P_ET]
                
                # 2. Run Track 2 (Seizure Engine: Non-Seizure vs Seizure)
                seizure_input = preprocess_seizure_window(cur_win)
                seizure_interp.set_tensor(seizure_in_idx, seizure_input)
                seizure_interp.invoke()
                seizure_probs = seizure_interp.get_tensor(seizure_out_idx)[0] # [P_NonSeiz, P_Seiz]
                lat_ms = (time.perf_counter() - t_start) * 1000.0
                
                p_norm = float(tremor_probs[0])
                p_pd   = float(tremor_probs[1])
                p_et   = float(tremor_probs[2])
                p_seiz = float(seizure_probs[1])
                
                # Determine Classification & Alert Code
                # 0 = Normal, 1 = PD, 2 = ET, 3 = Seizure
                alert_code = 0
                alert_status_str = "Normal Resting Motion"
                
                if p_seiz > 0.50:
                    alert_code = 3 # Seizure Emergency
                    alert_status_str = ">>> [!] SEIZURE EMERGENCY ALARM (OLED Flashing + Buzzer Siren) <<<"
                elif p_pd > 0.65:
                    alert_code = 1 # Parkinson's Tremor
                    alert_status_str = "Parkinson's Tremor (OLED: PARKINSON'S + Double-Blink)"
                elif p_et > 0.55:
                    alert_code = 2 # Essential Tremor
                    alert_status_str = "Essential Tremor (OLED: ESSENTIAL TREMOR + Triple-Blink)"
                else:
                    alert_code = 0 # Normal
                
                # Pack 5-byte Downlink Telemetry for the wristband OLED & Actuators
                # Percentages clipped to 0-100 integer
                b_norm = int(np.clip(round(p_norm * 100.0), 0, 100))
                b_pd   = int(np.clip(round(p_pd   * 100.0), 0, 100))
                b_et   = int(np.clip(round(p_et   * 100.0), 0, 100))
                b_seiz = int(np.clip(round(p_seiz * 100.0), 0, 100))
                
                telemetry_bytes = FEEDBACK_STRUCT.pack(alert_code, b_norm, b_pd, b_et, b_seiz)
                
                # Send feedback over UDP to ALL connected bands and subnet broadcast
                for band_ip in list(active_bands):
                    try:
                        sock.sendto(telemetry_bytes, (band_ip, UDP_PORT))
                    except Exception:
                        pass
                
                try:
                    sock.sendto(telemetry_bytes, ('<broadcast>', UDP_PORT))
                    if len(active_bands) > 0:
                        first_ip = list(active_bands)[0]
                        parts = first_ip.split('.')
                        if len(parts) == 4:
                            sock.sendto(telemetry_bytes, (f"{parts[0]}.{parts[1]}.{parts[2]}.255", UDP_PORT))
                except Exception:
                    pass
                
                # Display Live Terminal Diagnostics
                tremor_labels = ["HEALTHY NORMAL", "PARKINSON'S (PD)", "ESSENTIAL TREMOR (ET)"]
                tremor_pred_str = tremor_labels[np.argmax(tremor_probs)]
                
                print(f"\n--- [T={sample_count/100.0:6.1f}s | Latency: {lat_ms:4.2f}ms] ---")
                print(f"  Normal:   {draw_bar(p_norm)} {p_norm*100:5.1f}%")
                print(f"  PD:       {draw_bar(p_pd)} {p_pd*100:5.1f}%")
                print(f"  ET:       {draw_bar(p_et)} {p_et*100:5.1f}%")
                print(f"  Seizure:  {draw_bar(p_seiz)} {p_seiz*100:5.1f}%")
                print(f"  Classification: Pattern consistent with {tremor_pred_str}")
                print(f"  OLED Telemetry: Sent to band -> {alert_status_str}")
                
    except KeyboardInterrupt:
        print("\n[STOP] Receiver terminated by user.")
    finally:
        sock.close()

if __name__ == "__main__":
    start_receiver()
