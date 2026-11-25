// Shows one guided-test session: core results (main summary) and contextual results, kept separate.
import { Text, View } from 'react-native';
import { C } from '../theme';
import { Card, ProbBar, Row, Small, ProvenanceBadges, Badge } from './kit';
import type { ActivityResultRow, SessionRow } from '../data/db';
import { coreSummary, patternSentence, pct } from '../test/summary';
import { CONTEXTUAL_LABEL } from '../test/activities';
import { decideTrack1, PROFILES } from '../signal/preprocess';

export function SessionResults({ session, rows }: { session: SessionRow; rows: ActivityResultRow[] }) {
  const summary = coreSummary(rows, session.profile);
  const core = rows.filter((r) => r.section === 'core');
  const ctx = rows.filter((r) => r.section === 'contextual');
  const profileShort = PROFILES[session.profile]?.short ?? session.profile;

  return (
    <View>
      <Card color={C.yellow} title="Core test summary">
        <ProvenanceBadges source={session.data_source} profileShort={profileShort} />
        {summary ? (
          <>
            <Text style={{ fontSize: 17, fontWeight: '800', color: C.ink, marginTop: 10 }}>{patternSentence(summary.pattern)}</Text>
            <Small>Mean of {summary.validWindows} valid 3-second windows from the five training-aligned activities.</Small>
            <ProbBar label="Normal" value={summary.pNormal} />
            <ProbBar label="Parkinsons-like" value={summary.pPd} />
            <ProbBar label="ET-like" value={summary.pEt} />
            <Row label="Seizure-like windows (simulated-data model)" value={String(summary.seizureLikeWindows)} />
          </>
        ) : (
          <Small>No valid core windows were recorded.</Small>
        )}
        <Small color={C.warn}>Screening aid only. Not a diagnosis. Models trained on public datasets (PADS, UEA), not on this band.</Small>
      </Card>

      <Card color={C.white} title="Core activities (training-aligned)">
        {core.map((r) => <ActivityBlock key={r.id} r={r} profile={session.profile} />)}
      </Card>

      {ctx.length > 0 ? (
        <Card color={C.cream} title="Contextual activities (not validated)">
          <Badge text="Not used in the main result" tone="warn" />
          <Small color={C.warn}>{CONTEXTUAL_LABEL}</Small>
          {ctx.map((r) => <ActivityBlock key={r.id} r={r} profile={session.profile} />)}
        </Card>
      ) : null}
    </View>
  );
}

function ActivityBlock({ r, profile }: { r: ActivityResultRow; profile: SessionRow['profile'] }) {
  const has = r.windows_valid > 0 && r.p_normal !== null;
  const pattern = has ? decideTrack1(profile, { normal: r.p_normal!, pd: r.p_pd!, et: r.p_et! }) : null;
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10, marginTop: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink }}>{r.activity_name}</Text>
      <Small>{r.windows_valid} of {r.windows_total} windows usable{r.windows_valid < r.windows_total ? ' (gaps in data excluded)' : ''}</Small>
      {has ? (
        <>
          <Row label="Model pattern" value={pattern === 'Normal' ? 'Normal' : `${pattern}`} />
          <Row label="Normal / PD-like / ET-like" value={`${pct(r.p_normal)} / ${pct(r.p_pd)} / ${pct(r.p_et)}`} />
          <Row label="Seizure-like probability (mean)" value={pct(r.p_seizure)} />
          <Row label="Accel amplitude, RMS (calculated)" value={`${r.accel_rms_g?.toFixed(3)} g`} />
          <Row label="Rotation amplitude, RMS (calculated)" value={`${r.gyro_rms_rad?.toFixed(3)} rad/s`} />
          <Row label="Dominant frequency (calculated)" value={`${r.dominant_hz?.toFixed(1)} Hz`} />
        </>
      ) : <Small>No prediction (not enough continuous data).</Small>}
      {has ? <Small>At very low amplitude the dominant frequency mostly reflects sensor noise.</Small> : null}
    </View>
  );
}
