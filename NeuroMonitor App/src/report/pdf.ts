// Neurologist report: HTML rendered to PDF on the phone (expo-print), then shared (expo-sharing).
// Core and contextual results are kept in separate sections and never averaged together.
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { ActivityResultRow, SessionRow, DoseRow, Settings } from '../data/db';
import { coreSummary, patternSentence, pct } from '../test/summary';
import { CONTEXTUAL_LABEL } from '../test/activities';
import { PROFILES, decideTrack1 } from '../signal/preprocess';
import { MODEL_FILES } from '../ml/runner';
import { sourceLabel } from '../stream/hub';
import { SCALES } from '../protocol/units';

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const dt = (ms: number) => new Date(ms).toLocaleString();

function activityRows(rows: ActivityResultRow[], profile: SessionRow['profile']) {
  return rows.map((r) => {
    const has = r.windows_valid > 0 && r.p_normal !== null;
    const pattern = has ? decideTrack1(profile, { normal: r.p_normal!, pd: r.p_pd!, et: r.p_et! }) : '–';
    return `<tr><td>${esc(r.activity_name)}</td><td>${r.windows_valid}/${r.windows_total}</td><td>${pattern}</td>
      <td>${pct(r.p_normal)} / ${pct(r.p_pd)} / ${pct(r.p_et)}</td><td>${pct(r.p_seizure)}</td>
      <td>${r.accel_rms_g?.toFixed(3) ?? '–'}</td><td>${r.gyro_rms_rad?.toFixed(3) ?? '–'}</td><td>${r.dominant_hz?.toFixed(1) ?? '–'}</td></tr>`;
  }).join('');
}

const TABLE_HEAD = `<tr><th>Activity</th><th>Usable windows</th><th>Model pattern</th><th>Normal / PD-like / ET-like</th>
  <th>Seizure-like p (mean)</th><th>Accel RMS (g)</th><th>Rotation RMS (rad/s)</th><th>Dominant freq (Hz)</th></tr>`;

