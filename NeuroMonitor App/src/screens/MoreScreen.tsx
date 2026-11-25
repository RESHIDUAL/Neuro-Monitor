// Settings, data source, preprocessing profile, sensor scale, self-test and about.
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { C } from '../theme';
import { Screen, Card, Chip, Small, Row, Btn, Badge } from '../ui/kit';
import { useApp, useHubStatus } from '../state';
import { PROFILES } from '../signal/preprocess';
import { SCALES, ScaleId } from '../protocol/units';
import { sourceLabel, UDP_PORT } from '../stream/hub';
import { runModelSelfTest, ModelCheckResult } from '../selftest/modelSelfTest';
import { MODEL_FILES } from '../ml/runner';

export default function MoreScreen() {
  const { settings, update } = useApp();
  const status = useHubStatus();
  const [selfTest, setSelfTest] = useState<ModelCheckResult[] | null>(null);
  const [running, setRunning] = useState(false);

  return (
    <Screen title="Settings" subtitle="Patient profile, data source, model preprocessing and checks.">
      <Card color={C.white} title="Patient profile">
        <TextInput style={inp} placeholder="Name or ID" value={settings.patientName} onChangeText={(v) => update('patientName', v)} />
        <TextInput style={inp} placeholder="Age" keyboardType="number-pad" value={settings.patientAge} onChangeText={(v) => update('patientAge', v)} />
        <TextInput style={inp} placeholder="Caregiver name and phone (optional)" value={settings.caregiver} onChangeText={(v) => update('caregiver', v)} />
        <Small>Band wrist</Small>
        <View style={{ flexDirection: 'row' }}>
          <Chip label="Left" selected={settings.wrist === 'left'} onPress={() => update('wrist', 'left')} />
          <Chip label="Right" selected={settings.wrist === 'right'} onPress={() => update('wrist', 'right')} />
        </View>
      </Card>

      <Card color={C.pink} title="Data source">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip label="Wi-Fi wristband (UDP)" selected={settings.sourceKind === 'udp'} onPress={() => update('sourceKind', 'udp')} />
          <Chip label="In-app demo signal" selected={settings.sourceKind === 'demo'} onPress={() => update('sourceKind', 'demo')} />
        </View>
        {settings.sourceKind === 'udp' ? (
          <Small>Listening on UDP port {UDP_PORT}. Turn on the phone hotspot (2.4 GHz) with the band's Wi-Fi name and password, then power the band.</Small>
        ) : (
          <>
            <Badge text="DEMO: synthetic signal, not a real person" tone="warn" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {(['rest', 'tremor5', 'tremor7', 'shake'] as const).map((m) => (
                <Chip key={m} label={{ rest: 'Rest', tremor5: '5 Hz signal', tremor7: '7 Hz signal', shake: 'Vigorous shaking' }[m]}
                  selected={settings.demoMode === m} onPress={() => update('demoMode', m)} />
              ))}
            </View>
          </>
        )}
        <Row label="Current" value={sourceLabel(status.dataSource)} />
        <Row label="Sender" value={status.sender || 'none yet'} />
        <Row label="Packets/s · gaps · rejected" value={`${status.packetsPerSecond.toFixed(0)} · ${status.continuity.gaps} · ${status.rejected}`} />
        {status.error ? <Small color={C.danger}>{status.error}</Small> : null}
        <Small>Feedback packets to the band are disabled until its display wording uses "-like pattern" labels.</Small>
      </Card>

      <Card color={C.yellow} title="Preprocessing">
        <Badge text="Confirmed: matches the model team's training notebooks" tone="ok" />
        <Text style={{ fontSize: 13, fontWeight: '700', color: C.ink, marginTop: 6 }}>{PROFILES.config.name}</Text>
        {PROFILES.config.description.map((d, i) => <Small key={i}>· {d}</Small>)}
      </Card>

      <Card color={C.green} title="Sensor range (firmware)">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {(Object.keys(SCALES) as ScaleId[]).map((id) => (
            <Chip key={id} label={SCALES[id].label} selected={settings.scale === id} onPress={() => update('scale', id)} />
          ))}
        </View>
        <Small>Must match the band's firmware. Current firmware v1 uses +/-2 g and +/-250 dps.</Small>
        {status.last ? <Row label="|a| now (about 1.00 g when still)" value={Math.hypot(status.last.ax, status.last.ay, status.last.az).toFixed(3)} /> : null}
      </Card>

      <Card color={C.blue} title="Model self-test">
        <Small>Runs both models on a zero input and compares with the LiteRT reference.</Small>
        <Btn title={running ? 'Running...' : 'Run model self-test'} disabled={running}
          onPress={async () => { setRunning(true); setSelfTest(await runModelSelfTest()); setRunning(false); }} />
        {selfTest?.map((r) => <Small key={r.name}>{r.pass ? 'PASS' : 'FAIL'} · {r.name}: {r.detail}</Small>)}
      </Card>

      <Card color={C.cream} title="About">
        <Small>Neuro Monitor, academic prototype for an MSc Neural Networks and Deep Learning project.</Small>
        <Small>Track 1: {MODEL_FILES.track1.file} (Normal / Parkinsons-like / ET-like), trained on PADS Apple Watch data.</Small>
        <Small>Track 2: {MODEL_FILES.track2.file} (Seizure-like), trained on acted seizures (UEA dataset).</Small>
        <Small color={C.warn}>Screening aid only. Not a diagnosis. Not a life-safety device. Never use it to change medication.</Small>
        {settings.consentAt ? <Small>Consent recorded {new Date(Number(settings.consentAt)).toLocaleString()}.</Small> : null}
      </Card>
    </Screen>
  );
}

const inp = {
  borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  fontSize: 15, marginTop: 8, backgroundColor: C.bg, color: C.ink,
} as const;
