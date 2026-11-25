import numpy as np

def per_window_znorm(window_array, epsilon=1e-8):
    mean_val = np.mean(window_array, axis=0, keepdims=True)
    std_val = np.std(window_array, axis=0, keepdims=True)
    std_val = np.where(std_val < epsilon, 1.0, std_val)
    return (window_array - mean_val) / std_val

def fit_global_scaler(train_windows):
    train_mean = np.mean(train_windows, axis=(0, 1), keepdims=True)
    train_std = np.std(train_windows, axis=(0, 1), keepdims=True)
    train_std = np.where(train_std < 1e-8, 1.0, train_std)
    return train_mean, train_std

def apply_global_scaler(windows, train_mean, train_std):
    return (windows - train_mean) / train_std

def extract_normalized_psd(window_array, sampling_rate=16.0):
    fft_vals = np.fft.rfft(window_array, axis=0)
    power_vals = np.abs(fft_vals) ** 2
    sum_power = np.sum(power_vals, axis=0, keepdims=True)
    sum_power = np.where(sum_power < 1e-8, 1.0, sum_power)
    return power_vals / sum_power

def augment_random_scale(window_array, min_scale=0.7, max_scale=1.4, random_state=None):
    rng = np.random.default_rng(random_state)
    scale_factor = rng.uniform(min_scale, max_scale)
    return window_array * scale_factor

def augment_additive_noise(window_array, noise_std=0.03, random_state=None):
    rng = np.random.default_rng(random_state)
    noise = rng.normal(0.0, noise_std, size=window_array.shape)
    return window_array + noise
