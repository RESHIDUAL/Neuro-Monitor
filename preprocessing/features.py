import numpy as np

def extract_features_dataset(windows_array, sampling_rate=100.0, low_freq=0.5, high_freq=15.0):
    num_samples, window_len, num_channels = windows_array.shape
    rms_feats = np.sqrt(np.mean(windows_array ** 2, axis=1))
    
    freqs = np.fft.rfftfreq(window_len, d=1.0 / sampling_rate)
    rfft = np.fft.rfft(windows_array, axis=1)
    power = np.abs(rfft) ** 2
    
    band_mask = (freqs >= low_freq) & (freqs <= high_freq)
    freqs_band = freqs[band_mask]
    power_band = power[:, band_mask, :]
    
    dom_idx = np.argmax(power_band, axis=1)
    dom_freq = freqs_band[dom_idx]
    
    mask_4_6 = (freqs >= 4.0) & (freqs <= 6.0)
    band_pwr_4_6 = np.sum(power[:, mask_4_6, :], axis=1)
    
    sum_pwr = np.sum(power_band, axis=1, keepdims=True) + 1e-12
    prob = power_band / sum_pwr
    prob = np.where(prob <= 0, 1e-12, prob)
    spec_entropy = -np.sum(prob * np.log2(prob), axis=1)
    
    harm_freq = 2.0 * dom_freq
    df = freqs[1] - freqs[0] if len(freqs) > 1 else 1.0
    harm_ratio = np.zeros_like(dom_freq)
    
    for ch in range(num_channels):
        f_dom = dom_freq[:, ch]
        f_harm = harm_freq[:, ch]
        idx_dom = np.clip(np.round(f_dom / df).astype(int), 0, len(freqs) - 1)
        idx_harm = np.clip(np.round(f_harm / df).astype(int), 0, len(freqs) - 1)
        p_dom = power[np.arange(num_samples), idx_dom, ch] + 1e-12
        p_harm = power[np.arange(num_samples), idx_harm, ch]
        harm_ratio[:, ch] = p_harm / p_dom
        
    all_features = np.concatenate([dom_freq, band_pwr_4_6, rms_feats, spec_entropy, harm_ratio], axis=1)
    return all_features.astype(np.float32)
