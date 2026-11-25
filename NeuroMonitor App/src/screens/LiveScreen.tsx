// Live monitor: raw signal, calculated measures and model output, shown in three clearly separate cards.
// A new 3 s window is evaluated every second (hop of 100 samples, as in the Python receiver).
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Polyline, Line } from 'react-native-svg';
import { useKeepAwake } from 'expo-keep-awake';
import { C } from '../theme';
import { Screen, Card, Row, Small, ProbBar, ProvenanceBadges, Badge } from '../ui/kit';
import { useApp, useHubStatus } from '../state';
import { hub } from '../stream/hub';
import { computeMeasures, Measures } from '../signal/measures';
import { latestWindow, frameTiming } from '../signal/regrid';
import { predictWindow, WindowPrediction } from '../ml/runner';
import { PROFILES, ProfileId } from '../signal/preprocess';
import { patternSentence } from '../test/summary';
import type { PhysicalSample } from '../protocol/units';

const W = 320;
const H = 140;
const SHOW = 400; // last 4 s

function path(data: PhysicalSample[], key: 'ax' | 'ay' | 'az', scale: number) {
  if (data.length < 2) return '';
  const m = data.reduce((s, p) => s + p[key], 0) / data.length;
  return data.map((p, i) => `${((i / (SHOW - 1)) * W).toFixed(1)},${(H / 2 - (p[key] - m) * scale).toFixed(1)}`).join(' ');
}

export default function LiveScreen() {
  useKeepAwake();
  const { settings } = useApp();
  const status = useHubStatus();
  const profile = settings.profile as ProfileId | '';
  const [view, setView] = useState<PhysicalSample[]>([]);
  const [measures, setMeasures] = useState<Measures | null>(null);
  const [pred, setPred] = useState<WindowPrediction | null>(null);
  const [predError, setPredError] = useState('');
  const [seizureWindows, setSeizureWindows] = useState(0);

  // Redraw the waveform 5 times per second.
  useEffect(() => {
    const t = setInterval(() => setView(hub.getBuffer().slice(-SHOW)), 200);
    return () => clearInterval(t);
  }, []);

  // Evaluate the latest 3 s window once per second.
  useEffect(() => {
    let busy = false;
    const t = setInterval(async () => {
      const buf = hub.getBuffer();
      if (busy || buf.length < 2 || !hub.isStreaming()) return;
      const w = latestWindow(buf); // even 100 Hz grid rebuilt from band timestamps
      if (!w) return;
      busy = true;
      setMeasures(computeMeasures(w));
      if (profile) {
        try {
          const p = await predictWindow(profile, w);
          setPred(p);
          setPredError('');
          if (p.seizureLike) setSeizureWindows((n) => n + 1);
        } catch (e) { setPredError(String(e)); }
      }
      busy = false;
    }, 1000);
    return () => clearInterval(t);
  }, [profile]);

  const amp = view.length ? Math.max(0.02, ...view.map((p) => Math.abs(p.ax) + Math.abs(p.ay))) : 1;
  const scale = (H / 2 - 6) / Math.min(2.5, amp);

  return (
    <Screen title="Live monitor" subtitle="Updates every second from the latest 3 seconds of data.">
      <Card color={C.white} title="1. Raw sensor signal">
        <ProvenanceBadges source={status.dataSource} />
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: 8 }}>
          <Line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke={C.line} strokeWidth="1" />
          <Polyline points={path(view, 'ax', scale)} fill="none" stroke="#C2185B" strokeWidth="1.5" />
          <Polyline points={path(view, 'ay', scale)} fill="none" stroke="#2E7D32" strokeWidth="1.5" />
          <Polyline points={path(view, 'az', scale)} fill="none" stroke="#1F3A93" strokeWidth="1.5" />
        </Svg>
        <Small>Acceleration x (pink), y (green), z (blue), mean removed, last 4 s.</Small>
        {status.last ? (
          <Row label="Latest accel (g)" value={`${status.last.ax.toFixed(2)}, ${status.last.ay.toFixed(2)}, ${status.last.az.toFixed(2)}`} />
        ) : <Small>No data yet.</Small>}
        <Row label="Packets per second / gaps" value={`${status.packetsPerSecond.toFixed(0)} / ${status.continuity.gaps}`} />
        {(() => {
          const ft = frameTiming(view);
          return ft ? (
            <>
              <Row label="Band sample rate" value={`${ft.ratePerSec.toFixed(0)} Hz (target 100)`} />
              <Row label="Frame step median / max" value={`${ft.medianMs} / ${ft.maxMs} ms`} />
            </>
          ) : null;
        })()}
      </Card>

      <Card color={C.green} title="2. Calculated measures (not model output)">
        {measures ? (
          <>
            <Row label="Acceleration amplitude (RMS)" value={`${measures.accelRmsG.toFixed(3)} g`} />
            <Row label="Rotation amplitude (RMS)" value={`${measures.gyroRmsRad.toFixed(3)} rad/s`} />
            <Row label="Dominant frequency (1-15 Hz)" value={`${measures.dominantHz.toFixed(1)} Hz`} />
          </>
        ) : <Small>Waiting for 3 seconds of usable data (no hole longer than 50 ms).</Small>}
        <Small>Signal-processing values. No clinical severity scale is applied.</Small>
      </Card>

      <Card color={C.yellow} title="3. Model output">
        {!profile ? <Small color={C.danger}>Choose a preprocessing profile in More → Settings to enable model output.</Small> : null}
        {profile ? <ProvenanceBadges source={status.dataSource} profileShort={PROFILES[profile].short} /> : null}
        {pred ? (
          <>
            <Text style={{ fontSize: 16, fontWeight: '800', color: C.ink, marginTop: 8 }}>{patternSentence(pred.track1Pattern)}</Text>
            <ProbBar label="Normal" value={pred.pNormal} />
            <ProbBar label="Parkinsons-like" value={pred.pPd} />
            <ProbBar label="ET-like" value={pred.pEt} />
            <View style={{ height: 8 }} />
            <ProbBar label="Seizure-like (simulated-data model)" value={pred.pSeizure} color={C.danger} />
            {pred.seizureLike ? (
              <Badge text="Seizure-like movement in this window. Needs attention and assessment. Not a confirmed seizure." tone="danger" />
            ) : null}
            <Row label="Seizure-like windows this session" value={String(seizureWindows)} />
          </>
        ) : profile ? <Small>Waiting for the first window...</Small> : null}
        {predError ? <Small color={C.danger}>{predError}</Small> : null}
        <Small color={C.warn}>Live results use activity-independent windows and are not a guided test. Screening aid only. Not a diagnosis.</Small>
      </Card>
    </Screen>
  );
}
