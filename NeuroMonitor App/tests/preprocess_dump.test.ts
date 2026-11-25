// Runs the app's preprocessing on windows from a JSON file and writes the tensors out,
// so tests/../scripts can compare them with scipy. Run: node tests/preprocess_dump.test.ts in.json out.json
import { readFileSync, writeFileSync } from 'node:fs';
import { preprocessTrack1, preprocessTrack2 } from '../src/signal/preprocess.ts';

const [inPath, outPath] = process.argv.slice(2);
const windows: number[][][] = JSON.parse(readFileSync(inPath, 'utf8'));
const out = windows.map((w) => ({
  t1_receiver: Array.from(preprocessTrack1('receiver', w)),
  t1_config: Array.from(preprocessTrack1('config', w)),
  t2_receiver: Array.from(preprocessTrack2('receiver', w)),
  t2_config: Array.from(preprocessTrack2('config', w)),
}));
writeFileSync(outPath, JSON.stringify(out));
console.log('dumped', out.length, 'windows');
