// One place that owns the incoming sensor stream, whichever source it comes from.
// Sources: Wi-Fi band over UDP (labelled LIVE_BAND, or SIMULATOR when it comes from the laptop
// simulator), or the in-app DEMO generator. Every sample batch carries its source label.
import dgram from 'react-native-udp';
import { decodePacket, updateContinuity, newContinuityState, ContinuityState } from '../protocol/packet';
import { toPhysical, PhysicalSample } from '../protocol/units';

export const UDP_PORT = 8888;
export type DataSource = 'LIVE_BAND' | 'SIMULATOR' | 'DEMO';
export type SourceKind = 'udp' | 'demo';
export type DemoMode = 'rest' | 'tremor5' | 'tremor7' | 'shake';

export type HubStatus = {
  kind: SourceKind;
  listening: boolean;
  error: string;
  dataSource: DataSource | null; // label of the most recent data
  sender: string;
  packets: number;
  rejected: number;
  lastRejectedSize: number | null;
  packetsPerSecond: number;
  continuity: ContinuityState;
  lastSampleAt: number; // phone clock, ms
  last: PhysicalSample | null;
};

type SampleListener = (batch: PhysicalSample[], source: DataSource) => void;

const BUFFER = 3000; // 30 s at 100 Hz

class StreamHub {
  private status: HubStatus = this.fresh('udp');
  private buffer: PhysicalSample[] = [];
  private statusListeners = new Set<(s: HubStatus) => void>();
  private sampleListeners = new Set<SampleListener>();
  private stopSource: (() => void) | null = null;
  private arrivals: number[] = [];
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  demoMode: DemoMode = 'rest';

  private fresh(kind: SourceKind): HubStatus {
    return {
      kind, listening: false, error: '', dataSource: null, sender: '', packets: 0, rejected: 0,
      lastRejectedSize: null, packetsPerSecond: 0, continuity: newContinuityState(), lastSampleAt: 0, last: null,
    };
  }

  start(kind: SourceKind) {
    this.stopSource?.();
    this.status = this.fresh(kind);
    this.buffer = [];
    this.arrivals = [];
    this.stopSource = kind === 'udp' ? this.startUdp() : this.startDemo();
    if (!this.timer) {
      this.timer = setInterval(() => {
        if (this.dirty) {
          this.dirty = false;
          const s = { ...this.status };
          this.statusListeners.forEach((l) => l(s));
        }
      }, 250);
    }
    this.dirty = true;
  }

  getStatus(): HubStatus { return { ...this.status }; }
  getBuffer(): PhysicalSample[] { return this.buffer; }
  isStreaming(): boolean { return Date.now() - this.status.lastSampleAt < 1500; }

  onStatus(l: (s: HubStatus) => void): () => void {
    this.statusListeners.add(l);
    l({ ...this.status });
    return () => { this.statusListeners.delete(l); };
  }

  onSamples(l: SampleListener): () => void {
    this.sampleListeners.add(l);
    return () => { this.sampleListeners.delete(l); };
  }

  private ingest(batch: PhysicalSample[], source: DataSource) {
    const now = Date.now();
    this.arrivals.push(now);
    while (this.arrivals.length && now - this.arrivals[0] > 2000) this.arrivals.shift();
    this.buffer.push(...batch);
    if (this.buffer.length > BUFFER) this.buffer.splice(0, this.buffer.length - BUFFER);
    this.status = {
      ...this.status,
      dataSource: source,
      packets: this.status.packets + 1,
      packetsPerSecond: this.arrivals.length / 2,
      lastSampleAt: now,
      last: batch[batch.length - 1],
    };
    this.dirty = true;
    this.sampleListeners.forEach((l) => l(batch, source));
  }

