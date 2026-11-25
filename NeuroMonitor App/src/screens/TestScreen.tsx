// Guided activity test.
// Core section: five PADS training-aligned activities, 30 s each -> main result.
// Contextual section (optional): drinking, writing, walking -> recorded and labelled separately.
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { C } from '../theme';
import { Screen, Card, Btn, Chip, Small, Row, Badge, ProvenanceBadges } from '../ui/kit';
import { useApp, useHubStatus } from '../state';
import { hub, DataSource, sourceLabel } from '../stream/hub';
import type { PhysicalSample } from '../protocol/units';
import { Activity, CORE_ACTIVITIES, CONTEXTUAL_ACTIVITIES, CONTEXTUAL_LABEL, TRIM_SAMPLES } from '../test/activities';
import { createSession, finishSession, saveActivityResult, getSessionResults, listSessions, SessionRow, ActivityResultRow } from '../data/db';
import { predictWindow } from '../ml/runner';
import { computeMeasures } from '../signal/measures';
import { activityWindows } from '../signal/regrid';
import { PROFILES, ProfileId } from '../signal/preprocess';
import { SessionResults } from '../ui/results';

type Phase = 'setup' | 'instruct' | 'record' | 'processing' | 'contextual' | 'done';

export default function TestScreen() {
  useKeepAwake();
  const { settings, update, bump } = useApp();
  const status = useHubStatus();
  const [phase, setPhase] = useState<Phase>('setup');
  const [queue, setQueue] = useState<Activity[]>([]);
  const [current, setCurrent] = useState<Activity | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<{ session: SessionRow; rows: ActivityResultRow[] } | null>(null);
  const samples = useRef<PhysicalSample[]>([]);
  const sources = useRef<Record<string, number>>({});

  const profile = settings.profile as ProfileId | '';
  const streaming = Date.now() - status.lastSampleAt < 1500;

  async function startCore() {
    if (!profile || !streaming || !settings.wrist) return;
    const id = await createSession(settings.wrist, status.dataSource ?? 'DEMO', profile, settings.scale);
    setSessionId(id);
    setResult(null);
    beginActivity(CORE_ACTIVITIES[0], CORE_ACTIVITIES.slice(1));
  }

  function beginActivity(a: Activity, rest: Activity[]) {
    setCurrent(a);
    setQueue(rest);
    setMessage('');
    setPhase('instruct');
  }

  // Recording: collect every sample from the hub for the activity's duration.
  useEffect(() => {
    if (phase !== 'record' || !current) return;
    samples.current = [];
    sources.current = {};
    const off = hub.onSamples((batch, src) => {
      samples.current.push(...batch);
      sources.current[src] = (sources.current[src] ?? 0) + batch.length;
    });
    const endAt = Date.now() + current.seconds * 1000;
    setRemaining(current.seconds);
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) { clearInterval(t); off(); processActivity(current); }
    }, 250);
    return () => { clearInterval(t); off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, current]);

  async function processActivity(a: Activity) {
    setPhase('processing');
    // Windows are rebuilt on an even 100 Hz grid from the band timestamps; holes > 50 ms are never bridged.
    const { windows, expected } = activityWindows(samples.current, TRIM_SAMPLES * 10);
    const nWin = Math.max(expected, windows.length);
    let valid = 0, pn = 0, ppd = 0, pet = 0, pse = 0, seizureLike = 0, arms = 0, grms = 0, hz = 0;
    for (const w of windows) {
      try {
        const p = await predictWindow(profile as ProfileId, w);
        const m = computeMeasures(w);
        valid++;
        pn += p.pNormal; ppd += p.pPd; pet += p.pEt; pse += p.pSeizure;
        if (p.seizureLike) seizureLike++;
        arms += m.accelRmsG; grms += m.gyroRmsRad; hz += m.dominantHz;
      } catch (e) {
        setMessage(`Model error: ${String(e)}`);
      }
    }
    const src = (Object.entries(sources.current).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'DEMO') as DataSource;
    const avg = (v: number) => (valid ? v / valid : null);
    await saveActivityResult({
      session_id: sessionId!, activity_id: a.id, activity_name: a.name, section: a.section, recorded_at: Date.now(),
      windows_total: nWin, windows_valid: valid, p_normal: avg(pn), p_pd: avg(ppd), p_et: avg(pet), p_seizure: avg(pse),
      seizure_like_windows: seizureLike, accel_rms_g: avg(arms), gyro_rms_rad: avg(grms), dominant_hz: avg(hz), data_source: src,
    });
    if (queue.length > 0) {
      beginActivity(queue[0], queue.slice(1));
    } else {
      setCurrent(null);
      setPhase('contextual');
    }
    if (valid === 0) setMessage(`"${a.name}": no usable data was received (check the band connection). Saved as no prediction.`);
  }

  async function finish() {
    if (sessionId === null) return;
    await finishSession(sessionId);
    const session = (await listSessions()).find((s) => s.id === sessionId)!;
    const rows = await getSessionResults(sessionId);
    setResult({ session, rows });
    setPhase('done');
    bump();
  }

  // ---------- views ----------
  if (phase === 'setup' || phase === 'done') {
    return (
      <Screen title="Guided test" subtitle="Five training-aligned activities, 30 seconds each (about 3 minutes). Optional contextual activities afterwards.">
        {phase === 'done' && result ? <SessionResults session={result.session} rows={result.rows} /> : null}
        <Card color={C.blue} title={phase === 'done' ? 'Start another test' : 'Before you start'}>
          <Row label="Data source" value={sourceLabel(status.dataSource)} />
          <Row label="Receiving data" value={streaming ? `yes (${status.packetsPerSecond.toFixed(0)} packets/s)` : 'no'} />
          <Row label="Preprocessing profile" value={profile ? PROFILES[profile].short : 'not selected'} />
          <Small>Wear the band on the more affected wrist (as in the training data). Band is on the:</Small>
          <View style={{ flexDirection: 'row' }}>
            <Chip label="Left wrist" selected={settings.wrist === 'left'} onPress={() => update('wrist', 'left')} />
            <Chip label="Right wrist" selected={settings.wrist === 'right'} onPress={() => update('wrist', 'right')} />
          </View>
          {!profile ? <Small color={C.danger}>Choose a preprocessing profile in More → Settings first.</Small> : null}
          {!streaming ? <Small color={C.danger}>No sensor data. Connect the band (or choose the demo signal in More → Settings).</Small> : null}
          {status.dataSource === 'DEMO' || status.dataSource === 'SIMULATOR' ? <Badge text="Synthetic data: results are for demonstration only" tone="warn" /> : null}
          <Btn title="Start core test" onPress={startCore} disabled={!profile || !streaming || !settings.wrist} />
        </Card>
      </Screen>
    );
  }

  if (phase === 'contextual') {
    return (
      <Screen title="Core test complete" subtitle="Optional: record contextual activities. These never change the main result.">
        <Card color={C.cream} title="Contextual activities (optional)">
          <Small color={C.warn}>{CONTEXTUAL_LABEL}</Small>
          {CONTEXTUAL_ACTIVITIES.map((a) => (
            <Btn key={a.id} kind="light" title={`Record: ${a.name}`} onPress={() => beginActivity(a, [])} />
          ))}
        </Card>
        {message ? <Small color={C.danger}>{message}</Small> : null}
        <Btn title="Finish and show results" onPress={finish} />
      </Screen>
    );
  }

  const a = current!;
  const coreIndex = CORE_ACTIVITIES.findIndex((x) => x.id === a.id);
  return (
    <Screen title={a.name} subtitle={a.section === 'core' ? `Core activity ${coreIndex + 1} of ${CORE_ACTIVITIES.length}` : 'Contextual activity (not validated)'}>
      <Card color={a.section === 'core' ? C.yellow : C.cream}>
        <Text style={{ fontSize: 17, color: C.ink, lineHeight: 24 }}>{a.instruction}</Text>
        {a.section === 'contextual' ? <Small color={C.warn}>{CONTEXTUAL_LABEL}</Small> : null}
      </Card>
      {phase === 'instruct' ? (
        <>
          {message ? <Small color={C.danger}>{message}</Small> : null}
          <Btn title={`Start ${a.seconds}-second recording`} onPress={() => setPhase('record')} disabled={!streaming} />
          {!streaming ? <Small color={C.danger}>No sensor data at the moment.</Small> : null}
        </>
      ) : null}
      {phase === 'record' ? (
        <Card color={C.pink}>
          <Text style={{ fontSize: 56, fontWeight: '800', color: C.ink, textAlign: 'center' }}>{remaining}</Text>
          <Small>seconds left. Keep the position. The first 2 seconds are discarded as settling time.</Small>
          <ProvenanceBadges source={status.dataSource} />
          {!streaming ? <Small color={C.danger}>Data stopped arriving. Windows with gaps will be discarded.</Small> : null}
        </Card>
      ) : null}
      {phase === 'processing' ? <Card color={C.blue}><Small>Running both models on the recorded windows...</Small></Card> : null}
    </Screen>
  );
}
