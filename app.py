import os
import numpy as np
import pandas as pd
import tensorflow as tf
import gradio as gr
from scipy.signal import find_peaks

class NeuroMonitorApp:
    def __init__(self, tflite_path, test_data_path, test_meta_path):
        self.interpreter = tf.lite.Interpreter(model_path=tflite_path)
        self.interpreter.allocate_tensors()
        self.input_details = self.interpreter.get_input_details()
        self.output_details = self.interpreter.get_output_details()
        self.test_data = np.load(test_data_path)["windows"]
        self.test_meta = pd.read_csv(test_meta_path)
        self.class_names = ["Normal", "Parkinsons-like", "ET-like"]
        
        xd_all = self.test_data - self.test_data.mean(axis=1, keepdims=True)
        self.channel_std = xd_all.std(axis=(0, 1)).astype(np.float32)
        self.channel_std[self.channel_std == 0] = 1.0

    def analyze_window(self, window_data):
        mean_vec = np.mean(window_data, axis=0, keepdims=True)
        demeaned = (window_data - mean_vec).astype(np.float32)
        normalized = (demeaned / self.channel_std).astype(np.float32)
        
        inp = np.expand_dims(normalized, axis=0)
        self.interpreter.set_tensor(self.input_details[0]["index"], inp)
        self.interpreter.invoke()
        probs = self.interpreter.get_tensor(self.output_details[0]["index"])[0]
        
        pred_idx = int(np.argmax(probs))
        pred_class = self.class_names[pred_idx]
        confidence = float(probs[pred_idx])
        
        acc_mag = np.linalg.norm(demeaned[:, :3], axis=1)
        fft_vals = np.abs(np.fft.rfft(acc_mag))
        freqs = np.fft.rfftfreq(len(acc_mag), d=1.0/100.0)
        valid_idx = (freqs >= 0.5) & (freqs <= 15.0)
        peaks, _ = find_peaks(fft_vals[valid_idx])
        if len(peaks) > 0:
            dom_freq = float(freqs[valid_idx][peaks[np.argmax(fft_vals[valid_idx][peaks])]])
        else:
            dom_freq = float(freqs[valid_idx][np.argmax(fft_vals[valid_idx])])
            
        prob_dict = {self.class_names[i]: float(probs[i]) for i in range(len(self.class_names))}
        result_text = f"Pattern consistent with: {pred_class} (Confidence: {confidence:.1%})"
        freq_text = f"Dominant Tremor Frequency: {dom_freq:.2f} Hz"
        
        return result_text, freq_text, prob_dict

    def process_input(self, file_obj, example_choice):
        if file_obj is not None:
            df = pd.read_csv(file_obj.name)
            data = df.values[:300, :6]
            if data.shape != (300, 6):
                return "Error: Input must have at least 300 samples and 6 channels.", "", {}
        else:
            idx = int(example_choice.split(":")[0])
            data = self.test_data[idx]
        return self.analyze_window(data)

def create_ui():
    tflite_path = os.path.join("results", "models", "Strided_Conv1D_BiLSTM.tflite")
    test_data_path = os.path.join("results", "pads_primary_100hz.npz")
    test_meta_path = os.path.join("results", "pads_primary_100hz_metadata.csv")
    
    app = NeuroMonitorApp(tflite_path, test_data_path, test_meta_path)
    
    examples = []
    meta = app.test_meta
    for label in ["Normal", "Parkinsons-like", "ET-like"]:
        matches = meta[meta["cohort_label"] == label].index
        if len(matches) > 0:
            for i in matches[:2]:
                task = meta.loc[i, "task"]
                sub = meta.loc[i, "subject_id"]
                examples.append(f"{i}: {label} ({task}, Subject {sub})")
                
    with gr.Blocks(title="Neuro Monitor - Movement Disorder Screening Aid") as demo:
        gr.Markdown("# Neuro Monitor: Movement Disorder Screening Aid")
        gr.Markdown("LRNG: National (India) | CC: Human Values | SDG: 3 (Good Health and Well-being) | Intelligent Edge Technologies")
        gr.Markdown("WARNING: Screening aid only. Never a diagnostic device. All movement pattern analyses must be confirmed by a clinical specialist.")
        
        with gr.Row():
            with gr.Column():
                example_dropdown = gr.Dropdown(choices=examples, value=examples[0] if examples else None, label="Select Test Window Example")
                file_input = gr.File(label="Or Upload 300x6 CSV Window (acc_x..z, gyr_x..z at 100 Hz)")
                submit_btn = gr.Button("Analyze Motion Pattern", variant="primary")
            with gr.Column():
                output_label = gr.Textbox(label="Screening Classification")
                output_freq = gr.Textbox(label="Spectral Feature")
                output_chart = gr.Label(label="Class Probability Distribution")
                
        submit_btn.click(
            fn=app.process_input,
            inputs=[file_input, example_dropdown],
            outputs=[output_label, output_freq, output_chart]
        )
        
    return demo

if __name__ == "__main__":
    demo = create_ui()
    demo.launch(server_name="0.0.0.0", server_port=7860, share=False)
