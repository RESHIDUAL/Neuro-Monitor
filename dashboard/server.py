"""
Neuro Monitor: Real-Time Clinical Server and Patient Telemetry Dashboard
Hosts the Clinical Telemetry Dashboard and runs the 100 Hz UDP receiver for ESP8266 bands.
Strictly: No emdashes, no emojis.
"""

import os
import sys
import time
import json
import socket
import struct
import asyncio
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
import threading
from datetime import datetime
import csv
import io

import numpy as np
from scipy import signal
import sqlite3

# Suppress TF logs
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
import tensorflow as tf

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Response, Body, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional
import uvicorn

from db import get_db, init_db

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, ".."))
STATIC_DIR = os.path.join(BASE_DIR, "static")

# Network and Model config
UDP_HOST = "0.0.0.0"
UDP_PORT = 8888
WINDOW_SIZE = 300
WINDOW_STRIDE = 100

ACCEL_SCALE = 1.0 / 16384.0
GYRO_SCALE = (1.0 / 131.0) * (np.pi / 180.0)
GLOBAL_STD = np.array([0.281, 0.312, 0.345, 0.890, 0.940, 1.020], dtype=np.float32)

# Load TFLite models
TREMOR_PATH = os.path.join(PROJECT_ROOT, "results", "models", "Strided_Conv1D_BiLSTM.tflite")
SEIZURE_PATH = os.path.join(PROJECT_ROOT, "results", "models", "Seizure_Conv1D_BiLSTM.tflite")

if not os.path.exists(TREMOR_PATH):
    TREMOR_PATH = os.path.join(PROJECT_ROOT, "overall context", "models", "Strided_Conv1D_BiLSTM.tflite")
if not os.path.exists(SEIZURE_PATH):
    SEIZURE_PATH = os.path.join(PROJECT_ROOT, "overall context", "models", "Seizure_Conv1D_BiLSTM.tflite")

tremor_interp = tf.lite.Interpreter(model_path=TREMOR_PATH)
tremor_interp.allocate_tensors()
tremor_in_idx = tremor_interp.get_input_details()[0]["index"]
tremor_out_idx = tremor_interp.get_output_details()[0]["index"]

seizure_interp = tf.lite.Interpreter(model_path=SEIZURE_PATH)
seizure_interp.allocate_tensors()
seizure_in_idx = seizure_interp.get_input_details()[0]["index"]
seizure_out_idx = seizure_interp.get_output_details()[0]["index"]

sos_tremor = signal.butter(4, [0.5, 20.0], btype="bandpass", fs=100.0, output="sos")
sos_seizure = signal.butter(4, [3.0, 7.5], btype="bandpass", fs=16.0, output="sos")

def preprocess_tremor(raw_win):
    demeaned = raw_win - np.mean(raw_win, axis=0, keepdims=True)
    filtered = signal.sosfiltfilt(sos_tremor, demeaned, axis=0)
    normed = filtered / GLOBAL_STD
    return np.expand_dims(normed.astype(np.float32), axis=0)

def preprocess_seizure(raw_win):
    accel = raw_win[:, :3]
    resampled = signal.resample_poly(accel, up=4, down=25, axis=0)
    demeaned = resampled - np.mean(resampled, axis=0, keepdims=True)
    filtered = signal.sosfiltfilt(sos_seizure, demeaned, axis=0)
    normed = filtered / 0.428
    return np.expand_dims(normed[:48].astype(np.float32), axis=0)

# Global Telemetry State
class TelemetryManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.active_bands = {} # Dict of {ip: last_seen_timestamp}
        self.connected_sockets = set()
        self.last_kinematics = {
            "ax": 0.0, "ay": 0.0, "az": 0.0,
            "gx": 0.0, "gy": 0.0, "gz": 0.0,
            "mag": 0.0, "freq": 0.0
        }
        self.last_probs = {
            "p_norm": 0.0, "p_pd": 0.0, "p_et": 0.0, "p_seiz": 0.0,
            "classification": "Waiting for Wristband",
            "alert_code": 0
        }
        self.bands_info = {
            1: {"id": 1, "role": "Patient Primary Band (IMU)", "ip": None, "rssi": None, "battery": 100, "uptime_ms": 0, "last_seen": 0, "packets": 0},
            2: {"id": 2, "role": "Caregiver Alert Band (Receiver)", "ip": None, "rssi": None, "battery": 100, "uptime_ms": 0, "last_seen": 0, "packets": 0}
        }
        self.recent_waveform = []
        self.packet_count = 0
        self.last_packet_time = 0.0
        self.udp_sock = None
        self.simulator_running = False # Strictly False by default

