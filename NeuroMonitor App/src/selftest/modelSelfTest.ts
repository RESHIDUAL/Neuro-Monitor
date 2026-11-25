// Model runtime self-test.
// Loads both final .tflite files and runs an all-zero input through each.
// Reference outputs were produced with the LiteRT Python interpreter on the same
// files (MD5 04dd5048... and ae3e0c7c...). A match proves the Android runtime
// loads the models and computes the same numbers. It does NOT test preprocessing.
import { loadBundledModel } from '../ml/loadModel';

type ModelCheck = {
  name: string;
  asset: number;
  inputShape: number[];
  labels: string[];
  reference: number[];
};

const CHECKS: ModelCheck[] = [
  {
    name: 'Track 1 tremor (Strided_Conv1D_BiLSTM)',
    asset: require('../../assets/models/Strided_Conv1D_BiLSTM.tflite'),
    inputShape: [1, 300, 6],
    labels: ['Normal', 'Parkinsons-like', 'ET-like'],
    reference: [0.7078, 0.2887, 0.0035],
  },
  {
    name: 'Track 2 seizure-like (Seizure_Conv1D_BiLSTM)',
    asset: require('../../assets/models/Seizure_Conv1D_BiLSTM.tflite'),
    inputShape: [1, 48, 3],
    labels: ['Normal', 'Seizure-like (simulated)'],
    reference: [0.8223, 0.1777],
  },
];

const TOLERANCE = 1e-3;

export type ModelCheckResult = {
  name: string;
  pass: boolean;
  detail: string;
  latencyMs?: number;
};

export async function runModelSelfTest(): Promise<ModelCheckResult[]> {
  const results: ModelCheckResult[] = [];
  for (const c of CHECKS) {
    try {
      const model = await loadBundledModel(c.asset);
      const shapeOk = JSON.stringify(model.inputs[0]?.shape) === JSON.stringify(c.inputShape);
      const size = c.inputShape.reduce((a, b) => a * b, 1);
      const input = new Float32Array(size); // all zeros
      const t0 = Date.now();
      const out = await model.run([input.buffer as ArrayBuffer]);
      const latencyMs = Date.now() - t0;
      const probs = Array.from(new Float32Array(out[0]));
      const maxDiff = Math.max(...probs.map((p, i) => Math.abs(p - c.reference[i])));
      const pass = shapeOk && probs.length === c.reference.length && maxDiff <= TOLERANCE;
      results.push({
        name: c.name,
        pass,
        latencyMs,
        detail:
          `input ${JSON.stringify(model.inputs[0]?.shape)} ${model.inputs[0]?.dataType}; ` +
          `output [${probs.map((p) => p.toFixed(4)).join(', ')}] vs reference [${c.reference.join(', ')}]; ` +
          `max diff ${maxDiff.toExponential(1)}`,
      });
    } catch (e) {
      results.push({ name: c.name, pass: false, detail: `load/run error: ${String(e)}` });
    }
  }
  return results;
}