export function buildReportHtml(p: {
  settings: Settings; session: SessionRow; rows: ActivityResultRow[]; doses: DoseRow[]; lastDose: DoseRow | null;
}): string {
  const { settings, session, rows, doses, lastDose } = p;
  const summary = coreSummary(rows, session.profile);
  const core = rows.filter((r) => r.section === 'core');
  const ctx = rows.filter((r) => r.section === 'contextual');
  const synthetic = session.data_source === 'DEMO' || session.data_source === 'SIMULATOR';
  const sinceDose = lastDose ? `${Math.round((session.started_at - lastDose.taken_at) / 60000)} min after ${esc(lastDose.name)}${lastDose.dose ? ` (${esc(lastDose.dose)})` : ''}` : 'No dose logged before this test';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: Helvetica, Arial, sans-serif; color: #151515; font-size: 11pt; margin: 28px; }
    h1 { font-size: 20pt; margin: 0 0 4px; } h2 { font-size: 13pt; margin: 22px 0 6px; border-bottom: 2px solid #151515; padding-bottom: 3px; }
    .banner { background: #FFE7B3; border: 1px solid #C79A2B; padding: 8px 10px; border-radius: 6px; font-weight: bold; margin: 10px 0; }
    .synthetic { background: #FFD3D3; border-color: #B00020; }
    table { width: 100%; border-collapse: collapse; font-size: 9pt; } th, td { border: 1px solid #CFC6B3; padding: 4px 5px; text-align: left; }
    th { background: #EFE7D6; } .muted { color: #5E5A52; font-size: 9pt; } .summary { font-size: 13pt; font-weight: bold; margin: 6px 0; }
    .ctx { background: #F7F2E8; padding: 6px 8px; border-left: 4px solid #C79A2B; font-size: 9.5pt; }
  </style></head><body>
  <h1>Neuro Monitor: movement screening report</h1>
  <div class="muted">Generated ${dt(Date.now())} · Academic prototype (MSc NNDL project)</div>
  <div class="banner">Screening aid only. Not a diagnosis. Model outputs are screening observations, not clinical diagnoses. This app does not recommend any change to medication.</div>
  ${synthetic ? `<div class="banner synthetic">This session used SYNTHETIC data (${esc(sourceLabel(session.data_source))}). Results demonstrate the software only and describe no real person.</div>` : ''}

  <h2>Patient and session</h2>
  <table>
    <tr><th>Name / ID</th><td>${esc(settings.patientName || '–')}</td><th>Age</th><td>${esc(settings.patientAge || '–')}</td></tr>
    <tr><th>Test started</th><td>${dt(session.started_at)}</td><th>Band wrist</th><td>${esc(session.wrist || '–')}</td></tr>
    <tr><th>Data source</th><td>${esc(sourceLabel(session.data_source))}</td><th>Time since last logged dose</th><td>${sinceDose}</td></tr>
    <tr><th>Preprocessing</th><td colspan="3">${esc(PROFILES[session.profile]?.name ?? session.profile)}.</td></tr>
    <tr><th>Sensor scale</th><td colspan="3">${esc(SCALES[session.scale as keyof typeof SCALES]?.label ?? session.scale)}</td></tr>
    <tr><th>Models</th><td colspan="3">${MODEL_FILES.track1.file} (MD5 ${MODEL_FILES.track1.md5}); ${MODEL_FILES.track2.file} (MD5 ${MODEL_FILES.track2.md5})</td></tr>
  </table>

  <h2>1. Core test (training-aligned activities): main result</h2>
  ${summary ? `<div class="summary">${patternSentence(summary.pattern)}</div>
    <div>Mean over ${summary.validWindows} valid 3-second windows: Normal ${pct(summary.pNormal)}, Parkinsons-like ${pct(summary.pPd)}, ET-like ${pct(summary.pEt)}.
    Seizure-like windows (simulated-data model): ${summary.seizureLikeWindows}.</div>` : '<div>No valid core windows.</div>'}
  <p class="muted">Windows from the five activities used in the PADS training data. Rule: average of window probabilities (architecture document v1, section 8).
  Amplitude and frequency columns are calculated signal measures, not model outputs; no clinical severity scale is applied.</p>
  <table>${TABLE_HEAD}${activityRows(core, session.profile)}</table>

  <h2>2. Contextual activities (not validated)</h2>
  ${ctx.length ? `<div class="ctx">${esc(CONTEXTUAL_LABEL)} These results are not part of the main result above.</div>
    <table>${TABLE_HEAD}${activityRows(ctx, session.profile)}</table>` : '<div class="muted">None recorded.</div>'}

  <h2>3. Medication log (7 days before the test)</h2>
  ${doses.length ? `<table><tr><th>Medicine</th><th>Dose</th><th>Taken at</th></tr>${doses.map((d) =>
    `<tr><td>${esc(d.name)}</td><td>${esc(d.dose || '–')}</td><td>${dt(d.taken_at)}</td></tr>`).join('')}</table>` : '<div class="muted">No doses logged.</div>'}

  <h2>4. Limitations</h2>
  <ul class="muted">
    <li>Track 1 (Normal / Parkinsons-like / ET-like) was trained on Apple Watch data (PADS dataset), not on this wristband. It has not been validated on the MPU6050 band.</li>
    <li>Track 2 (seizure-like) was trained on acted seizures by healthy volunteers (UEA dataset). A seizure-like result is not a confirmed seizure. This is not a life-safety device.</li>
    <li>The preprocessing used here has not yet been confirmed by the model team (the receiver script and the model configuration disagree).</li>
    <li>The system cannot diagnose Parkinson's disease, essential tremor or epilepsy, and gives no medication advice.</li>
  </ul>
  </body></html>`;
}

export async function shareReportPdf(html: string): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share Neuro Monitor report', UTI: 'com.adobe.pdf' });
  }
  return uri;
}