telemetry = TelemetryManager()

app = FastAPI(title="Neuro Monitor Clinical Server")

# Pydantic Schemas for Patient Management
class PatientCreate(BaseModel):
    name: str
    age: str
    gender: str
    band_id: Optional[int] = 0
    condition: str
    symptoms: Optional[str] = ""
    observation: Optional[str] = ""
    prescription: Optional[str] = ""

class PatientUpdate(BaseModel):
    name: Optional[str] = None
    age: Optional[str] = None
    gender: Optional[str] = None
    band_id: Optional[int] = None
    condition: Optional[str] = None
    symptoms: Optional[str] = None
    observation: Optional[str] = None
    prescription: Optional[str] = None

class CalendarEventCreate(BaseModel):
    patient_id: Optional[int] = None
    event_date: str # YYYY-MM-DD
    event_time: str # HH:MM
    title: str
    location: Optional[str] = ""
    notes: Optional[str] = ""

# UDP Worker Thread
def udp_worker():
    FRAME_STRUCT = struct.Struct("<Ihhhhhh")
    FRAME_SIZE = FRAME_STRUCT.size
    PEER_ALERT_STRUCT = struct.Struct("<BBBBI")
    FEEDBACK_STRUCT = struct.Struct("<BBBBB")
    HEARTBEAT_STRUCT = struct.Struct("<BBBBbIH") # 11 bytes: magic, band_id, role, battery, rssi, uptime, seq

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.bind((UDP_HOST, UDP_PORT))
    telemetry.udp_sock = sock

    print(f"[UDP] Server listening for wristband packets on port {UDP_PORT}...")

    window_buffer = []
    last_peer_alert_time = 0

    while True:
        try:
            data, addr = sock.recvfrom(2048)
            now_t = time.time()
            band_ip = addr[0]

            with telemetry.lock:
                telemetry.active_bands[band_ip] = now_t
                telemetry.last_packet_time = now_t
                telemetry.packet_count += 1

            # Check if this is an 11-byte Heartbeat / Identification packet from Band 1 or Band 2
            if len(data) == HEARTBEAT_STRUCT.size:
                magic, b_id, role, b_pct, rssi, up_ms, seq = HEARTBEAT_STRUCT.unpack(data)
                if magic == 0xBB:
                    role_str = "Patient Primary Band (IMU)" if b_id == 1 else "Caregiver Alert Band (Receiver)"
                    with telemetry.lock:
                        telemetry.bands_info[b_id] = {
                            "id": b_id,
                            "role": role_str,
                            "ip": band_ip,
                            "rssi": int(rssi),
                            "battery": int(b_pct),
                            "uptime_ms": int(up_ms),
                            "last_seen": now_t,
                            "packets": telemetry.bands_info.get(b_id, {}).get("packets", 0) + 1
                        }
                    continue

            # Check if this is an 8-byte Cross-Band Peer Alert Packet
            if len(data) == PEER_ALERT_STRUCT.size:
                magic, sender_id, alert_code, severity, ts = PEER_ALERT_STRUCT.unpack(data)
                if magic == 0xAA:
                    # Rate-limit peer alerts to at most once every 3.5s to prevent feedback storms
                    if now_t - last_peer_alert_time < 3.5:
                        continue
                    last_peer_alert_time = now_t

                    labels = {0: "CLEAR", 1: "PARKINSONS", 2: "ESSENTIAL TREMOR", 3: "SEIZURE EMERGENCY"}
                    lbl = labels.get(alert_code, f"CODE_{alert_code}")
                    print(f"[UDP CROSS-ALERT] Band {sender_id} sent {lbl} ({severity}%)")

                    # Log to database
                    conn = get_db()
                    cur = conn.cursor()
                    cur.execute("""
                    INSERT INTO alert_events (patient_id, band_id, timestamp, alert_type, severity, source, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (
                        sender_id,
                        sender_id,
                        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        lbl,
                        severity,
                        f"Band {sender_id} Peer Broadcast",
                        f"Triggered from wristband hardware. Severity score: {severity}%"
                    ))
                    conn.commit()
                    conn.close()

                    # Re-broadcast to all bands on subnet
                    try:
                        sock.sendto(data, ('<broadcast>', UDP_PORT))
                    except Exception:
                        pass
                    continue

            num_frames = len(data) // FRAME_SIZE
            if num_frames == 0:
                continue

            last_ax, last_ay, last_az = 0.0, 0.0, 1.0
            last_gx, last_gy, last_gz = 0.0, 0.0, 0.0

            for i in range(num_frames):
                raw_frame = data[i * FRAME_SIZE : (i + 1) * FRAME_SIZE]
                t_ms, ax_raw, ay_raw, az_raw, gx_raw, gy_raw, gz_raw = FRAME_STRUCT.unpack(raw_frame)
                ax = ax_raw * ACCEL_SCALE
                ay = ay_raw * ACCEL_SCALE
                az = az_raw * ACCEL_SCALE
                gx = gx_raw * GYRO_SCALE
                gy = gy_raw * GYRO_SCALE
                gz = gz_raw * GYRO_SCALE

                last_ax, last_ay, last_az = ax, ay, az
                last_gx, last_gy, last_gz = gx, gy, gz
                window_buffer.append([ax, ay, az, gx, gy, gz])

            mag = np.sqrt(last_ax**2 + last_ay**2 + last_az**2)

            with telemetry.lock:
                telemetry.last_kinematics = {
                    "ax": round(last_ax, 3), "ay": round(last_ay, 3), "az": round(last_az, 3),
                    "gx": round(last_gx, 3), "gy": round(last_gy, 3), "gz": round(last_gz, 3),
                    "mag": round(float(mag), 3), "freq": 1.2
                }
                telemetry.recent_waveform.append([round(last_ax, 2), round(last_ay, 2), round(last_az, 2), round(float(mag), 2)])
                if len(telemetry.recent_waveform) > 100:
                    telemetry.recent_waveform.pop(0)

            # Once 300 samples have arrived, run dual TFLite inference
            if len(window_buffer) >= WINDOW_SIZE:
                cur_win = np.array(window_buffer[:WINDOW_SIZE], dtype=np.float32)
                window_buffer = window_buffer[WINDOW_STRIDE:]

                t_input = preprocess_tremor(cur_win)
                tremor_interp.set_tensor(tremor_in_idx, t_input)
                tremor_interp.invoke()
                tremor_probs = tremor_interp.get_tensor(tremor_out_idx)[0]

                s_input = preprocess_seizure(cur_win)
                seizure_interp.set_tensor(seizure_in_idx, s_input)
                seizure_interp.invoke()
                seizure_probs = seizure_interp.get_tensor(seizure_out_idx)[0]

                p_norm = float(tremor_probs[0])
                p_pd   = float(tremor_probs[1])
                p_et   = float(tremor_probs[2])
                p_seiz = float(seizure_probs[1])

                alert_code = 0
                class_str = "Healthy Normal"

                if p_seiz > 0.50:
                    alert_code = 3
                    class_str = "Seizure Emergency"
                elif p_pd > 0.65:
                    alert_code = 1
                    class_str = "Parkinson Tremor"
                elif p_et > 0.55:
                    alert_code = 2
                    class_str = "Essential Tremor"

                m_series = np.sqrt(cur_win[:, 0]**2 + cur_win[:, 1]**2 + cur_win[:, 2]**2)
                fft_vals = np.abs(np.fft.rfft(m_series - np.mean(m_series)))
                freqs = np.fft.rfftfreq(len(m_series), d=0.01)
                dom_freq = float(freqs[np.argmax(fft_vals[1:]) + 1]) if len(fft_vals) > 1 else 1.0

                with telemetry.lock:
                    telemetry.last_probs = {
                        "p_norm": round(p_norm, 3), "p_pd": round(p_pd, 3),
                        "p_et": round(p_et, 3), "p_seiz": round(p_seiz, 3),
                        "classification": class_str, "alert_code": alert_code
                    }
                    telemetry.last_kinematics["freq"] = round(dom_freq, 2)

                # Broadcast feedback back to all bands over UDP
                b_norm = int(np.clip(round(p_norm * 100.0), 0, 100))
                b_pd   = int(np.clip(round(p_pd   * 100.0), 0, 100))
                b_et   = int(np.clip(round(p_et   * 100.0), 0, 100))
                b_seiz = int(np.clip(round(p_seiz * 100.0), 0, 100))
                fb_bytes = FEEDBACK_STRUCT.pack(alert_code, b_norm, b_pd, b_et, b_seiz)

                try:
                    sock.sendto(fb_bytes, ('<broadcast>', UDP_PORT))
                    for b_ip in list(telemetry.active_bands.keys()):
                        sock.sendto(fb_bytes, (b_ip, UDP_PORT))
                except Exception:
                    pass

                # Save periodic log to database
                conn = get_db()
                cur = conn.cursor()
                cur.execute("""
                INSERT INTO telemetry_logs (
                    patient_id, band_id, timestamp, acc_x, acc_y, acc_z, acc_mag,
                    freq_hz, p_norm, p_pd, p_et, p_seiz, classification, alert_code
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    1, 1, datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    last_ax, last_ay, last_az, mag, dom_freq,
                    p_norm, p_pd, p_et, p_seiz, class_str, alert_code
                ))

                if alert_code > 0:
                    cur.execute("""
                    INSERT INTO alert_events (patient_id, band_id, timestamp, alert_type, severity, source, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (
                        1, 1, datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        class_str.upper(), int(max(p_pd, p_et, p_seiz) * 100),
                        "AI BiLSTM Dual-Engine", f"Dominant frequency: {dom_freq:.1f} Hz. Automated wristband alert dispatched."
                    ))

                conn.commit()
                conn.close()

        except Exception as e:
            time.sleep(0.01)

# Simulator Thread: ONLY runs when explicitly enabled
def simulator_worker():
    t_idx = 0
    while True:
        with telemetry.lock:
            sim_enabled = telemetry.simulator_running

        if sim_enabled:
            t_idx += 1
            is_tremor = (t_idx % 60) > 40
            base_freq = 4.8 if is_tremor else 1.2
            t = time.time()
            ax = 0.25 * np.sin(2 * np.pi * base_freq * t) + np.random.normal(0, 0.02)
            ay = 0.15 * np.cos(2 * np.pi * base_freq * t) + np.random.normal(0, 0.02)
            az = 0.98 + (0.35 if is_tremor else 0.0) * np.sin(2 * np.pi * base_freq * t + 0.4)
            mag = np.sqrt(ax**2 + ay**2 + az**2)

            if is_tremor:
                p_norm, p_pd, p_et, p_seiz = 0.16, 0.78, 0.05, 0.01
                cls_name = "Parkinson Tremor"
                alert_code = 1
            else:
                p_norm, p_pd, p_et, p_seiz = 0.94, 0.03, 0.02, 0.00
                cls_name = "Healthy Normal"
                alert_code = 0

            with telemetry.lock:
                telemetry.last_kinematics = {
                    "ax": round(float(ax), 3), "ay": round(float(ay), 3), "az": round(float(az), 3),
                    "gx": round(float(np.random.normal(0, 0.05)), 3),
                    "gy": round(float(np.random.normal(0, 0.05)), 3),
                    "gz": round(float(np.random.normal(0, 0.05)), 3),
                    "mag": round(float(mag), 3), "freq": round(base_freq, 2)
                }
                telemetry.last_probs = {
                    "p_norm": p_norm, "p_pd": p_pd, "p_et": p_et, "p_seiz": p_seiz,
                    "classification": cls_name, "alert_code": alert_code
                }
                telemetry.recent_waveform.append([round(float(ax), 2), round(float(ay), 2), round(float(az), 2), round(float(mag), 2)])
                if len(telemetry.recent_waveform) > 100:
                    telemetry.recent_waveform.pop(0)

        time.sleep(0.1)

@app.on_event("startup")
def startup_event():
    init_db(clean_slate=False)
    t_udp = threading.Thread(target=udp_worker, daemon=True)
    t_udp.start()
    t_sim = threading.Thread(target=simulator_worker, daemon=True)
    t_sim.start()
    print("[SERVER] Telemetry and UDP server started.")

os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/", response_class=HTMLResponse)
def get_dashboard_html():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h1>Dashboard HTML loading...</h1>")

# REST Endpoints
@app.get("/api/status")
def get_system_status():
    now_t = time.time()
    with telemetry.lock:
        active_b = [ip for ip, last_t in telemetry.active_bands.items() if now_t - last_t < 4.0]
        is_live = (len(active_b) > 0) or telemetry.simulator_running
        pkt_count = telemetry.packet_count
        last_kin = dict(telemetry.last_kinematics)
        last_pr = dict(telemetry.last_probs)

    # True hardware status reporting
    if is_live:
        status_text = "ONLINE"
        band1_connected = True
        band2_connected = len(active_b) > 1
    else:
        status_text = "WAITING FOR BAND"
        band1_connected = False
        band2_connected = False
        last_kin = {"ax": 0.0, "ay": 0.0, "az": 0.0, "gx": 0.0, "gy": 0.0, "gz": 0.0, "mag": 0.0, "freq": 0.0}
        last_pr = {"p_norm": 0.0, "p_pd": 0.0, "p_et": 0.0, "p_seiz": 0.0, "classification": "No Band Connected", "alert_code": 0}

    return {
        "status": status_text,
        "udp_port": UDP_PORT,
        "active_bands_count": len(active_b) if not telemetry.simulator_running else 1,
        "active_band_ips": active_b,
        "band1_connected": band1_connected,
        "band2_connected": band2_connected,
        "streaming_active": is_live,
        "packet_count": pkt_count,
        "simulator_running": telemetry.simulator_running,
        "models": {
            "tremor_model": "Strided_Conv1D_BiLSTM.tflite",
            "seizure_model": "Seizure_Conv1D_BiLSTM.tflite"
        },
        "telemetry": last_kin,
        "classification": last_pr
    }

@app.get("/api/bands-status")
def get_bands_status():
    now_t = time.time()
    res = {}
    with telemetry.lock:
        sim = telemetry.simulator_running
        for b_id in [1, 2]:
            info = telemetry.bands_info.get(b_id, {})
            last_s = info.get("last_seen", 0)
            is_online = (now_t - last_s < 3.5) or (sim and b_id == 1)

            res[f"band{b_id}"] = {
                "id": b_id,
                "name": f"Wristband {b_id}",
                "role": "Patient Primary Band (IMU)" if b_id == 1 else "Caregiver Alert Band (Receiver)",
                "online": is_online,
                "status": "ONLINE" if is_online else "OFFLINE",
                "ip": info.get("ip") if is_online else (("127.0.0.1 (Simulated)" if sim and b_id == 1 else "Not Connected")),
                "rssi": info.get("rssi") if is_online else ((-52 if sim and b_id == 1 else None)),
                "battery": info.get("battery", 100),
                "last_seen_sec": round(now_t - last_s, 1) if (last_s > 0 and not sim) else (0.1 if is_online else None),
                "packets": info.get("packets", 0)
            }
        res["server_udp_port"] = UDP_PORT
        res["active_bands_total"] = (1 if res["band1"]["online"] else 0) + (1 if res["band2"]["online"] else 0)
        res["server_timestamp"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return res

@app.post("/api/ping-band")
def ping_band(band_id: int = Query(1)):
    # Sends a single chirp notification packet (alert_code=1 for short pulse)
    FEEDBACK_STRUCT = struct.Struct("<BBBBB")
    chirp_bytes = FEEDBACK_STRUCT.pack(1, 100, 0, 0, 0) # code 1 = chirp pulse

    if telemetry.udp_sock:
        try:
            target_ip = None
            with telemetry.lock:
                if band_id in telemetry.bands_info and telemetry.bands_info[band_id].get("ip"):
                    target_ip = telemetry.bands_info[band_id]["ip"]

            if target_ip and target_ip != "None" and "Simulated" not in target_ip:
                telemetry.udp_sock.sendto(chirp_bytes, (target_ip, UDP_PORT))
            else:
                telemetry.udp_sock.sendto(chirp_bytes, ('<broadcast>', UDP_PORT))
        except Exception as e:
            return {"status": "error", "message": str(e)}

    return {"status": "success", "pinged_band": band_id}

# PATIENT MANAGEMENT ENDPOINTS
@app.get("/api/patients")
def get_patients():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM patients ORDER BY id DESC")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

@app.post("/api/patients")
def create_patient(payload: PatientCreate):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
    INSERT INTO patients (name, age, gender, band_id, condition, symptoms, observation, prescription)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        payload.name.strip(),
        payload.age.strip(),
        payload.gender.strip(),
        payload.band_id,
        payload.condition.strip(),
        payload.symptoms.strip() if payload.symptoms else "",
        payload.observation.strip() if payload.observation else "",
        payload.prescription.strip() if payload.prescription else ""
    ))
    patient_id = cur.lastrowid
    conn.commit()

    cur.execute("SELECT * FROM patients WHERE id = ?", (patient_id,))
    new_patient = dict(cur.fetchone())
    conn.close()
    return new_patient

@app.put("/api/patients/{patient_id}")
def update_patient(patient_id: int, payload: PatientUpdate):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM patients WHERE id = ?", (patient_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Patient not found")

    fields = []
    values = []
    for k, v in payload.dict(exclude_unset=True).items():
        if v is not None:
            fields.append(f"{k} = ?")
            values.append(v)

    if fields:
        values.append(patient_id)
        cur.execute(f"UPDATE patients SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()

    cur.execute("SELECT * FROM patients WHERE id = ?", (patient_id,))
    updated = dict(cur.fetchone())
    conn.close()
    return updated

@app.delete("/api/patients/{patient_id}")
def delete_patient(patient_id: int):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM calendar_events WHERE patient_id = ?", (patient_id,))
    cur.execute("DELETE FROM telemetry_logs WHERE patient_id = ?", (patient_id,))
    cur.execute("DELETE FROM alert_events WHERE patient_id = ?", (patient_id,))
    cur.execute("DELETE FROM patients WHERE id = ?", (patient_id,))
    conn.commit()
    conn.close()
    return {"status": "success", "deleted_id": patient_id}

@app.get("/api/patients/{patient_id}/logs")
def get_patient_logs(patient_id: int, limit: int = 50):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
    SELECT * FROM telemetry_logs
    WHERE patient_id = ?
    ORDER BY id DESC LIMIT ?
    """, (patient_id, limit))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

