// Raw MPU6050 counts to physical units.
// Two possible firmware settings; the active one is chosen in Settings until Eshwar confirms:
//   v1 firmware (current .ino): ACCEL_CONFIG 0x00 -> +/-2 g (16384 counts/g), GYRO_CONFIG 0x00 -> +/-250 dps (131 counts/dps)
//   proposed:                   +/-4 g (8192 counts/g), +/-500 dps (65.5 counts/dps)
import type { RawFrame } from './packet';

export type ScaleId = 'v1_2g_250dps' | 'alt_4g_500dps';

export const SCALES: Record<ScaleId, { accelCountsPerG: number; gyroCountsPerDps: number; label: string }> = {
  v1_2g_250dps: { accelCountsPerG: 16384, gyroCountsPerDps: 131, label: '+/-2 g, +/-250 dps (firmware v1)' },
  alt_4g_500dps: { accelCountsPerG: 8192, gyroCountsPerDps: 65.5, label: '+/-4 g, +/-500 dps (proposed)' },
};

export const SENSOR_SCALE = {
  id: 'v1_2g_250dps' as ScaleId,
  accelCountsPerG: 16384,
  gyroCountsPerDps: 131,
  confirmed: false,
  note: 'Firmware v1 ranges (+/-2 g, +/-250 dps). Awaiting confirmation.',
};

export function setSensorScale(id: ScaleId) {
  const s = SCALES[id];
  SENSOR_SCALE.id = id;
  SENSOR_SCALE.accelCountsPerG = s.accelCountsPerG;
  SENSOR_SCALE.gyroCountsPerDps = s.gyroCountsPerDps;
  SENSOR_SCALE.note = `${s.label}. Awaiting confirmation.`;
}

export type PhysicalSample = {
  t: number;
  ax: number; ay: number; az: number; // g
  gx: number; gy: number; gz: number; // rad/s
};

const DEG_TO_RAD = Math.PI / 180;

export function toPhysical(f: RawFrame): PhysicalSample {
  const a = SENSOR_SCALE.accelCountsPerG;
  const g = SENSOR_SCALE.gyroCountsPerDps;
  return {
    t: f.timestampMs,
    ax: f.ax / a, ay: f.ay / a, az: f.az / a,
    gx: (f.gx / g) * DEG_TO_RAD, gy: (f.gy / g) * DEG_TO_RAD, gz: (f.gz / g) * DEG_TO_RAD,
  };
}
