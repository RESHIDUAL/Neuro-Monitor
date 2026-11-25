/**
 * Neuro Monitor Clinical Telemetry Dashboard Client
 * True hardware status detection, patient creation and management,
 * dynamic interactive calendar with session scheduling, native canvas plotting.
 * Strictly: No emdashes, no emojis.
 */

// Global State
let patientsData = [];
let activePatientId = null;
let ws = null;
let isSimulatorActive = false;
let isHardwareLive = false;
let hwPollInterval = null;

// Calendar State
let calCurrentDate = new Date(); // Tracks displayed month and year
let selectedCalDateStr = formatDateKey(new Date()); // YYYY-MM-DD
let monthEventsCache = [];

// Waveform history buffer (60 points for 100 Hz canvas visualization)
const HISTORY_LEN = 60;
const waveHistory = {
  ax: new Array(HISTORY_LEN).fill(0.0),
  ay: new Array(HISTORY_LEN).fill(0.0),
  az: new Array(HISTORY_LEN).fill(0.0),
  mag: new Array(HISTORY_LEN).fill(0.0)
};

// Helper: Format date as YYYY-MM-DD
function formatDateKey(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 1. NATIVE HTML5 CANVAS WAVEFORM RENDERER (App Reference: Mean-Subtracted Dynamic Spikes)
function renderNativeCanvas() {
  const canvas = document.getElementById("liveKinematicsCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const midY = h / 2;

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);

  // Background reference grid lines
  ctx.strokeStyle = "#F3F4F6";
  ctx.lineWidth = 1;
  const gridSteps = [0.2, 0.5, 0.8];
  gridSteps.forEach(ratio => {
    const y = h * ratio;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  });

  // Central zero-mean baseline (matches mobile app LiveScreen center axis)
  ctx.strokeStyle = "#E5E7EB";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.stroke();

  // If hardware is offline and not simulated, draw clean resting baseline
  if (!isHardwareLive && !isSimulatorActive) {
    ctx.strokeStyle = "#D1D5DB";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    ctx.fillStyle = "#9CA3AF";
    ctx.font = "11px 'Plus Jakarta Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Band Offline: Awaiting UDP Stream on Port 8888", w / 2, midY - 14);
    return;
  }

  // Mean-subtraction calculation (as in LiveScreen.tsx: val - mean)
  function getMeanSubtracted(arr) {
    if (!arr || arr.length === 0) return { dev: [], mean: 0, maxDev: 0.1 };
    const mean = arr.reduce((acc, v) => acc + v, 0) / arr.length;
    let maxDev = 0.05;
    const dev = arr.map(v => {
      const d = v - mean;
      if (Math.abs(d) > maxDev) maxDev = Math.abs(d);
      return d;
    });
    return { dev, mean, maxDev };
  }

  const xData = getMeanSubtracted(waveHistory.ax);
  const yData = getMeanSubtracted(waveHistory.ay);
  const zData = getMeanSubtracted(waveHistory.az);

  // Auto-scale factor based on maximum deviation across axes
  const overallMaxDev = Math.max(0.06, xData.maxDev, yData.maxDev, zData.maxDev);
  const scale = (midY - 8) / Math.min(2.5, Math.max(0.12, overallMaxDev));

  function plotSpikesSeries(devArr, color, lineWidth, isDashed) {
    if (!devArr || devArr.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    if (isDashed) ctx.setLineDash([4, 4]);
    else ctx.setLineDash([]);

    ctx.beginPath();
    const step = w / (HISTORY_LEN - 1);
    for (let i = 0; i < HISTORY_LEN; i++) {
      const val = devArr[i] || 0;
      const y = midY - (val * scale);
      const x = i * step;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw 3-axis neat kinematic spikes (matching app colors and mobile LiveScreen)
  plotSpikesSeries(zData.dev, "#1F3A93", 1.8, false); // Accel Z (Royal Blue)
  plotSpikesSeries(yData.dev, "#2E7D32", 1.8, false); // Accel Y (Emerald Green)
  plotSpikesSeries(xData.dev, "#C2185B", 1.8, false); // Accel X (Crimson/Pink)
}

// 2. PATIENT MANAGEMENT & DOSSIER VIEW
async function loadPatients() {
  try {
    const res = await fetch("/api/patients");
    patientsData = await res.json();
    renderPatientList();
    populatePatientSelectDropdowns();

    if (patientsData.length > 0) {
      if (!activePatientId || !patientsData.find(p => p.id === activePatientId)) {
        selectPatient(patientsData[0].id);
      } else {
        selectPatient(activePatientId);
      }
    } else {
      activePatientId = null;
      renderEmptyDossier();
    }
  } catch (err) {
    console.error("Failed to load patients:", err);
  }
}

function renderPatientList() {
  const container = document.getElementById("patientListContainer");
  if (!container) return;
  container.innerHTML = "";

  if (patientsData.length === 0) {
    container.innerHTML = `
      <div class="empty-patient-box">
        <p>No patients registered yet.</p>
        <button class="btn-sm-add" id="btnEmptyStateAdd">+ Add First Patient</button>
      </div>
    `;
    const btn = document.getElementById("btnEmptyStateAdd");
    if (btn) btn.addEventListener("click", openAddPatientModal);
    return;
  }

  patientsData.forEach(p => {
    const card = document.createElement("div");
    card.className = `patient-card ${p.id === activePatientId ? "active" : ""}`;
    card.setAttribute("data-id", p.id);
    card.style.cursor = "pointer";

    card.addEventListener("click", () => {
      selectPatient(p.id);
    });

    const bandBadge = p.band_id > 0 ? `Band ${p.band_id}` : "No Band";

    card.innerHTML = `
      <div class="patient-card-left" style="pointer-events: none;">
        <div class="patient-icon-wrap">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
        </div>
        <div class="patient-info">
          <h4>${p.name}</h4>
          <p>${p.condition.substring(0, 26)}</p>
        </div>
      </div>
      <span class="patient-time-badge" style="pointer-events: none;">${bandBadge}</span>
    `;

    container.appendChild(card);
  });
}

function selectPatient(id) {
  activePatientId = id;
  const p = patientsData.find(item => item.id === id);
  if (!p) {
    renderEmptyDossier();
    return;
  }

  document.querySelectorAll(".patient-card").forEach(card => {
    const cardId = parseInt(card.getAttribute("data-id"));
    card.classList.toggle("active", cardId === id);
  });

  const dossierContainer = document.getElementById("patientDossierContainer");
  const actionBtns = document.getElementById("dossierActionButtons");
  if (actionBtns) actionBtns.style.display = "flex";

  const bandText = p.band_id === 1 ? "Band 1 (Patient Primary IMU)" :
                   p.band_id === 2 ? "Band 2 (Caregiver Node)" : "Unassigned";

  dossierContainer.innerHTML = `
    <div class="dossier-header-row">
      <div>
        <h3 class="dossier-name">${p.name}</h3>
        <span class="dossier-meta">${p.gender} - ${p.age}</span>
      </div>
      <span class="badge-code">${p.band_id > 0 ? 'BAND-0' + p.band_id : 'NO BAND'}</span>
    </div>

    <div class="tag-pills-row" id="dossierTags">
      ${p.symptoms ? p.symptoms.split(",").map(s => `<span class="tag-pill tag-pink">${s.trim()}</span>`).join("") : ""}
      <span class="tag-pill tag-purple">${p.condition}</span>
    </div>

    <div class="dossier-field">
      <span class="field-label">Assigned Hardware Unit</span>
      <span class="field-value">${bandText} &bull; Record ID <span class="link-id">#NM-00${p.id}</span></span>
    </div>

    <div class="dossier-field">
      <span class="field-label">Clinical Observations</span>
      <p class="observation-text">${p.observation || "Routine continuous 100 Hz kinematic monitoring."}</p>
    </div>

    <div class="dossier-field">
      <span class="field-label">Prescription / Medication Schedule</span>
      <p class="prescription-text">${p.prescription ? p.prescription.replace(/,/g, "<br>") : "None recorded"}</p>
    </div>

    <!-- LIVE WAVEFORM CANVAS -->
    <div class="waveform-box">
      <div class="waveform-header">
        <span>Real-Time 3-Axis Kinematic Waveform (g)</span>
        <span class="waveform-status" id="liveWaveformStatus">${isHardwareLive ? "100 Hz Streaming" : "Band Offline"}</span>
      </div>
      <div class="chart-canvas-wrap">
        <canvas id="liveKinematicsCanvas" width="600" height="110"></canvas>
      </div>
      <div class="waveform-legend-row">
        <span class="legend-tag tag-ax">Accel X</span>
        <span class="legend-tag tag-ay">Accel Y</span>
        <span class="legend-tag tag-az">Accel Z</span>
        <span class="legend-tag tag-mag">Magnitude</span>
      </div>
      <div class="waveform-footer-metrics">
        <div><span>Mag:</span> <strong id="telemetryMag">${isHardwareLive ? "1.00 g" : "0.00 g"}</strong></div>
        <div><span>Freq:</span> <strong id="telemetryFreq">${isHardwareLive ? "1.0 Hz" : "0.0 Hz"}</strong></div>
        <div><span>Pattern:</span> <strong class="badge-cls" id="telemetryCls">${isHardwareLive ? "Monitoring" : "No Band Connected"}</strong></div>
      </div>
    </div>

    <!-- ACTIONS -->
    <div class="dossier-actions-bar">
      <button class="btn-dossier btn-export" id="btnExportUserLog">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        <span>Export Wearer Data (CSV)</span>
      </button>
      <button class="btn-dossier btn-test-alert" id="btnTestBandAlert">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <span>Trigger Band Alarm Test</span>
      </button>
    </div>
  `;

  // Attach actions
  const exportBtn = document.getElementById("btnExportUserLog");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      window.location.href = `/api/logs/export?patient_id=${id}`;
    });
  }

  const alertBtn = document.getElementById("btnTestBandAlert");
  if (alertBtn) {
    alertBtn.addEventListener("click", triggerAlarmTest);
  }

  renderNativeCanvas();
  }



