// Checks the TypeScript decoder against packets built by Python's struct.pack("<Ihhhhhh"),
// the same layout the firmware sends and esp8266_receiver.py unpacks.
// Run: node tests/decoder.test.ts <packets.bin> <expected.json>
import { readFileSync } from 'node:fs';
import { decodePacket, newContinuityState, updateContinuity, PACKET_BYTES } from '../src/protocol/packet.ts';
import { toPhysical } from '../src/protocol/units.ts';

const [binPath, expectedPath] = process.argv.slice(2);
const bin = new Uint8Array(readFileSync(binPath));
const expected: number[][] = JSON.parse(readFileSync(expectedPath, 'utf8')); // rows: [t, ax..gz raw, ax..gz physical]

let failures = 0;
let row = 0;
let cont = newContinuityState();
for (let off = 0; off < bin.byteLength; off += PACKET_BYTES) {
  const res = decodePacket(bin.subarray(off, off + PACKET_BYTES));
  if (!res.ok) { console.log('decode failed', res); failures++; continue; }
  cont = updateContinuity(cont, res.frames);
  for (const f of res.frames) {
    const e = expected[row++];
    const raw = [f.timestampMs, f.ax, f.ay, f.az, f.gx, f.gy, f.gz];
    for (let i = 0; i < 7; i++) if (raw[i] !== e[i]) { failures++; console.log('raw mismatch row', row, i, raw[i], e[i]); }
    const p = toPhysical(f);
    const phys = [p.ax, p.ay, p.az, p.gx, p.gy, p.gz];
    for (let i = 0; i < 6; i++) if (Math.abs(phys[i] - e[7 + i]) > 1e-9) { failures++; console.log('unit mismatch row', row, i); }
  }
}

// Wrong-size packets must be rejected.
const bad = decodePacket(new Uint8Array(150));
if (bad.ok) { failures++; console.log('150-byte packet was accepted'); }

console.log(`frames checked: ${row}, gaps: ${cont.gaps}, missing samples (est): ${cont.missingSamplesEst}, restarts: ${cont.restarts}`);
console.log(failures === 0 ? 'DECODER TEST PASS' : `DECODER TEST FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
