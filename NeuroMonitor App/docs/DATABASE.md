# Database (SQLite, `neuromon.db`, on the phone only)

| Table | Purpose | Main columns |
|---|---|---|
| settings | Key-value app settings | key, value (patientName, patientAge, wrist, caregiver, sourceKind, demoMode, profile, scale, consentAt) |
| sessions | One guided test | id, started_at, finished_at, wrist, data_source, profile, scale |
| activity_results | One activity in a session | session_id, activity_id, activity_name, section (core/contextual), windows_total, windows_valid, p_normal, p_pd, p_et, p_seizure, seizure_like_windows, accel_rms_g, gyro_rms_rad, dominant_hz, data_source |
| medications | Medicines entered by the user | id, name, dose, schedule, active |
| doses | Dose taken events | id, medication_id, taken_at |

Notes
- Probabilities in `activity_results` are means over the usable 3 s windows of that activity.
- `section` keeps core and contextual results apart; the core summary query uses `section = 'core'` only.
- Times are milliseconds since 1970 (phone clock).
- Deleting a medicine sets `active = 0`, so past doses stay in the report.