function renderEmptyDossier() {
  const dossierContainer = document.getElementById("patientDossierContainer");
  const actionBtns = document.getElementById("dossierActionButtons");
  if (actionBtns) actionBtns.style.display = "none";

  if (!dossierContainer) return;
  dossierContainer.innerHTML = `
    <div class="empty-dossier-box" style="padding: 12px 16px 14px; text-align: left; background: #FFF5F7; border: 1px solid #FCE7F3; border-radius: 12px; margin-bottom: 12px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h3 style="margin:0; font-size:15px; font-weight:700; color:#1F2937;">Live Primary Telemetry Feed (Monitoring Mode)</h3>
          <p style="margin:3px 0 0; font-size:12px; color:#6B7280;">Continuous 100 Hz kinematic spikes from wristband. Register a patient to link logs and assign clinical dossier.</p>
        </div>
        <button class="btn-primary-add" id="btnEmptyDossierAdd" style="padding: 7px 14px; font-size: 12px; margin: 0;">+ Register Patient</button>
      </div>
    </div>

    <!-- LIVE WAVEFORM CANVAS -->
    <div class="waveform-box">
      <div class="waveform-header">
        <span>Real-Time 3-Axis Kinematic Waveform (g)</span>
        <span class="waveform-status" id="liveWaveformStatus">${isHardwareLive ? "100 Hz Streaming" : "Band Offline"}</span>
      </div>
      <div class="chart-canvas-wrap">
        <canvas id="liveKinematicsCanvas" width="600" height="110"></canvas>
      </div>
      <div class="waveform-legend-row">
        <span class="legend-tag tag-ax">Accel X (Pink)</span>
        <span class="legend-tag tag-ay">Accel Y (Green)</span>
        <span class="legend-tag tag-az">Accel Z (Blue)</span>
        <span class="legend-tag tag-mag">Mean-Subtracted Spikes</span>
      </div>
      <div class="waveform-footer-metrics">
        <div><span>Mag:</span> <strong id="telemetryMag">${isHardwareLive ? "1.00 g" : "0.00 g"}</strong></div>
        <div><span>Freq:</span> <strong id="telemetryFreq">${isHardwareLive ? "1.0 Hz" : "0.0 Hz"}</strong></div>
        <div><span>Pattern:</span> <strong class="badge-cls" id="telemetryCls">${isHardwareLive ? "Monitoring" : "No Band Connected"}</strong></div>
      </div>
    </div>
  `;
  const btn = document.getElementById("btnEmptyDossierAdd");
  if (btn) btn.addEventListener("click", openAddPatientModal);

  renderNativeCanvas();
  }



