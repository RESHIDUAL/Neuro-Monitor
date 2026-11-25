// Runs both models on one 3 s window (300 samples at 100 Hz).
// The ML code never touches the UI; screens call predictWindow() and get a plain object back.
import type { TfliteModel } from 'react-native-fast-tflite';
import { loadBundledModel } from './loadModel';
import type { PhysicalSample } from '../protocol/units';
import { preprocessTrack1, preprocessTrack2, decideTrack1, ProfileId, SEIZURE_THRESHOLD } from '../signal/preprocess';

export const MODEL_FILES = {
  track1: { file: 'Strided_Conv1D_BiLSTM.tflite', md5: '04dd504827d87d3c4d0d8eb72b9305b8' },
  track2: { file: 'Seizure_Conv1D_BiLSTM.tflite', md5: 'ae3e0c7cb3d1f43d84afdbdf1a1341ad' },
};

let models: Promise<{ t1: TfliteModel; t2: TfliteModel }> | null = null;

function getModels() {
  if (!models) {
    models = Promise.all([
      loadBundledModel(require('../../assets/models/Strided_Conv1D_BiLSTM.tflite')),
      loadBundledModel(require('../../assets/models/Seizure_Conv1D_BiLSTM.tflite')),
    ]).then(([t1, t2]) => ({ t1, t2 }));
    models.catch(() => { models = null; });
  }
  return models;
}

export type WindowPrediction = {
  pNormal: number;
  pPd: number;
  pEt: number;
  pSeizure: number;
  track1Pattern: 'Normal' | 'Parkinsons-like' | 'ET-like';
  seizureLike: boolean;
  profile: ProfileId;
};

export async function predictWindow(profile: ProfileId, w: PhysicalSample[]): Promise<WindowPrediction> {
  if (w.length !== 300) throw new Error('window must be 300 samples');
  const rows = w.map((p) => [p.ax, p.ay, p.az, p.gx, p.gy, p.gz]);
  const { t1, t2 } = await getModels();
  const x1 = preprocessTrack1(profile, rows);
  const x2 = preprocessTrack2(profile, rows);
  const [o1] = await t1.run([x1.buffer as ArrayBuffer]);
  const [o2] = await t2.run([x2.buffer as ArrayBuffer]);
  const p1 = new Float32Array(o1);
  const p2 = new Float32Array(o2);
  const probs = { normal: p1[0], pd: p1[1], et: p1[2] };
  return {
    pNormal: p1[0], pPd: p1[1], pEt: p1[2], pSeizure: p2[1],
    track1Pattern: decideTrack1(profile, probs),
    seizureLike: p2[1] > SEIZURE_THRESHOLD,
    profile,
  };
}