@app.get("/api/logs")
def get_all_logs(
    patient_id: int = Query(None),
    band_id: int = Query(None),
    condition: str = Query(None),
    limit: int = 100,
    offset: int = 0
):
    conn = get_db()
    cur = conn.cursor()
    query = "SELECT l.*, p.name as patient_name FROM telemetry_logs l LEFT JOIN patients p ON l.patient_id = p.id WHERE 1=1"
    params = []

    if patient_id is not None:
        query += " AND l.patient_id = ?"
        params.append(patient_id)
    if band_id is not None:
        query += " AND l.band_id = ?"
        params.append(band_id)
    if condition:
        query += " AND l.classification LIKE ?"
        params.append(f"%{condition}%")

    query += " ORDER BY l.id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    cur.execute(query, params)
    rows = [dict(r) for r in cur.fetchall()]

    cur.execute("SELECT COUNT(*) FROM telemetry_logs")
    total_count = cur.fetchone()[0]
    conn.close()
    return {"total": total_count, "items": rows}

@app.get("/api/logs/export")
def export_logs_csv(patient_id: int = Query(None)):
    conn = get_db()
    cur = conn.cursor()

    if patient_id:
        cur.execute("""
        SELECT l.id, p.name, l.band_id, l.timestamp, l.acc_x, l.acc_y, l.acc_z, l.acc_mag,
               l.freq_hz, l.p_norm, l.p_pd, l.p_et, l.p_seiz, l.classification, l.alert_code
        FROM telemetry_logs l
        LEFT JOIN patients p ON l.patient_id = p.id
        WHERE l.patient_id = ?
        ORDER BY l.id DESC
        """, (patient_id,))
    else:
        cur.execute("""
        SELECT l.id, p.name, l.band_id, l.timestamp, l.acc_x, l.acc_y, l.acc_z, l.acc_mag,
               l.freq_hz, l.p_norm, l.p_pd, l.p_et, l.p_seiz, l.classification, l.alert_code
        FROM telemetry_logs l
        LEFT JOIN patients p ON l.patient_id = p.id
        ORDER BY l.id DESC LIMIT 1000
        """)

    rows = cur.fetchall()
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Record ID", "Wearer Name", "Band ID", "Timestamp",
        "Accel X (g)", "Accel Y (g)", "Accel Z (g)", "Accel Magnitude (g)",
        "Dominant Freq (Hz)", "Prob Normal", "Prob Parkinson", "Prob Essential Tremor", "Prob Seizure",
        "Clinical Pattern", "Alert Code"
    ])

    for r in rows:
        writer.writerow(list(r))

    output.seek(0)
    filename = f"neuro_monitor_wearer_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# CALENDAR MANAGEMENT ENDPOINTS
