// Decoder for the ESP8266 wristband UDP packets.
// Format taken from esp8266_mpu6050_band.ino (struct KinematicFrame, packed):
//   uint32 timestamp_ms, int16 acc_x, acc_y, acc_z, gyro_x, gyro_y, gyro_z
//   = 16 bytes per frame, little-endian (ESP8266 is little-endian).
// One packet = FRAMES_PER_PACKET (10) frames = 160 bytes, sent every 100 ms.

export const FRAME_BYTES = 16;
export const FRAMES_PER_PACKET = 10;
export const PACKET_BYTES = FRAME_BYTES * FRAMES_PER_PACKET; // 160

export type RawFrame = {
  timestampMs: number; // band uptime in ms (millis())
  ax: number; ay: number; az: number; // raw int16 counts
  gx: number; gy: number; gz: number; // raw int16 counts, gyro offset already removed on the band
};

export type DecodeResult =
  | { ok: true; frames: RawFrame[] }
  | { ok: false; reason: string; byteLength: number };

// Rejects anything that is not exactly the firmware's 160-byte layout,
// so stray traffic on port 8888 can never be treated as sensor data.
export function decodePacket(bytes: Uint8Array): DecodeResult {
  if (bytes.byteLength !== PACKET_BYTES) {
    return { ok: false, reason: `expected ${PACKET_BYTES} bytes`, byteLength: bytes.byteLength };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames: RawFrame[] = [];
  for (let i = 0; i < FRAMES_PER_PACKET; i++) {
    const o = i * FRAME_BYTES;
    frames.push({
      timestampMs: view.getUint32(o, true),
      ax: view.getInt16(o + 4, true),
      ay: view.getInt16(o + 6, true),
      az: view.getInt16(o + 8, true),
      gx: view.getInt16(o + 10, true),
      gy: view.getInt16(o + 12, true),
      gz: view.getInt16(o + 14, true),
    });
  }
  return { ok: true, frames };
}

// The packet has no sequence number, so continuity is checked from timestamps.
// Frames are 10 ms apart; millis() can read 9 to 11 ms, so a step above 15 ms
// counts as a gap, and a backwards step means the band restarted.
export const EXPECTED_STEP_MS = 10;
export const GAP_THRESHOLD_MS = 15;

export type ContinuityState = { lastTimestampMs: number | null; gaps: number; restarts: number; missingSamplesEst: number };

export function newContinuityState(): ContinuityState {
  return { lastTimestampMs: null, gaps: 0, restarts: 0, missingSamplesEst: 0 };
}

export function updateContinuity(state: ContinuityState, frames: RawFrame[]): ContinuityState {
  let { lastTimestampMs, gaps, restarts, missingSamplesEst } = state;
  for (const f of frames) {
    if (lastTimestampMs !== null) {
      const step = f.timestampMs - lastTimestampMs;
      if (step < 0) restarts++;
      else if (step > GAP_THRESHOLD_MS) {
        gaps++;
        missingSamplesEst += Math.round(step / EXPECTED_STEP_MS) - 1;
      }
    }
    lastTimestampMs = f.timestampMs;
  }
  return { lastTimestampMs, gaps, restarts, missingSamplesEst };
}
