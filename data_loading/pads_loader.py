import os
import json
import numpy as np
import pandas as pd

def load_pads_metadata(dataset_root):
    patients_dir = os.path.join(dataset_root, "patients")
    records = []
    for file_name in sorted(os.listdir(patients_dir)):
        if not file_name.endswith(".json"):
            continue
        file_path = os.path.join(patients_dir, file_name)
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        records.append({
            "subject_id": str(data["id"]).zfill(3),
            "condition": data.get("condition", ""),
            "disease_comment": data.get("disease_comment", "-") or "-",
            "age": data.get("age", np.nan),
            "gender": data.get("gender", ""),
            "handedness": data.get("handedness", "")
        })
    return pd.DataFrame(records)

def filter_pads_cohort(metadata_df):
    clean_records = []
    for _, row in metadata_df.iterrows():
        subject_id = row["subject_id"]
        condition = row["condition"]
        comment = str(row["disease_comment"]).lower()
        
        is_et_comment = "essential tremor" in comment or comment == "et"
        is_mixed = "dd" in comment or "ips" in comment or "parkinson" in comment
        
        if condition == "Healthy":
            clean_records.append({**row.to_dict(), "cohort_label": "Normal"})
        elif condition == "Parkinson's" and not is_et_comment:
            clean_records.append({**row.to_dict(), "cohort_label": "Parkinsons-like"})
        elif condition == "Essential Tremor" and not is_mixed:
            clean_records.append({**row.to_dict(), "cohort_label": "ET-like"})
    return pd.DataFrame(clean_records)

def load_pads_series(dataset_root, subject_id, task, wrist, trim_start_samples=200):
    file_name = f"{subject_id}_{task}_{wrist}.txt"
    file_path = os.path.join(dataset_root, "movement", "timeseries", file_name)
    if not os.path.exists(file_path):
        return None
    raw_array = np.loadtxt(file_path, delimiter=",", dtype=np.float32)
    if trim_start_samples > 0 and len(raw_array) > trim_start_samples:
        raw_array = raw_array[trim_start_samples:]
    return raw_array

def load_all_pads_recordings(dataset_root, cohort_df, tasks=None, trim_start_samples=200):
    if tasks is None:
        tasks = [
            "Relaxed", "RelaxedTask", "StretchHold", "LiftHold", "HoldWeight"
        ]
    wrists = ["LeftWrist", "RightWrist"]
    recordings = []
    for _, row in cohort_df.iterrows():
        subject_id = row["subject_id"]
        label = row["cohort_label"]
        for task in tasks:
            for wrist in wrists:
                series = load_pads_series(dataset_root, subject_id, task, wrist, trim_start_samples=trim_start_samples)
                if series is None or len(series) == 0:
                    continue
                recordings.append({
                    "subject_id": f"PADS_{subject_id}",
                    "dataset": "PADS",
                    "task": task,
                    "wrist": wrist,
                    "cohort_label": label,
                    "data": series
                })
    return recordings
