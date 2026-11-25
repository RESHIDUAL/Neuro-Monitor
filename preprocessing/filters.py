import numpy as np
from scipy import signal

def downsample_100hz_to_16hz(raw_signal):
    return signal.resample_poly(raw_signal, up=4, down=25, axis=0)

def bandpass_filter_16hz(resampled_signal, low_freq=3.0, high_freq=7.5, filter_order=4):
    sos = signal.butter(filter_order, [low_freq, high_freq], btype="bandpass", fs=16.0, output="sos")
    return signal.sosfiltfilt(sos, resampled_signal, axis=0)

def wide_bandpass_filter_16hz(resampled_signal, low_freq=0.5, high_freq=7.5, filter_order=4):
    sos = signal.butter(filter_order, [low_freq, high_freq], btype="bandpass", fs=16.0, output="sos")
    return signal.sosfiltfilt(sos, resampled_signal, axis=0)
