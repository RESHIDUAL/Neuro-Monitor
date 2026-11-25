// Pick a finished guided-test session, preview it, and export the neurologist PDF.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { C } from '../theme';
import { Screen, Card, Btn, Chip, Small } from '../ui/kit';
import { useApp } from '../state';
import { listSessions, getSessionResults, listDoses, lastDoseBefore, SessionRow, ActivityResultRow } from '../data/db';
import { SessionResults } from '../ui/results';
import { buildReportHtml, shareReportPdf } from '../report/pdf';

export default function ReportScreen() {
  const { settings, dataVersion } = useApp();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState<SessionRow | null>(null);
  const [rows, setRows] = useState<ActivityResultRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    listSessions().then((s) => { setSessions(s); setSelected((cur) => cur ?? s[0] ?? null); });
  }, [dataVersion]);
  useEffect(() => { if (selected) getSessionResults(selected.id).then(setRows); }, [selected]);

  async function exportPdf() {
    if (!selected) return;
    setBusy(true); setMsg('');
    try {
      const doses = await listDoses(selected.started_at - 7 * 24 * 3600 * 1000);
      const lastDose = await lastDoseBefore(selected.started_at);
      const html = buildReportHtml({ settings, session: selected, rows, doses: doses.filter((d) => d.taken_at <= selected.started_at), lastDose });
      const uri = await shareReportPdf(html);
      setMsg(`PDF created: ${uri.split('/').pop()}`);
    } catch (e) { setMsg(`Could not create PDF: ${String(e)}`); }
    setBusy(false);
  }

  return (
    <Screen title="Neurologist report" subtitle="PDF summary of a guided test, with medication timing and limitations.">
      {sessions.length === 0 ? (
        <Card color={C.blue}><Small>No finished guided tests yet. Run one from the Test tab.</Small></Card>
      ) : (
        <>
          <Card color={C.blue} title="Choose a test">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {sessions.slice(0, 8).map((s) => (
                <Chip key={s.id} label={new Date(s.started_at).toLocaleString()} selected={selected?.id === s.id} onPress={() => setSelected(s)} />
              ))}
            </View>
            <Btn title={busy ? 'Creating PDF...' : 'Create and share PDF'} onPress={exportPdf} disabled={busy || !selected} kind="accent" />
            {msg ? <Small>{msg}</Small> : null}
          </Card>
          {selected ? <SessionResults session={selected} rows={rows} /> : null}
        </>
      )}
    </Screen>
  );
}
