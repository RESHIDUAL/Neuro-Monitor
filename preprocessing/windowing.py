import numpy as np

def extract_windows_from_series(series_array, window_size=48, step_size=24, demean=True):
    total_samples = series_array.shape[0]
    if total_samples < window_size:
        return np.empty((0, window_size, series_array.shape[1]), dtype=series_array.dtype)
    num_windows = (total_samples - window_size) // step_size + 1
    windows = []
    for i in range(num_windows):
        start_idx = i * step_size
        end_idx = start_idx + window_size
        w = series_array[start_idx:end_idx]
        if demean:
            w = w - np.mean(w, axis=0, keepdims=True)
        windows.append(w)
    return np.array(windows, dtype=series_array.dtype)

def process_recordings_to_windows(recordings_list, window_size=48, step_size=24, demean=True):
    windows_list = []
    metadata_list = []
    for rec_idx, rec in enumerate(recordings_list):
        data = rec["data"]
        series_windows = extract_windows_from_series(data, window_size=window_size, step_size=step_size, demean=demean)
        for w_idx in range(len(series_windows)):
            windows_list.append(series_windows[w_idx])
            metadata_list.append({
                "recording_id": rec_idx,
                "subject_id": rec["subject_id"],
                "series_id": rec.get("series_id", f"REC_{rec_idx}"),
                "split": rec.get("split", "cv"),
                "dataset": rec["dataset"],
                "task": rec.get("task", ""),
                "wrist": rec.get("wrist", ""),
                "cohort_label": rec["cohort_label"],
                "window_idx": w_idx
            })
    return np.array(windows_list, dtype=np.float32), metadata_list
