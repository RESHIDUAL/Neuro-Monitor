# Reference implementation of both profiles with scipy, compared against the app's TypeScript output.
# Profile A copies esp8266_receiver.py line for line. Profile B follows preprocess_config.json + golden vectors.
import json, subprocess, sys
import numpy as np
from scipy import signal

app_dir, cfg_path = sys.argv[1], sys.argv[2]
cfg = json.load(open(cfg_path))
rng = np.random.default_rng(7)

# --- esp8266_receiver.py (verbatim logic) ---
GLOBAL_STD = np.array([0.281, 0.312, 0.345, 0.890, 0.940, 1.020], dtype=np.float32)
sos_tremor = signal.butter(4, [0.5, 20.0], btype="bandpass", fs=100.0, output="sos")
sos_seizure = signal.butter(4, [3.0, 7.5], btype="bandpass", fs=16.0, output="sos")
def recv_t1(raw_win):
    demeaned = raw_win - np.mean(raw_win, axis=0, keepdims=True)
    filtered = signal.sosfiltfilt(sos_tremor, demeaned, axis=0)
    return (filtered / GLOBAL_STD).astype(np.float32)
def recv_t2(raw_win):
    accel = raw_win[:, :3]
    r = signal.resample_poly(accel, up=4, down=25, axis=0)
    d = r - np.mean(r, axis=0, keepdims=True)
    f = signal.sosfiltfilt(sos_seizure, d, axis=0)
    return (f / 0.428)[:48].astype(np.float32)

# --- Profile B ---
std1 = np.array(cfg["track1_movement_disorder"]["channel_std"])
std2 = np.array(cfg["track2_seizure_detection"]["channel_std"])
def cfg_t1(raw_win):
    return ((raw_win - raw_win.mean(0, keepdims=True)) / std1).astype(np.float32)
def cfg_t2(raw_win):
    r = signal.resample_poly(raw_win[:, :3], 4, 25, axis=0)
    b, a = signal.butter(4, [3.0, 7.5], btype="bandpass", fs=16.0)  # notebook 13, line for line
    f = signal.lfilter(b, a, r, axis=0)
    return ((f - f.mean(0, keepdims=True)) / std2).astype(np.float32)

# Test windows in app units (g, rad/s): rest with gravity, 5 Hz tremor, vigorous shaking, pure noise.
t = np.arange(300) / 100.0
wins = []
for kind in range(6):
    w = rng.normal(0, 0.01, (300, 6))
    w[:, 2] += 1.0
    if kind in (1, 4):
        w[:, 0] += 0.05 * np.sin(2 * np.pi * 5 * t); w[:, 3] += 0.3 * np.sin(2 * np.pi * 5 * t + 0.4)
    if kind in (2, 5):
        w[:, :3] += 1.5 * np.sin(2 * np.pi * 3.7 * t)[:, None] * np.array([1, 0.7, 0.4])
        w[:, 3:] += 3.0 * np.sin(2 * np.pi * 3.7 * t + 0.5)[:, None]
    wins.append(w)
json.dump([w.tolist() for w in wins], open("/tmp/pp_in.json", "w"))
subprocess.run(["node", "/tmp/pp_dump.cjs", "/tmp/pp_in.json", "/tmp/pp_out.json"], cwd=app_dir, check=True,
               stderr=subprocess.DEVNULL)
ts = json.load(open("/tmp/pp_out.json"))

worst = {}
for w, o in zip(wins, ts):
    for key, ref, shape in [("t1_receiver", recv_t1(w), (300, 6)), ("t1_config", cfg_t1(w), (300, 6)),
                            ("t2_receiver", recv_t2(w), (48, 3)), ("t2_config", cfg_t2(w), (48, 3))]:
        got = np.array(o[key], dtype=np.float32).reshape(shape)
        err = float(np.max(np.abs(got - ref)) / max(1e-9, float(np.max(np.abs(ref)))))
        worst[key] = max(worst.get(key, 0), err)
for k, v in worst.items():
    print(f"{k:12s} max relative error vs scipy = {v:.2e}  {'PASS' if v < 1e-5 else 'FAIL'}")
