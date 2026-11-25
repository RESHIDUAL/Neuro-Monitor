// Dashboard, modelled on the reference layout: greeting, four pastel summary cards, today's timeline.
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { C, R } from '../theme';
import { Screen, Card, Small, Row, Btn, ProvenanceBadges, Disclaimer } from '../ui/kit';
import { useApp, useHubStatus } from '../state';
import { listSessions, getSessionResults, listDoses, SessionRow, ActivityResultRow, DoseRow } from '../data/db';
import { coreSummary, patternSentence, pct } from '../test/summary';
import { sourceLabel } from '../stream/hub';
import { PROFILES } from '../signal/preprocess';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function HomeScreen({ go }: { go: (tab: string) => void }) {
  const { settings, dataVersion } = useApp();
  const status = useHubStatus();
  const [session, setSession] = useState<SessionRow | null>(null);
  const [rows, setRows] = useState<ActivityResultRow[]>([]);
  const [doses, setDoses] = useState<DoseRow[]>([]);

  useEffect(() => {
    (async () => {
      const s = (await listSessions())[0] ?? null;
      setSession(s);
      setRows(s ? await getSessionResults(s.id) : []);
      const start = new Date(); start.setHours(0, 0, 0, 0);
      setDoses(await listDoses(start.getTime()));
    })();
  }, [dataVersion]);

  const streaming = Date.now() - status.lastSampleAt < 1500;
  const summary = session ? coreSummary(rows, session.profile) : null;
  const coreRows = rows.filter((r) => r.section === 'core' && r.accel_rms_g !== null);
  const maxRms = Math.max(0.001, ...coreRows.map((r) => r.accel_rms_g ?? 0));
  const lastDose = doses[0];

  const timeline = [
    ...doses.map((d) => ({ t: d.taken_at, title: `${d.name} taken`, sub: d.dose || 'Dose logged', color: C.green })),
    ...(session && new Date(session.started_at).toDateString() === new Date().toDateString()
      ? [{ t: session.started_at, title: 'Guided test', sub: summary ? patternSentence(summary.pattern) : 'No valid windows', color: C.yellow }]
      : []),
  ].sort((a, b) => b.t - a.t);

  return (
    <Screen title={`${greeting()}${settings.patientName ? `, ${settings.patientName}` : ''}`}
      subtitle={`${streaming ? `Streaming: ${sourceLabel(status.dataSource)}` : 'Band not connected'} · ${doses.length} dose${doses.length === 1 ? '' : 's'} logged today${session ? ` · last test ${new Date(session.started_at).toLocaleDateString()}` : ''}`}>
      <Disclaimer />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Card color={C.yellow} title="Latest test" style={{ flex: 1 }}>
          {summary ? (
            <>
              <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink }}>{summary.pattern === 'Normal' ? 'Normal pattern' : `${summary.pattern} pattern`}</Text>
              <Small>N {pct(summary.pNormal)} · PD {pct(summary.pPd)} · ET {pct(summary.pEt)}</Small>
              <Small>{summary.validWindows} core windows</Small>
            </>
          ) : <Small>No test yet.</Small>}
        </Card>
        <Card color={C.pink} title="Band" style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink }}>{streaming ? 'Streaming' : 'Offline'}</Text>
          <Small>{status.packetsPerSecond.toFixed(0)} packets/s · gaps {status.continuity.gaps}</Small>
          <Small>{status.sender || 'waiting'}</Small>
        </Card>
      </View>

      {session ? (
        <Card color={C.white}>
          <ProvenanceBadges source={session.data_source} profileShort={PROFILES[session.profile]?.short} />
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Card color={C.green} title="Doses today" style={{ flex: 1 }}>
          <Text style={{ fontSize: 26, fontWeight: '800', color: C.ink }}>{doses.length}</Text>
          <Small>{lastDose ? `Last: ${lastDose.name} at ${new Date(lastDose.taken_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'None logged'}</Small>
        </Card>
        <Card color={C.blue} title="Seizure-like" style={{ flex: 1 }}>
          <Text style={{ fontSize: 26, fontWeight: '800', color: C.ink }}>{summary ? summary.seizureLikeWindows : 0}</Text>
          <Small>seizure-like windows in latest test (simulated-data model)</Small>
        </Card>
      </View>

      <Card color={C.white} title="Amplitude by activity (latest core test)">
        {coreRows.length === 0 ? <Small>No core test yet.</Small> : coreRows.map((r) => (
          <View key={r.id} style={{ marginVertical: 4 }}>
            <Row label={r.activity_name} value={`${r.accel_rms_g!.toFixed(3)} g · ${r.dominant_hz!.toFixed(1)} Hz`} />
            <View style={{ height: 8, borderRadius: 4, backgroundColor: C.cream, overflow: 'hidden' }}>
              <View style={{ height: 8, width: `${((r.accel_rms_g ?? 0) / maxRms) * 100}%`, backgroundColor: C.accent, borderRadius: 4 }} />
            </View>
          </View>
        ))}
        <Small>Calculated acceleration RMS per activity (not a clinical severity score).</Small>
      </Card>

      <Card color={C.white} title="Today's timeline">
        {timeline.length === 0 ? <Small>Nothing logged today.</Small> : timeline.map((e, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
            <Text style={{ width: 52, fontSize: 12, color: C.muted }}>{new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
            <View style={{ flex: 1, backgroundColor: e.color, borderRadius: R.small, padding: 10 }}>
              <Text style={{ fontWeight: '800', color: C.ink }}>{e.title}</Text>
              <Small>{e.sub}</Small>
            </View>
          </View>
        ))}
      </Card>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Btn title="Start guided test" onPress={() => go('test')} /></View>
        <View style={{ flex: 1 }}><Btn title="Log a dose" kind="light" onPress={() => go('meds')} /></View>
      </View>
    </Screen>
  );
}
