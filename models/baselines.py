import numpy as np
from sklearn.ensemble import RandomForestClassifier

def train_rf_baseline(X_train_features, y_train, random_state=42):
    clf = RandomForestClassifier(
        n_estimators=200,
        max_depth=15,
        class_weight="balanced",
        random_state=random_state
    )
    clf.fit(X_train_features, y_train)
    return clf

def evaluate_fft_threshold_rule(features_array, dom_freq_col=0, band_pwr_col=1, pwr_threshold=0.001):
    preds = []
    for row in features_array:
        dom_f = row[dom_freq_col]
        pwr = row[band_pwr_col]
        if (3.0 <= dom_f <= 8.0) and (pwr > pwr_threshold):
            preds.append(1)
        else:
            preds.append(0)
    return np.array(preds)

def evaluate_rms_threshold_rule(series_rms_values, threshold=0.5):
    return (np.array(series_rms_values) > threshold).astype(int)
