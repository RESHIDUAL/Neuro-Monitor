import os
import json
import numpy as np
import pandas as pd
from sklearn.metrics import f1_score, balanced_accuracy_score, roc_auc_score

def load_v1_pads_data(results_dir="results"):
    data_path = os.path.join(results_dir, "pads_primary_100hz.npz")
    meta_path = os.path.join(results_dir, "pads_primary_100hz_metadata.csv")
    windows = np.load(data_path)["windows"]
    meta = pd.read_csv(meta_path)
    return windows, meta

def load_fold_splits(results_dir="results"):
    splits_path = os.path.join(results_dir, "fold_splits_3seeds.npz")
    if os.path.exists(splits_path):
        return np.load(splits_path)
    return np.load(os.path.join(results_dir, "fold_splits_5.npz"))

def get_task_one_hot(meta_df):
    task_order = ["Relaxed", "RelaxedTask", "StretchHold", "LiftHold", "HoldWeight"]
    task_to_idx = {t: i for i, t in enumerate(task_order)}
    one_hot = np.zeros((len(meta_df), len(task_order)), dtype=np.float32)
    for i, t in enumerate(meta_df["task"]):
        if t in task_to_idx:
            one_hot[i, task_to_idx[t]] = 1.0
    return one_hot

def apply_amplitude_aware_augmentation(windows, jitter_sigma=0.03, max_shift=15, mirror_prob=0.5, seed=42):
    rng = np.random.default_rng(seed)
    n, t, c = windows.shape
    augmented = windows.copy()
    
    noise = rng.normal(0, jitter_sigma, size=(n, t, c)).astype(np.float32)
    stds = windows.std(axis=1, keepdims=True)
    augmented = augmented + noise * stds
    
    for i in range(n):
        shift = rng.integers(-max_shift, max_shift + 1)
        if shift != 0:
            augmented[i] = np.roll(augmented[i], shift, axis=0)
            if shift > 0:
                augmented[i, :shift] = augmented[i, shift:shift+1]
            else:
                augmented[i, shift:] = augmented[i, shift-1:shift]
                
        if rng.random() < mirror_prob:
            augmented[i, :, 0] = -augmented[i, :, 0]
            augmented[i, :, 4] = -augmented[i, :, 4]
            augmented[i, :, 5] = -augmented[i, :, 5]
            
    return augmented

def compute_bootstrap_ci(y_true, probs, metric_fn, n_boot=1000, seed=42):
    rng = np.random.default_rng(seed)
    scores = []
    n = len(y_true)
    for _ in range(n_boot):
        idx = rng.choice(n, size=n, replace=True)
        scores.append(metric_fn(y_true[idx], probs[idx]))
    return float(np.percentile(scores, 2.5)), float(np.percentile(scores, 97.5))

def compute_wilson_ci(k, n, confidence=0.95):
    if n == 0:
        return 0.0, 0.0, 0.0
    z = 1.959963984540054
    p_hat = k / n
    denominator = 1 + (z ** 2) / n
    center = (p_hat + (z ** 2) / (2 * n)) / denominator
    spread = (z / denominator) * np.sqrt((p_hat * (1 - p_hat) / n) + ((z ** 2) / (4 * (n ** 2))))
    return float(p_hat), float(max(0.0, center - spread)), float(min(1.0, center + spread))

def load_pads_all_tasks_recordings(dataset_root, allowed_subject_ids, trim_start_samples=200):
    all_tasks = [
        "CrossArms", "DrinkGlas", "Entrainment", "HoldWeight", "LiftHold",
        "PointFinger", "Relaxed", "RelaxedTask", "StretchHold", "TouchIndex", "TouchNose"
    ]
    wrists = ["LeftWrist", "RightWrist"]
    timeseries_dir = os.path.join(dataset_root, "movement", "timeseries")
    recordings = []
    
    for sub in allowed_subject_ids:
        clean_sub = sub.replace("PADS_", "").zfill(3)
        for task in all_tasks:
            for wrist in wrists:
                file_name = f"{clean_sub}_{task}_{wrist}.txt"
                file_path = os.path.join(timeseries_dir, file_name)
                if not os.path.exists(file_path):
                    continue
                arr = np.loadtxt(file_path, delimiter=",", dtype=np.float32)
                if trim_start_samples > 0 and len(arr) > trim_start_samples:
                    arr = arr[trim_start_samples:]
                if len(arr) >= 300:
                    recordings.append({
                        "subject_id": f"PADS_{clean_sub}",
                        "task": task,
                        "wrist": wrist,
                        "data": arr
                    })
    return recordings

def extract_300_windows_from_recordings(recordings, window_size=300, step_size=300):
    windows = []
    sub_ids = []
    tasks = []
    wrists = []
    for r in recordings:
        arr = r["data"]
        n_win = (len(arr) - window_size) // step_size + 1
        for i in range(n_win):
            start = i * step_size
            end = start + window_size
            windows.append(arr[start:end])
            sub_ids.append(r["subject_id"])
            tasks.append(r["task"])
            wrists.append(r["wrist"])
    if len(windows) == 0:
        return np.zeros((0, window_size, 6), dtype=np.float32), pd.DataFrame()
    return np.array(windows, dtype=np.float32), pd.DataFrame({
        "subject_id": sub_ids,
        "task": tasks,
        "wrist": wrists
    })

def load_v2_all_tasks_data(results_dir="results"):
    data_path = os.path.join(results_dir, "v2_pads_all_tasks_100hz.npz")
    meta_path = os.path.join(results_dir, "v2_pads_all_tasks_metadata.csv")
    windows = np.load(data_path)["windows"][:, :, 1:7].astype(np.float32)
    meta = pd.read_csv(meta_path)
    return windows, meta