function populatePatientSelectDropdowns() {
  const modalSelect = document.getElementById("sessionPatientSelect");
  const logSelect = document.getElementById("modalPatientFilter");

  if (modalSelect) {
    modalSelect.innerHTML = '<option value="">General Clinic Session (No specific patient)</option>';
    patientsData.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (Band ${p.band_id > 0 ? p.band_id : 'None'})`;
      modalSelect.appendChild(opt);
    });
  }

  if (logSelect) {
    logSelect.innerHTML = '<option value="">All Patients</option>';
    patientsData.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (Band ${p.band_id > 0 ? p.band_id : 'None'})`;
      logSelect.appendChild(opt);
    });
  }
}

// 3. ADD / EDIT PATIENT MODAL HANDLERS
function openAddPatientModal() {
  const modal = document.getElementById("patientModal");
  const form = document.getElementById("patientForm");
  const title = document.getElementById("patientModalTitle");
  const idInput = document.getElementById("formPatientId");

  if (form) form.reset();
  if (idInput) idInput.value = "";
  if (title) title.textContent = "Add Patient";
  if (modal) modal.classList.add("show");
}

function openEditPatientModal(patient) {
  const modal = document.getElementById("patientModal");
  const title = document.getElementById("patientModalTitle");
  const idInput = document.getElementById("formPatientId");

  if (idInput) idInput.value = patient.id;
  if (title) title.textContent = "Edit Patient Details";

  document.getElementById("formName").value = patient.name;
  document.getElementById("formAge").value = patient.age;
  document.getElementById("formGender").value = patient.gender;
  document.getElementById("formBandId").value = patient.band_id;
  document.getElementById("formCondition").value = patient.condition;
  document.getElementById("formSymptoms").value = patient.symptoms || "";
  document.getElementById("formObservation").value = patient.observation || "";
  document.getElementById("formPrescription").value = patient.prescription || "";

  if (modal) modal.classList.add("show");
}