  // Receive-only. Feedback packets to the band are deliberately not implemented
  // until the band's OLED wording is changed to "-like pattern" labels.
  private startUdp(): () => void {
    const socket = dgram.createSocket({ type: 'udp4' }) as unknown as {
      on(event: string, listener: (...args: any[]) => void): void;
      bind(port: number): void;
      close(): void;
    };
    socket.on('error', (err: unknown) => { this.status = { ...this.status, error: String(err) }; this.dirty = true; });
    socket.on('listening', () => { this.status = { ...this.status, listening: true }; this.dirty = true; });
    socket.on('message', (msg: Uint8Array, rinfo: { address: string; port: number }) => {
      const res = decodePacket(new Uint8Array(msg));
      if (!res.ok) {
        this.status = { ...this.status, rejected: this.status.rejected + 1, lastRejectedSize: res.byteLength };
        this.dirty = true;
        return;
      }
      const isSim = rinfo.address === '10.0.2.2' || rinfo.address === '127.0.0.1';
      this.status = {
        ...this.status,
        sender: `${rinfo.address}:${rinfo.port}`,
        continuity: updateContinuity(this.status.continuity, res.frames),
      };
      this.ingest(res.frames.map(toPhysical), isSim ? 'SIMULATOR' : 'LIVE_BAND');
    });
    try { socket.bind(UDP_PORT); } catch (e) { this.status = { ...this.status, error: String(e) }; }
    return () => { try { socket.close(); } catch { /* closed */ } };
  }

  // In-app synthetic generator, 10 samples every 100 ms, labelled DEMO everywhere.
  private startDemo(): () => void {
    let n = 0;
    let seed = 12345;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const gauss = (s: number) => s * Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
    this.status = { ...this.status, listening: true, sender: 'in-app demo generator' };
    const d2r = Math.PI / 180;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const batch: PhysicalSample[] = [];
      const due = Math.floor((Date.now() - startedAt) / 10); // samples that should exist by now
      while (n < due) {
        const t = n / 100;
        let a = [gauss(0.003), gauss(0.003), 1 + gauss(0.003)];
        let g = [gauss(0.3), gauss(0.3), gauss(0.3)];
        if (this.demoMode === 'tremor5') {
          const w = 2 * Math.PI * 5 * t;
          a = [0.05 * Math.sin(w) + a[0], 0.02 * Math.sin(w + 1) + a[1], a[2]];
          g = [20 * Math.sin(w + 0.5) + g[0], 8 * Math.sin(w) + g[1], g[2]];
        } else if (this.demoMode === 'tremor7') {
          const w = 2 * Math.PI * 7 * t;
          a = [0.02 * Math.sin(w) + a[0], 0.06 * Math.sin(w) + a[1], a[2]];
          g = [5 * Math.sin(w) + g[0], 15 * Math.sin(w + 0.3) + g[1], g[2]];
        } else if (this.demoMode === 'shake') {
          const w = 2 * Math.PI * 3.6 * t;
          a = [1.6 * Math.sin(w), 1.2 * Math.sin(w + 0.7), 1 + 0.8 * Math.sin(w + 1.3)].map((v) => Math.max(-2, Math.min(2, v)));
          g = [200 * Math.sin(w), 150 * Math.sin(w + 0.4), 90 * Math.sin(w + 1)];
        }
        batch.push({ t: 5000 + n * 10, ax: a[0], ay: a[1], az: a[2], gx: g[0] * d2r, gy: g[1] * d2r, gz: g[2] * d2r });
        n++;
      }
      // deliver in packet-sized chunks of 10 samples, like the band
      for (let k = 0; k + 10 <= batch.length; k += 10) this.ingest(batch.slice(k, k + 10), 'DEMO');
      const rest = batch.length % 10;
      if (rest) { n -= rest; }
    }, 100);
    return () => clearInterval(timer);
  }
}

export const hub = new StreamHub();

export function sourceLabel(s: DataSource | null): string {
  if (s === 'LIVE_BAND') return 'Live wristband';
  if (s === 'SIMULATOR') return 'Laptop simulator (SYNTHETIC)';
  if (s === 'DEMO') return 'In-app demo signal (SYNTHETIC)';
  return 'No data';
}
