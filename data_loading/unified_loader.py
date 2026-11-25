import os
import numpy as np
import pandas as pd
from scipy import signal
from data_loading.pads_loader import load_pads_metadata, filter_pads_cohort, load_all_pads_recordings
from data_loading.epilepsy_loader import load_epilepsy_dataset
from preprocessing.filters import downsample_100hz_to_16hz, bandpass_filter_16hz, wide_bandpass_filter_16hz
from preprocessing.windowing import process_recordings_to_windows

def build_pads_primary_100hz_dataset(pads_root, tasks=None, low_freq=0.5, high_freq=20.0, trim_start_samples=200):
    if tasks is None:
        tasks = ["Relaxed", "RelaxedTask", "StretchHold", "LiftHold", "HoldWeight"]
    metadata_df = load_pads_metadata(pads_root)
    cohort_df = filter_pads_cohort(metadata_df)
    pads_raw_recordings = load_all_pads_recordings(
        pads_root, cohort_df, tasks=tasks, trim_start_samples=trim_start_samples
    )
    
    sos = signal.butter(4, [low_freq, high_freq], btype="bandpass", fs=100.0, output="sos")
    pads_processed = []
    for rec in pads_raw_recordings:
        raw_data = rec["data"]
        motion_6ch = raw_data[:, 1:7]
        filtered_6ch = signal.sosfiltfilt(sos, motion_6ch, axis=0)
        pads_processed.append({
            "subject_id": rec["subject_id"],
            "series_id": f"{rec['subject_id']}_{rec['task']}_{rec['wrist']}",
            "split": "cv",
            "dataset": "PADS",
            "task": rec["task"],
            "wrist": rec["wrist"],
            "cohort_label": rec["cohort_label"],
            "data": filtered_6ch
        })
        
    windows_array, window_metadata = process_recordings_to_windows(
        pads_processed, window_size=300, step_size=150, demean=True
    )
    meta_df = pd.DataFrame(window_metadata)
    return windows_array, meta_df

def build_pads_within_source_dataset(pads_root, tasks=None, apply_bandpass=True, demean=True, trim_start_samples=200):
    if tasks is None:
        tasks = ["Relaxed", "RelaxedTask", "StretchHold", "LiftHold", "HoldWeight"]
    metadata_df = load_pads_metadata(pads_root)
    cohort_df = filter_pads_cohort(metadata_df)
    pads_raw_recordings = load_all_pads_recordings(
        pads_root, cohort_df, tasks=tasks, trim_start_samples=trim_start_samples
    )
    
    pads_processed = []
    for rec in pads_raw_recordings:
        raw_data = rec["data"]
        accel_data = raw_data[:, 1:4]
        resampled_accel = downsample_100hz_to_16hz(accel_data)
        if apply_bandpass:
            filtered_accel = bandpass_filter_16hz(resampled_accel)
        else:
            filtered_accel = wide_bandpass_filter_16hz(resampled_accel)
        pads_processed.append({
            "subject_id": rec["subject_id"],
            "series_id": f"{rec['subject_id']}_{rec['task']}_{rec['wrist']}",
            "split": "cv",
            "dataset": "PADS",
            "task": rec["task"],
            "wrist": rec["wrist"],
            "cohort_label": rec["cohort_label"],
            "data": filtered_accel
        })
        
    windows_array, window_metadata = process_recordings_to_windows(
        pads_processed, window_size=48, step_size=24, demean=demean
    )
    meta_df = pd.DataFrame(window_metadata)
    return windows_array, meta_df

def build_uea_within_source_dataset(uea_dir, apply_bandpass=True, demean=True):
    uea_raw_recordings = load_epilepsy_dataset(uea_dir)
    uea_processed = []
    for rec in uea_raw_recordings:
        raw_accel = rec["data"]
        if apply_bandpass:
            filtered_accel = bandpass_filter_16hz(raw_accel)
        else:
            filtered_accel = wide_bandpass_filter_16hz(raw_accel)
        uea_processed.append({
            "subject_id": rec["subject_id"],
            "series_id": rec["series_id"],
            "split": rec["split"],
            "dataset": "UEA",
            "task": rec["task"],
            "wrist": rec["wrist"],
            "cohort_label": rec["cohort_label"],
            "data": filtered_accel
        })
        
    windows_array, window_metadata = process_recordings_to_windows(
        uea_processed, window_size=48, step_size=24, demean=demean
    )
    meta_df = pd.DataFrame(window_metadata)
    return windows_array, meta_df

def build_unified_dataset(pads_root, uea_dir, tasks=None, apply_bandpass=True, demean=True, trim_start_samples=200):
    if tasks is None:
        tasks = ["Relaxed", "RelaxedTask", "StretchHold", "LiftHold", "HoldWeight"]
    pads_windows, pads_meta = build_pads_within_source_dataset(
        pads_root, tasks=tasks, apply_bandpass=apply_bandpass, demean=demean, trim_start_samples=trim_start_samples
    )
    uea_windows, uea_meta = build_uea_within_source_dataset(
        uea_dir, apply_bandpass=apply_bandpass, demean=demean
    )
    all_windows = np.concatenate([pads_windows, uea_windows], axis=0)
    all_meta = pd.concat([pads_meta, uea_meta], ignore_index=True)
    return all_windows, all_meta
