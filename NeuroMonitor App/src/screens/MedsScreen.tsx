// Medication log: record medicines and when doses are taken.
// The app only records times. It never suggests changing a medicine or a dose.
import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { C } from '../theme';
import { Screen, Card, Btn, Small, Row } from '../ui/kit';
import { useApp } from '../state';
import { addMedication, archiveMedication, listDoses, listMedications, logDose, MedicationRow, DoseRow } from '../data/db';

export default function MedsScreen() {
  const { dataVersion, bump } = useApp();
  const [meds, setMeds] = useState<MedicationRow[]>([]);
  const [doses, setDoses] = useState<DoseRow[]>([]);
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [schedule, setSchedule] = useState('');
  const [note, setNote] = useState('');

  async function reload() {
    setMeds(await listMedications());
    setDoses(await listDoses(Date.now() - 7 * 24 * 3600 * 1000));
  }
  useEffect(() => { reload(); }, [dataVersion]);

  async function add() {
    if (!name.trim()) return;
    await addMedication(name.trim(), dose.trim(), schedule.trim());
    setName(''); setDose(''); setSchedule('');
    bump();
  }

  return (
    <Screen title="Medications" subtitle="Record prescribed medicines and dose times. Used to show symptoms against dose timing in the report.">
      <Card color={C.green} title="Log a dose taken now">
        {meds.length === 0 ? <Small>No medicines added yet.</Small> : null}
        {meds.map((m) => (
          <View key={m.id} style={{ borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.1)', paddingTop: 8, marginTop: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink }}>{m.name}</Text>
            <Small>{[m.dose, m.schedule].filter(Boolean).join(' · ') || 'No dose details'}</Small>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Btn title="Taken now" onPress={async () => { await logDose(m.id); setNote(`${m.name} logged at ${new Date().toLocaleTimeString()}`); bump(); }} />
              </View>
              <View style={{ flex: 1 }}>
                <Btn title="Remove" kind="light" onPress={async () => { await archiveMedication(m.id); bump(); }} />
              </View>
            </View>
          </View>
        ))}
        {note ? <Small>{note}</Small> : null}
      </Card>

      <Card color={C.white} title="Add a medicine">
        <TextInput style={inp} placeholder="Medicine name (as prescribed)" value={name} onChangeText={setName} />
        <TextInput style={inp} placeholder="Prescribed dose, e.g. 100 mg" value={dose} onChangeText={setDose} />
        <TextInput style={inp} placeholder="Schedule, e.g. 8 am, 2 pm, 8 pm" value={schedule} onChangeText={setSchedule} />
        <Btn title="Add medicine" onPress={add} disabled={!name.trim()} />
        <Small>Enter details exactly as prescribed. This app does not give dosing advice.</Small>
      </Card>

      <Card color={C.cream} title="Last 7 days">
        {doses.length === 0 ? <Small>No doses logged.</Small> : null}
        {doses.map((d) => (
          <Row key={d.id} label={`${d.name}${d.dose ? ` (${d.dose})` : ''}`} value={new Date(d.taken_at).toLocaleString()} />
        ))}
      </Card>
    </Screen>
  );
}

const inp = {
  borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  fontSize: 15, marginTop: 8, backgroundColor: C.bg, color: C.ink,
} as const;