async function handlePatientFormSubmit(e) {
  e.preventDefault();
  const idVal = document.getElementById("formPatientId").value;
  const payload = {
    name: document.getElementById("formName").value,
    age: document.getElementById("formAge").value,
    gender: document.getElementById("formGender").value,
    band_id: parseInt(document.getElementById("formBandId").value) || 0,
    condition: document.getElementById("formCondition").value,
    symptoms: document.getElementById("formSymptoms").value,
    observation: document.getElementById("formObservation").value,
    prescription: document.getElementById("formPrescription").value
  };

  try {
    if (idVal) {
      await fetch(`/api/patients/${idVal}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } else {
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const newP = await res.json();
      activePatientId = newP.id;
    }

    document.getElementById("patientModal").classList.remove("show");
    await loadPatients();
  } catch (err) {
    alert("Error saving patient: " + err);
  }
}

async function deleteActivePatient() {
  if (!activePatientId) return;
  const p = patientsData.find(item => item.id === activePatientId);
  const conf = confirm(`Are you sure you want to delete patient "${p ? p.name : ''}"?`);
  if (!conf) return;

  try {
    await fetch(`/api/patients/${activePatientId}`, { method: "DELETE" });
    activePatientId = null;
    await loadPatients();
  } catch (err) {
    alert("Error deleting patient: " + err);
  }
}

// 4. REAL DYNAMIC INTERACTIVE CALENDAR
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function initCalendar() {
  renderCalendar();
  loadCalendarEventsForDate(selectedCalDateStr);
}

async function renderCalendar() {
  const container = document.getElementById("calGridContainer");
  const title = document.getElementById("calMonthTitle");
  if (!container || !title) return;

  const year = calCurrentDate.getFullYear();
  const month = calCurrentDate.getMonth(); // 0 to 11
  title.textContent = `${MONTH_NAMES[month]} ${year}`;

  container.innerHTML = `
    <div class="cal-day-head">MO</div>
    <div class="cal-day-head">TU</div>
    <div class="cal-day-head">WE</div>
    <div class="cal-day-head">TH</div>
    <div class="cal-day-head">FR</div>
    <div class="cal-day-head">SA</div>
    <div class="cal-day-head">SU</div>
  `;

  // First day of month & total days
  const firstDay = new Date(year, month, 1);
  const totalDays = new Date(year, month + 1, 0).getDate();

  // Day of week: 0(Sun), 1(Mon) ... map so Mon=0, Sun=6
  let dayOffset = firstDay.getDay() - 1;
  if (dayOffset === -1) dayOffset = 6;

  for (let b = 0; b < dayOffset; b++) {
    const emptyCell = document.createElement("div");
    emptyCell.className = "cal-cell empty";
    container.appendChild(emptyCell);
  }

  const today = new Date();
  const todayKey = formatDateKey(today);

  // Fetch month events to place dot indicators
  try {
    const res = await fetch("/api/calendar-events");
    monthEventsCache = await res.json();
  } catch (e) {
    monthEventsCache = [];
  }

  for (let d = 1; d <= totalDays; d++) {
    const dateObj = new Date(year, month, d);
    const dateKey = formatDateKey(dateObj);

    const cell = document.createElement("div");
    cell.className = "cal-cell";
    cell.textContent = d;

    if (dateKey === todayKey) {
      cell.classList.add("today");
    }
    if (dateKey === selectedCalDateStr) {
      cell.classList.add("selected");
    }

    const hasEvents = monthEventsCache.some(ev => ev.event_date === dateKey);
    if (hasEvents) {
      cell.classList.add("has-events");
    }

    cell.addEventListener("click", () => {
      selectedCalDateStr = dateKey;
      document.querySelectorAll(".cal-cell").forEach(c => c.classList.remove("selected"));
      cell.classList.add("selected");
      loadCalendarEventsForDate(dateKey);
    });

    container.appendChild(cell);
  }
}

async function loadCalendarEventsForDate(dateKey) {
  const container = document.getElementById("timelineListContainer");
  const heading = document.getElementById("timelineDateHeading");
  const countLabel = document.getElementById("timelineCountLabel");
  if (!container) return;

  const parts = dateKey.split("-");
  const dObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  if (heading) heading.textContent = `${MONTH_NAMES[dObj.getMonth()]} ${dObj.getDate()}`;

  try {
    const res = await fetch(`/api/calendar-events?date=${dateKey}`);
    const events = await res.json();

    if (countLabel) countLabel.textContent = `${events.length} Session${events.length === 1 ? '' : 's'}`;
    container.innerHTML = "";

    if (events.length === 0) {
      container.innerHTML = `
        <div style="padding: 18px 10px; text-align: center; color: #9CA3AF; font-size: 11.5px;">
          No sessions on this date.<br>Click "+ Add Session" to schedule.
        </div>
      `;
      return;
    }

    events.forEach(ev => {
      const item = document.createElement("div");
      item.className = "timeline-item";

      item.innerHTML = `
        <span class="item-time active-dot">${ev.event_time}</span>
        <div class="timeline-card card-item-pink">
          <div class="item-badge-icon badge-stethoscope">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </div>
          <div class="item-body" style="flex:1;">
            <h4>${ev.title}</h4>
            <p>${ev.patient_name ? 'Patient: ' + ev.patient_name : 'Clinic Session'}${ev.location ? ' &bull; ' + ev.location : ''}</p>
          </div>
          <button class="timeline-delete-btn" title="Delete Session" data-id="${ev.id}">&times;</button>
        </div>
      `;

      item.querySelector(".timeline-delete-btn").addEventListener("click", async () => {
        await fetch(`/api/calendar-events/${ev.id}`, { method: "DELETE" });
        loadCalendarEventsForDate(dateKey);
        renderCalendar();
      });

      container.appendChild(item);
    });
  } catch (err) {
    console.error("Failed to load events for date:", err);
  }
}

// 5. WEBSOCKET REAL HARDWARE STATE
function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/live`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[WS] Telemetry websocket connected.");
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleTelemetryPacket(data);
    } catch (e) {
      console.error("Packet parse error:", e);
    }
  };

  ws.onclose = () => {
    setHardwareOfflineUI();
    setTimeout(connectWebSocket, 2000);
  };
}

function setHardwareOfflineUI() {
  isHardwareLive = false;
  const sBadge = document.getElementById("serverBadgeText");
  const sPulse = document.getElementById("serverPulse");
  if (sBadge) sBadge.textContent = "UDP 8888: LISTENING";
  if (sPulse) sPulse.style.backgroundColor = "#EAB308";

  const cardB1 = document.getElementById("cardBand1Stat");
  const cardB2 = document.getElementById("cardBand2Stat");
  const cardActive = document.getElementById("cardActiveBandCount");
  if (cardB1) cardB1.textContent = "Band 1: Offline";
  if (cardB2) cardB2.textContent = "Band 2: Offline";
  if (cardActive) cardActive.textContent = "0 Active";

  const hudRate = document.getElementById("hudRateVal");
  const statSamp = document.getElementById("statSampleRate");
  if (hudRate) hudRate.textContent = "Offline";
  if (statSamp) statSamp.textContent = "0 Hz";

  const statusEl = document.getElementById("liveWaveformStatus");
  if (statusEl) {
    statusEl.textContent = "Band Offline";
    statusEl.style.color = "#9CA3AF";
  }

  const pNormEl = document.getElementById("statNormalProb");
  const pTremEl = document.getElementById("statTremorProb");
  const pSeizEl = document.getElementById("statSeizureProb");
  if (pNormEl) pNormEl.textContent = "0%";
  if (pTremEl) pTremEl.textContent = "0%";
  if (pSeizEl) pSeizEl.textContent = "0%";

  const pNormalBar = document.getElementById("progNormal");
  const pTremorBar = document.getElementById("progTremor");
  const pSeizureBar = document.getElementById("progSeizure");
  if (pNormalBar) pNormalBar.style.width = "0%";
  if (pTremorBar) pTremorBar.style.width = "0%";
  if (pSeizureBar) pSeizureBar.style.width = "0%";

  const magEl = document.getElementById("telemetryMag");
  const freqEl = document.getElementById("telemetryFreq");
  const clsEl = document.getElementById("telemetryCls");
  if (magEl) magEl.textContent = "0.00 g";
  if (freqEl) freqEl.textContent = "0.0 Hz";
  if (clsEl) {
    clsEl.textContent = "Waiting for Wristband";
    clsEl.style.backgroundColor = "#9CA3AF";
    clsEl.style.color = "#FFFFFF";
  }

  renderNativeCanvas();
  updatePinkCardSparkline(0, 0, "Offline");
  }



function handleTelemetryPacket(data) {
  isHardwareLive = data.streaming_active;

  if (!isHardwareLive && !isSimulatorActive) {
    setHardwareOfflineUI();
    return;
  }

  const kin = data.kinematics;
  const probs = data.probs;

  const sBadge = document.getElementById("serverBadgeText");
  const sPulse = document.getElementById("serverPulse");
  if (sBadge) sBadge.textContent = "STREAMING: 100 Hz";
  if (sPulse) sPulse.style.backgroundColor = "#4ADE80";

  const cardB1 = document.getElementById("cardBand1Stat");
  const cardB2 = document.getElementById("cardBand2Stat");
  const cardActive = document.getElementById("cardActiveBandCount");
  const lblIp = document.getElementById("lblBand1Ip");

  if (data.bands) {
    const b1On = data.bands.band1 && data.bands.band1.online;
    const b2On = data.bands.band2 && data.bands.band2.online;
    if (cardB1) cardB1.textContent = b1On ? "Band 1: Online" : "Band 1: Offline";
    if (cardB2) cardB2.textContent = b2On ? "Band 2: Online" : "Band 2: Standby";
    if (cardActive) cardActive.textContent = `${(b1On ? 1 : 0) + (b2On ? 1 : 0)} Active`;
    if (lblIp && b1On) lblIp.textContent = `IP: ${data.bands.band1.ip}`;
  } else {
    if (cardB1) cardB1.textContent = "Band 1: Online";
    if (cardB2) cardB2.textContent = data.active_bands_count > 1 ? "Band 2: Online" : "Band 2: Standby";
    if (cardActive) cardActive.textContent = `${data.active_bands_count || 1} Active`;
  }

  const hudRate = document.getElementById("hudRateVal");
  const statSamp = document.getElementById("statSampleRate");
  if (hudRate) hudRate.textContent = "100 Hz Native";
  if (statSamp) statSamp.textContent = "100 Hz";

  const statusEl = document.getElementById("liveWaveformStatus");
  if (statusEl) {
    statusEl.textContent = "100 Hz Streaming";
    statusEl.style.color = "#16A34A";
  }

  // Update G-force and Frequency
  const magEl = document.getElementById("telemetryMag");
  if (magEl) magEl.textContent = `${kin.mag.toFixed(2)} g`;

  const freqEl = document.getElementById("telemetryFreq");
  if (freqEl) freqEl.textContent = `${kin.freq.toFixed(1)} Hz`;

  const avgFreqEl = document.getElementById("statAvgFreq");
  if (avgFreqEl) avgFreqEl.textContent = `${kin.freq.toFixed(1)} Hz`;

  const activeFreqEl = document.getElementById("lblActiveFreq");
  if (activeFreqEl) activeFreqEl.textContent = `${kin.freq.toFixed(1)} Hz`;

  // Classification Badge
  const clsEl = document.getElementById("telemetryCls");
  if (clsEl) {
    clsEl.textContent = probs.classification;
    if (probs.alert_code === 3) {
      clsEl.style.backgroundColor = "#EF4444";
      clsEl.style.color = "#FFFFFF";
    } else if (probs.alert_code === 1 || probs.alert_code === 2) {
      clsEl.style.backgroundColor = "#F59E0B";
      clsEl.style.color = "#FFFFFF";
    } else {
      clsEl.style.backgroundColor = "#22C55E";
      clsEl.style.color = "#FFFFFF";
    }
  }

  // Probabilities
  const pNormEl = document.getElementById("statNormalProb");
  const pTremEl = document.getElementById("statTremorProb");
  const pSeizEl = document.getElementById("statSeizureProb");
  const normPct = Math.round(probs.p_norm * 100);
  const tremPct = Math.round(probs.p_pd * 100);
  const seizPct = Math.round(probs.p_seiz * 100);

  if (pNormEl) pNormEl.textContent = `${normPct}%`;
  if (pTremEl) pTremEl.textContent = `${tremPct}%`;
  if (pSeizEl) pSeizEl.textContent = `${seizPct}%`;

  const pNormalBar = document.getElementById("progNormal");
  const pTremorBar = document.getElementById("progTremor");
  const pSeizureBar = document.getElementById("progSeizure");
  if (pNormalBar) pNormalBar.style.width = `${normPct}%`;
  if (pTremorBar) pTremorBar.style.width = `${tremPct}%`;
  if (pSeizureBar) pSeizureBar.style.width = `${seizPct}%`;

  // Waveform buffer
  waveHistory.ax.push(kin.ax);
  waveHistory.ax.shift();
  waveHistory.ay.push(kin.ay);
  waveHistory.ay.shift();
  waveHistory.az.push(kin.az);
  waveHistory.az.shift();
  waveHistory.mag.push(kin.mag);
  waveHistory.mag.shift();

  renderNativeCanvas();
  updatePinkCardSparkline(kin.freq, kin.mag, probs.classification);
  }



// 6. TRIGGER ALARM BROADCAST TEST

// 5B. PINK CARD DYNAMIC HARMONIC SPARKLINE SPIKES
function updatePinkCardSparkline(freq, mag, classification) {
  const pathEl = document.getElementById("sparklineSvgPath");
  const circleEl = document.getElementById("sparklineCircle");
  if (!pathEl) return;

  const width = 300;
  const height = 80;
  const midY = 48;

  if (!isHardwareLive && !isSimulatorActive) {
    pathEl.setAttribute("d", "M 0," + midY + " L " + width + "," + midY);
    if (circleEl) {
      circleEl.setAttribute("cx", "150");
      circleEl.setAttribute("cy", String(midY));
    }
    return;
  }

  const points = [];
  const numPoints = 64;
  const effectiveFreq = freq > 0.5 ? freq : 4.5;
  const amp = Math.min(26, Math.max(7, (mag || 1.0) * 15));
  const timeOffset = (Date.now() % 10000) / 1000;

  for (let i = 0; i < numPoints; i++) {
    const x = (i / (numPoints - 1)) * width;
    const phase = (i / numPoints) * Math.PI * 2 * (effectiveFreq * 0.75) - (timeOffset * 4);
    const spike = Math.sin(phase) + 0.4 * Math.sin(phase * 2.2) - 0.2 * Math.cos(phase * 3.5);
    const y = midY - (spike * amp);
    points.push(x.toFixed(1) + "," + y.toFixed(1));
  }

  const d = "M " + points.join(" L ");
  pathEl.setAttribute("d", d);

  if (circleEl && points.length > 0) {
    const peakIdx = Math.floor(numPoints * 0.52);
    const [cx, cy] = points[peakIdx].split(",");
    circleEl.setAttribute("cx", cx);
    circleEl.setAttribute("cy", cy);
  }
}

// 6. TRIGGER ALARM BROADCAST TEST
async function triggerAlarmTest() {
  const alertBtn = document.getElementById("btnTestBandAlert");
  if (alertBtn) alertBtn.textContent = "Broadcasting Alarm...";

  try {
    const res = await fetch("/api/trigger-alert?alert_code=3&severity=100", { method: "POST" });
    const data = await res.json();
    if (alertBtn) {
      alertBtn.textContent = "Alarm Broadcasted!";
      setTimeout(() => {
        alertBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <span>Trigger Band Alarm Test</span>
        `;
      }, 2000);
    }
  } catch (err) {
    alert("Failed to broadcast alert: " + err);
  }
}

// 7. USER TELEMETRY LOGS AUDIT
async function loadLogsTable() {
  const pFilter = document.getElementById("modalPatientFilter");
  const cFilter = document.getElementById("modalConditionFilter");
  const pId = pFilter ? pFilter.value : "";
  const cond = cFilter ? cFilter.value : "";

  let url = `/api/logs?limit=50`;
  if (pId) url += `&patient_id=${pId}`;
  if (cond) url += `&condition=${encodeURIComponent(cond)}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const tbody = document.getElementById("logsTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!data.items || data.items.length === 0) {
      tbody.innerHTML = "<tr><td colspan='12' style='text-align:center; padding: 24px; color:#6B7280;'>No telemetry records logged yet. Once wristband transmits or simulator runs, records will appear here.</td></tr>";
      return;
    }

    data.items.forEach(item => {
      const tr = document.createElement("tr");
      const alertLabel = item.alert_code === 3 ? "<span style='color:#DC2626; font-weight:800;'>SEIZURE ALERT</span>" :
                         item.alert_code > 0 ? "<span style='color:#D97706; font-weight:700;'>TREMOR DETECT</span>" :
                         "<span style='color:#16A34A; font-weight:600;'>NORMAL</span>";

      tr.innerHTML = `
        <td>#${item.id}</td>
        <td><strong>${item.patient_name || 'Wearer ' + item.band_id}</strong></td>
        <td>Band ${item.band_id}</td>
        <td>${item.timestamp}</td>
        <td>${item.acc_mag ? item.acc_mag.toFixed(2) : '-'}g</td>
        <td>${item.freq_hz ? item.freq_hz.toFixed(1) : '-'} Hz</td>
        <td>${item.p_norm ? Math.round(item.p_norm * 100) : '-'}%</td>
        <td>${item.p_pd ? Math.round(item.p_pd * 100) : '-'}%</td>
        <td>${item.p_et ? Math.round(item.p_et * 100) : '-'}%</td>
        <td>${item.p_seiz ? Math.round(item.p_seiz * 100) : '-'}%</td>
        <td>${item.classification || 'Normal'}</td>
        <td>${alertLabel}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load logs:", err);
  }
}

// 7B. HARDWARE STATUS MODAL DATA
async function updateHardwareModalData() {
  try {
    const res = await fetch("/api/bands-status");
    if (!res.ok) return;
    const data = await res.json();

    const b1 = data.band1;
    const b2 = data.band2;

    // Band 1: Patient Primary
    const b1Badge = document.getElementById("hwB1Badge");
    const b1Ip = document.getElementById("hwB1Ip");
    const b1Rssi = document.getElementById("hwB1Rssi");
    const b1LastSeen = document.getElementById("hwB1LastSeen");

    if (b1Badge) {
      b1Badge.textContent = b1.online ? "ONLINE" : "OFFLINE";
      b1Badge.className = `hw-status-badge ${b1.online ? "badge-online" : "badge-offline"}`;
    }
    if (b1Ip) b1Ip.textContent = b1.ip || "Not Connected";
    if (b1Rssi) b1Rssi.textContent = b1.rssi !== null && b1.rssi !== undefined ? `${b1.rssi} dBm` : "--";
    if (b1LastSeen) {
      if (b1.online) {
        b1LastSeen.textContent = b1.last_seen_sec !== null ? `${b1.last_seen_sec}s ago (Active)` : "Live Now";
      } else {
        b1LastSeen.textContent = b1.last_seen_sec !== null ? `${b1.last_seen_sec}s ago` : "Never";
      }
    }

    // Band 2: Caregiver Receiver
    const b2Badge = document.getElementById("hwB2Badge");
    const b2Ip = document.getElementById("hwB2Ip");
    const b2Rssi = document.getElementById("hwB2Rssi");
    const b2LastSeen = document.getElementById("hwB2LastSeen");

    if (b2Badge) {
      b2Badge.textContent = b2.online ? "ONLINE" : "OFFLINE";
      b2Badge.className = `hw-status-badge ${b2.online ? "badge-online" : "badge-offline"}`;
    }
    if (b2Ip) b2Ip.textContent = b2.ip || "Not Connected";
    if (b2Rssi) b2Rssi.textContent = b2.rssi !== null && b2.rssi !== undefined ? `${b2.rssi} dBm` : "--";
    if (b2LastSeen) {
      if (b2.online) {
        b2LastSeen.textContent = b2.last_seen_sec !== null ? `${b2.last_seen_sec}s ago (Active)` : "Live Now";
      } else {
        b2LastSeen.textContent = b2.last_seen_sec !== null ? `${b2.last_seen_sec}s ago` : "Never";
      }
    }

    // Also update yellow card on main dashboard
    const cardB1 = document.getElementById("cardBand1Stat");
    const cardB2 = document.getElementById("cardBand2Stat");
    const cardActive = document.getElementById("cardActiveBandCount");
    const lblIp = document.getElementById("lblBand1Ip");

    if (cardB1) cardB1.textContent = b1.online ? "Band 1: Online" : "Band 1: Offline";
    if (cardB2) cardB2.textContent = b2.online ? "Band 2: Online" : (b1.online ? "Band 2: Standby" : "Band 2: Offline");
    if (cardActive) cardActive.textContent = `${(b1.online ? 1 : 0) + (b2.online ? 1 : 0)} Active`;
    if (lblIp && b1.online) lblIp.textContent = `IP: ${b1.ip}`;
  } catch (err) {
    console.error("Failed to load hardware status:", err);
  }
}

// 8. ATTACH ALL INTERACTION LISTENERS
function setupEventListeners() {
  // Add Patient buttons
  const topAddBtn = document.getElementById("btnTopAddPatient");
  if (topAddBtn) topAddBtn.addEventListener("click", openAddPatientModal);

  const panelAddBtn = document.getElementById("btnPanelAddPatient");
  if (panelAddBtn) panelAddBtn.addEventListener("click", openAddPatientModal);

  const quickNavAddBtn = document.getElementById("btnQuickAddPatientNav");
  if (quickNavAddBtn) quickNavAddBtn.addEventListener("click", openAddPatientModal);

  // Close Patient Modal
  const closePatientModalBtn = document.getElementById("btnClosePatientModal");
  if (closePatientModalBtn) {
    closePatientModalBtn.addEventListener("click", () => {
      document.getElementById("patientModal").classList.remove("show");
    });
  }
  const cancelPatientBtn = document.getElementById("btnCancelPatientModal");
  if (cancelPatientBtn) {
    cancelPatientBtn.addEventListener("click", () => {
      document.getElementById("patientModal").classList.remove("show");
    });
  }

  // Submit Patient Form
  const patientForm = document.getElementById("patientForm");
  if (patientForm) patientForm.addEventListener("submit", handlePatientFormSubmit);

  // Edit / Delete Selected Patient
  const editBtn = document.getElementById("btnEditSelectedPatient");
  if (editBtn) {
    editBtn.addEventListener("click", () => {
      const p = patientsData.find(item => item.id === activePatientId);
      if (p) openEditPatientModal(p);
    });
  }

  const deleteBtn = document.getElementById("btnDeleteSelectedPatient");
  if (deleteBtn) deleteBtn.addEventListener("click", deleteActivePatient);

  // Calendar Sessions Modals
  const addEventBtn = document.getElementById("btnAddCalendarEvent");
  if (addEventBtn) {
    addEventBtn.addEventListener("click", () => {
      const modal = document.getElementById("sessionModal");
      const dateInput = document.getElementById("sessionDate");
      if (dateInput) dateInput.value = selectedCalDateStr;
      if (modal) modal.classList.add("show");
    });
  }

  const closeSessionBtn = document.getElementById("btnCloseSessionModal");
  if (closeSessionBtn) {
    closeSessionBtn.addEventListener("click", () => {
      document.getElementById("sessionModal").classList.remove("show");
    });
  }
  const cancelSessionBtn = document.getElementById("btnCancelSessionModal");
  if (cancelSessionBtn) {
    cancelSessionBtn.addEventListener("click", () => {
      document.getElementById("sessionModal").classList.remove("show");
    });
  }

  // Submit Session Form
  const sessionForm = document.getElementById("sessionForm");
  if (sessionForm) {
    sessionForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pSelect = document.getElementById("sessionPatientSelect");
      const payload = {
        patient_id: pSelect.value ? parseInt(pSelect.value) : null,
        event_date: document.getElementById("sessionDate").value,
        event_time: document.getElementById("sessionTime").value,
        title: document.getElementById("sessionTitle").value,
        location: document.getElementById("sessionLocation").value,
        notes: document.getElementById("sessionNotes").value
      };

      try {
        await fetch("/api/calendar-events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        document.getElementById("sessionModal").classList.remove("show");
        sessionForm.reset();
        await renderCalendar();
        await loadCalendarEventsForDate(payload.event_date);
      } catch (err) {
        alert("Error adding session: " + err);
      }
    });
  }

  // Calendar Navigation
  const prevMonthBtn = document.getElementById("calPrevMonthBtn");
  if (prevMonthBtn) {
    prevMonthBtn.addEventListener("click", () => {
      calCurrentDate.setMonth(calCurrentDate.getMonth() - 1);
      renderCalendar();
    });
  }
  const nextMonthBtn = document.getElementById("calNextMonthBtn");
  if (nextMonthBtn) {
    nextMonthBtn.addEventListener("click", () => {
      calCurrentDate.setMonth(calCurrentDate.getMonth() + 1);
      renderCalendar();
    });
  }
  const todayBtn = document.getElementById("btnCalToday");
  if (todayBtn) {
    todayBtn.addEventListener("click", () => {
      calCurrentDate = new Date();
      selectedCalDateStr = formatDateKey(new Date());
      renderCalendar();
      loadCalendarEventsForDate(selectedCalDateStr);
    });
  }

  // Hardware Link Status Modal
  const hwBtn = document.getElementById("hardwareStatusBtn");
  const hwModal = document.getElementById("hardwareModal");
  const closeHwBtn = document.getElementById("btnCloseHardwareModal");

  function openHwModal() {
    if (hwModal) {
      hwModal.classList.add("show");
      updateHardwareModalData();
      if (hwPollInterval) clearInterval(hwPollInterval);
      hwPollInterval = setInterval(updateHardwareModalData, 1000);
    }
  }

  function closeHwModal() {
    if (hwModal) {
      hwModal.classList.remove("show");
    }
    if (hwPollInterval) {
      clearInterval(hwPollInterval);
      hwPollInterval = null;
    }
  }

  if (hwBtn) hwBtn.addEventListener("click", openHwModal);
  if (closeHwBtn) closeHwBtn.addEventListener("click", closeHwModal);
  if (hwModal) {
    hwModal.addEventListener("click", (e) => {
      if (e.target === hwModal) closeHwModal();
    });
  }

  // Ping test buttons
  const pingB1Btn = document.getElementById("btnPingBand1");
  if (pingB1Btn) {
    pingB1Btn.addEventListener("click", async () => {
      try {
        const origText = pingB1Btn.textContent;
        pingB1Btn.textContent = "Chirp Dispatched...";
        await fetch("/api/ping-band?band_id=1", { method: "POST" });
        pingB1Btn.textContent = "Chirp Sent to Band 1!";
        setTimeout(() => { pingB1Btn.textContent = origText; }, 1600);
      } catch (err) {
        console.error("Failed to ping band 1:", err);
      }
    });
  }

  const pingB2Btn = document.getElementById("btnPingBand2");
  if (pingB2Btn) {
    pingB2Btn.addEventListener("click", async () => {
      try {
        const origText = pingB2Btn.textContent;
        pingB2Btn.textContent = "Chirp Dispatched...";
        await fetch("/api/ping-band?band_id=2", { method: "POST" });
        pingB2Btn.textContent = "Chirp Sent to Band 2!";
        setTimeout(() => { pingB2Btn.textContent = origText; }, 1600);
      } catch (err) {
        console.error("Failed to ping band 2:", err);
      }
    });
  }

  const hwTestBothBtn = document.getElementById("btnHwTestBothBands");
  if (hwTestBothBtn) {
    hwTestBothBtn.addEventListener("click", async () => {
      try {
        const origText = hwTestBothBtn.textContent;
        hwTestBothBtn.textContent = "Broadcasting Siren...";
        await fetch("/api/trigger-alert", { method: "POST" });
        hwTestBothBtn.textContent = "Siren Broadcast to Subnet!";
        setTimeout(() => { hwTestBothBtn.textContent = origText; }, 2000);
      } catch (err) {
        console.error("Failed to broadcast siren:", err);
      }
    });
  }

  // Logs Modal
  const openLogsBtn = document.getElementById("openLogsNavBtn");
  const viewAllBtn = document.getElementById("btnViewAllTimeline");
  const viewAllLink = document.getElementById("viewAllPatientsLink");
  const logsModal = document.getElementById("logsModal");

  function openLogs() {
    if (logsModal) {
      logsModal.classList.add("show");
      loadLogsTable();
    }
  }

  if (openLogsBtn) openLogsBtn.addEventListener("click", openLogs);
  if (viewAllBtn) viewAllBtn.addEventListener("click", openLogs);
  if (viewAllLink) viewAllLink.addEventListener("click", openLogs);

  const closeLogsBtn = document.getElementById("btnCloseLogsModal");
  if (closeLogsBtn) {
    closeLogsBtn.addEventListener("click", () => {
      if (logsModal) logsModal.classList.remove("show");
    });
  }

  // CSV Export Buttons
  const navExportBtn = document.getElementById("navExportBtn");
  if (navExportBtn) {
    navExportBtn.addEventListener("click", () => {
      window.location.href = "/api/logs/export";
    });
  }
  const exportFilteredBtn = document.getElementById("btnExportFilteredLogs");
  if (exportFilteredBtn) {
    exportFilteredBtn.addEventListener("click", () => {
      const pFilter = document.getElementById("modalPatientFilter");
      const pId = pFilter ? pFilter.value : "";
      let url = "/api/logs/export";
      if (pId) url += `?patient_id=${pId}`;
      window.location.href = url;
    });
  }

  // Emergency Alarm Broadcast
  const emergBtn = document.getElementById("triggerEmergencyModalBtn");
  if (emergBtn) emergBtn.addEventListener("click", triggerAlarmTest);

  // Toggle Watch Simulator
  const toggleSimBtn = document.getElementById("toggleSimulatorBtn");
  const simText = document.getElementById("simToggleText");
  if (toggleSimBtn) {
    toggleSimBtn.addEventListener("click", async () => {
      isSimulatorActive = !isSimulatorActive;
      try {
        await fetch(`/api/simulate?enabled=${isSimulatorActive}`, { method: "POST" });
        if (simText) simText.textContent = isSimulatorActive ? "Stop Watch Sim" : "Simulate Watch";
        toggleSimBtn.style.color = isSimulatorActive ? "#4ADE80" : "#9299A8";
        if (!isSimulatorActive) {
          setHardwareOfflineUI();
        }
      } catch (e) {
        console.error("Error toggling simulator:", e);
      }
    });
  }

  // Search input filter
  const searchInput = document.getElementById("globalSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll(".patient-card").forEach((card, idx) => {
        const p = patientsData[idx];
        if (p) {
          const match = p.name.toLowerCase().includes(q) || p.condition.toLowerCase().includes(q);
          card.style.display = match ? "flex" : "none";
        }
      });
    });
  }

  // Filter Pills (All, Parkinson, Tremor, Seizures)
  document.querySelectorAll(".pill").forEach(pill => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      const filterKey = pill.getAttribute("data-filter");

      document.querySelectorAll(".patient-card").forEach((card, idx) => {
        const p = patientsData[idx];
        if (!p) return;
        if (filterKey === "all") {
          card.style.display = "flex";
        } else if (filterKey === "parkinsons") {
          card.style.display = p.condition.toLowerCase().includes("parkinson") ? "flex" : "none";
        } else if (filterKey === "tremor") {
          card.style.display = (p.condition.toLowerCase().includes("tremor") || p.condition.toLowerCase().includes("kinetic")) ? "flex" : "none";
        } else if (filterKey === "seizures") {
          card.style.display = p.condition.toLowerCase().includes("seizure") ? "flex" : "none";
        }
      });
    });
  });
}

// 9. INITIALIZATION
document.addEventListener("DOMContentLoaded", () => {
  setHardwareOfflineUI();
  loadPatients();
  initCalendar();
  connectWebSocket();
  setupEventListeners();
});
