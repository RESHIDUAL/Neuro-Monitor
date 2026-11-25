"""
band_simulator.py  -  SYNTHETIC wristband for testing the Neuro Monitor app.

Sends UDP packets in exactly the same format as esp8266_mpu6050_band.ino:
  10 frames per packet, 16 bytes per frame, little-endian "<Ihhhhhh"
  (timestamp_ms, acc_x, acc_y, acc_z, gyro_x, gyro_y, gyro_z), every 100 ms.
Raw counts use the firmware v1 ranges: +/-2 g (16384 counts/g), +/-250 dps (131 counts/dps).

All data produced here is SYNTHETIC. It is not a recording of any person.

Uses only the Python standard library (no numpy needed).

Examples (Windows PowerShell):
  python tools\\band_simulator.py --mode rest
  python tools\\band_simulator.py --mode tremor5 --seconds 30
  python tools\\band_simulator.py --dump packets.bin --count 50   (writes packets to a file, no network)
"""
import argparse
import math
import random
import socket
import struct
import time

FRAME = struct.Struct("<Ihhhhhh")  # identical to esp8266_receiver.py
FRAMES_PER_PACKET = 10
ACC_PER_G = 16384
GYRO_PER_DPS = 131

# Each mode returns (ax, ay, az) in g and (gx, gy, gz) in deg/s for time t (seconds).
# These shapes are illustrative test signals only, not models of any disease.
def signal_at(mode, t, rng):
    noise = lambda s: rng.gauss(0.0, s)
    if mode == "rest":
        acc = (noise(0.003), noise(0.003), 1.0 + noise(0.003))
        gyr = (noise(0.3), noise(0.3), noise(0.3))
    elif mode == "tremor5":  # 5 Hz oscillation, small amplitude
        w = 2 * math.pi * 5.0 * t
        acc = (0.05 * math.sin(w) + noise(0.003), 0.02 * math.sin(w + 1) + noise(0.003), 1.0 + noise(0.003))
        gyr = (20 * math.sin(w + 0.5) + noise(0.3), 8 * math.sin(w) + noise(0.3), noise(0.3))
    elif mode == "tremor7":  # 7 Hz oscillation, small amplitude
        w = 2 * math.pi * 7.0 * t
        acc = (0.02 * math.sin(w) + noise(0.003), 0.06 * math.sin(w) + noise(0.003), 1.0 + noise(0.003))
        gyr = (5 * math.sin(w) + noise(0.3), 15 * math.sin(w + 0.3) + noise(0.3), noise(0.3))
    elif mode == "shake":  # vigorous 3-4 Hz shaking, will clip at +/-2 g like the real sensor
        w = 2 * math.pi * (3.5 + 0.3 * math.sin(0.5 * t)) * t
        acc = (1.6 * math.sin(w) + noise(0.05), 1.2 * math.sin(w + 0.7) + noise(0.05), 1.0 + 0.8 * math.sin(w + 1.3))
        gyr = (200 * math.sin(w) + noise(2), 150 * math.sin(w + 0.4) + noise(2), 90 * math.sin(w + 1.0) + noise(2))
    else:
        raise ValueError(mode)
    return acc, gyr


def to_counts(value, scale):
    # Same saturation as a real int16 sensor register.
    return max(-32768, min(32767, int(round(value * scale))))


def make_packet(mode, start_ms, sample_index, rng):
    frames = []
    for i in range(FRAMES_PER_PACKET):
        n = sample_index + i
        t = n / 100.0
        (ax, ay, az), (gx, gy, gz) = signal_at(mode, t, rng)
        frames.append(FRAME.pack(
            (start_ms + n * 10) & 0xFFFFFFFF,
            to_counts(ax, ACC_PER_G), to_counts(ay, ACC_PER_G), to_counts(az, ACC_PER_G),
            to_counts(gx, GYRO_PER_DPS), to_counts(gy, GYRO_PER_DPS), to_counts(gz, GYRO_PER_DPS),
        ))
    return b"".join(frames)


def main():
    p = argparse.ArgumentParser(description="SYNTHETIC wristband UDP simulator")
    p.add_argument("--host", default="127.0.0.1", help="destination IP (127.0.0.1 for the emulator redirect)")
    p.add_argument("--port", type=int, default=8888)
    p.add_argument("--mode", default="rest", choices=["rest", "tremor5", "tremor7", "shake"])
    p.add_argument("--seconds", type=float, default=0, help="0 = run until Ctrl+C")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--dump", help="write packets to this file instead of sending")
    p.add_argument("--count", type=int, default=30, help="packets to write with --dump")
    p.add_argument("--drop-every", type=int, default=0, help="skip every Nth packet to test gap detection")
    args = p.parse_args()

    rng = random.Random(args.seed)
    start_ms = 5000  # pretend the band has been on for 5 s

    if args.dump:
        with open(args.dump, "wb") as fh:
            for k in range(args.count):
                fh.write(make_packet(args.mode, start_ms, k * FRAMES_PER_PACKET, rng))
        print(f"[SYNTHETIC] wrote {args.count} packets ({args.count * 160} bytes) to {args.dump}")
        return

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    print(f"[SYNTHETIC] sending mode='{args.mode}' to {args.host}:{args.port}  (Ctrl+C to stop)")
    sent = 0
    k = 0
    next_time = time.perf_counter()
    try:
        while args.seconds == 0 or k * 0.1 < args.seconds:
            pkt = make_packet(args.mode, start_ms, k * FRAMES_PER_PACKET, rng)
            if not (args.drop_every and (k + 1) % args.drop_every == 0):
                sock.sendto(pkt, (args.host, args.port))
                sent += 1
            k += 1
            if k % 50 == 0:
                print(f"[SYNTHETIC] {sent} packets sent ({k * 0.1:.0f} s)")
            next_time += 0.1
            time.sleep(max(0.0, next_time - time.perf_counter()))
    except KeyboardInterrupt:
        pass
    print(f"[SYNTHETIC] stopped after {sent} packets")


if __name__ == "__main__":
    main()