@app.get("/api/calendar-events")
def get_calendar_events(date: Optional[str] = None):
    conn = get_db()
    cur = conn.cursor()
    if date:
        cur.execute("""
        SELECT c.*, p.name as patient_name
        FROM calendar_events c
        LEFT JOIN patients p ON c.patient_id = p.id
        WHERE c.event_date = ?
        ORDER BY c.event_time ASC
        """, (date,))
    else:
        cur.execute("""
        SELECT c.*, p.name as patient_name
        FROM calendar_events c
        LEFT JOIN patients p ON c.patient_id = p.id
        ORDER BY c.event_date DESC, c.event_time ASC LIMIT 50
        """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

@app.post("/api/calendar-events")
def create_calendar_event(payload: CalendarEventCreate):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
    INSERT INTO calendar_events (patient_id, event_date, event_time, title, location, notes)
    VALUES (?, ?, ?, ?, ?, ?)
    """, (
        payload.patient_id,
        payload.event_date,
        payload.event_time,
        payload.title.strip(),
        payload.location.strip() if payload.location else "",
        payload.notes.strip() if payload.notes else ""
    ))
    new_id = cur.lastrowid
    conn.commit()
    cur.execute("SELECT * FROM calendar_events WHERE id = ?", (new_id,))
    new_event = dict(cur.fetchone())
    conn.close()
    return new_event

@app.delete("/api/calendar-events/{event_id}")
def delete_calendar_event(event_id: int):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM calendar_events WHERE id = ?", (event_id,))
    conn.commit()
    conn.close()
    return {"status": "success", "deleted_id": event_id}

@app.post("/api/trigger-alert")
def trigger_alert_broadcast(alert_code: int = 3, severity: int = 100):
    PEER_ALERT_STRUCT = struct.Struct("<BBBBI")
    packet = PEER_ALERT_STRUCT.pack(0xAA, 0, alert_code, severity, int(time.time() * 1000) & 0xFFFFFFFF)

    if telemetry.udp_sock:
        try:
            telemetry.udp_sock.sendto(packet, ('<broadcast>', UDP_PORT))
            for b_ip in list(telemetry.active_bands.keys()):
                telemetry.udp_sock.sendto(packet, (b_ip, UDP_PORT))
        except Exception as e:
            return {"status": "error", "message": str(e)}

    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
    INSERT INTO alert_events (patient_id, band_id, timestamp, alert_type, severity, source, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        1, 1, datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "MANUAL_TEST_ALARM", severity, "Doctor Console",
        "Manual emergency alert dispatched to all wristbands on network."
    ))
    conn.commit()
    conn.close()
    return {"status": "success", "alert_code": alert_code, "severity": severity}

@app.post("/api/simulate")
def toggle_simulator(enabled: bool = Query(True)):
    with telemetry.lock:
        telemetry.simulator_running = enabled
        if not enabled:
            telemetry.last_kinematics = {"ax": 0.0, "ay": 0.0, "az": 0.0, "gx": 0.0, "gy": 0.0, "gz": 0.0, "mag": 0.0, "freq": 0.0}
            telemetry.last_probs = {"p_norm": 0.0, "p_pd": 0.0, "p_et": 0.0, "p_seiz": 0.0, "classification": "Waiting for Wristband", "alert_code": 0}
            telemetry.recent_waveform.clear()
    return {"simulator_running": enabled}

@app.websocket("/ws/live")
async def websocket_telemetry(websocket: WebSocket):
    await websocket.accept()
    with telemetry.lock:
        telemetry.connected_sockets.add(websocket)

    try:
        while True:
            now_t = time.time()
            with telemetry.lock:
                sim = telemetry.simulator_running
                b1_info = telemetry.bands_info.get(1, {})
                b2_info = telemetry.bands_info.get(2, {})
                b1_last = b1_info.get("last_seen", 0)
                b2_last = b2_info.get("last_seen", 0)
                b1_online = (now_t - b1_last < 3.5) or sim
                b2_online = (now_t - b2_last < 3.5)
                active_b = [ip for ip, last_t in telemetry.active_bands.items() if now_t - last_t < 4.0]
                is_live = (len(active_b) > 0) or sim or b1_online or b2_online

                bands_data = {
                    "band1": {
                        "id": 1,
                        "name": "Wristband 1",
                        "role": "Patient Primary Band (IMU)",
                        "online": b1_online,
                        "ip": b1_info.get("ip") if b1_online else ("127.0.0.1 (Simulated)" if sim else "Not Connected"),
                        "rssi": b1_info.get("rssi") if b1_online else (-52 if sim else None),
                        "last_seen_sec": round(now_t - b1_last, 1) if (b1_last > 0 and not sim) else (0.1 if b1_online else None)
                    },
                    "band2": {
                        "id": 2,
                        "name": "Wristband 2",
                        "role": "Caregiver Alert Band (Receiver)",
                        "online": b2_online,
                        "ip": b2_info.get("ip") if b2_online else "Not Connected",
                        "rssi": b2_info.get("rssi") if b2_online else None,
                        "last_seen_sec": round(now_t - b2_last, 1) if b2_last > 0 else None
                    }
                }

                if is_live:
                    payload = {
                        "streaming_active": True,
                        "timestamp": datetime.now().strftime("%H:%M:%S.%f")[:-4],
                        "kinematics": dict(telemetry.last_kinematics),
                        "probs": dict(telemetry.last_probs),
                        "waveform": list(telemetry.recent_waveform[-20:]),
                        "active_bands_count": (1 if b1_online else 0) + (1 if b2_online else 0),
                        "bands": bands_data
                    }
                else:
                    payload = {
                        "streaming_active": False,
                        "timestamp": datetime.now().strftime("%H:%M:%S"),
                        "kinematics": {"ax": 0.0, "ay": 0.0, "az": 0.0, "mag": 0.0, "freq": 0.0},
                        "probs": {"classification": "Waiting for Wristband", "alert_code": 0, "p_norm": 0.0, "p_pd": 0.0, "p_et": 0.0, "p_seiz": 0.0},
                        "waveform": [],
                        "active_bands_count": 0,
                        "bands": bands_data
                    }
            await websocket.send_json(payload)
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        with telemetry.lock:
            telemetry.connected_sockets.discard(websocket)
    except Exception:
        with telemetry.lock:
            telemetry.connected_sockets.discard(websocket)

if __name__ == "__main__":
    print("Starting Neuro Monitor Server on http://0.0.0.0:8000 ...")
    while True:
        try:
            uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"[SERVER RECOVERY] Exception: {e}. Restarting in 1 second...")
            time.sleep(1)
