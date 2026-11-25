import os
import numpy as np
import pandas as pd

def parse_ts_file(file_path):
    series_list = []
    labels = []
    with open(file_path, "r", encoding="utf-8") as f:
        in_data = False
        for line in f:
            line = line.strip()
            if not line:
                continue
            if line.startswith("@data"):
                in_data = True
                continue
            if not in_data or line.startswith("#") or line.startswith("@"):
                continue
            parts = line.split(":")
            channels_data = []
            for dim_str in parts[:-1]:
                values = [float(v) for v in dim_str.split(",") if v.strip()]
                channels_data.append(values)
            label = parts[-1].strip()
            channels_array = np.array(channels_data, dtype=np.float32).T
            series_list.append(channels_array)
            labels.append(label)
    return series_list, labels

def load_epilepsy_dataset(dataset_dir):
    train_path = os.path.join(dataset_dir, "Epilepsy_TRAIN.ts")
    test_path = os.path.join(dataset_dir, "Epilepsy_TEST.ts")
    
    train_series, train_labels = parse_ts_file(train_path)
    test_series, test_labels = parse_ts_file(test_path)
    
    recordings = []
    for idx, (series, raw_label) in enumerate(zip(train_series, train_labels)):
        cohort_label = "Seizure-like (simulated)" if raw_label == "EPILEPSY" else "Normal"
        recordings.append({
            "subject_id": "UEA_TRAIN_PARTICIPANTS",
            "series_id": f"UEA_TR_{idx:03d}",
            "dataset": "UEA",
            "split": "train",
            "task": raw_label,
            "wrist": "DominantWrist",
            "cohort_label": cohort_label,
            "raw_label": raw_label,
            "data": series
        })
        
    for idx, (series, raw_label) in enumerate(zip(test_series, test_labels)):
        cohort_label = "Seizure-like (simulated)" if raw_label == "EPILEPSY" else "Normal"
        recordings.append({
            "subject_id": "UEA_TEST_PARTICIPANTS",
            "series_id": f"UEA_TE_{idx:03d}",
            "dataset": "UEA",
            "split": "test",
            "task": raw_label,
            "wrist": "DominantWrist",
            "cohort_label": cohort_label,
            "raw_label": raw_label,
            "data": series
        })
    return recordings
