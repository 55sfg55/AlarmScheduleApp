// app.js – alarm scheduling, sidebar toggle, 24h editor helper, sound

import {
  loadAlarms, saveAlarms, alarms,
  selectedAlarmId, currentPlatform, timeFormat24h,
  getAlarmById, getCurrentScreenId,
  setSelectedAlarmId, setCurrentPlatform, setTimeFormat24h
} from './alarmStore.js';
import { addLog, formatTime } from './utils.js';
import { loadScreen, renderScreen } from './screenLoader.js';

let activeAlarmId = null;
let activeOverlayCleanup = null;
let alarmTimers = [];
const soundCopyPromises = {}; // pending disk-copy promises keyed by alarm id

// ── Sound management ─
let currentAudio = null;
let fallbackOscillator = null;
let fallbackAudioCtx = null;
let audioContextUnlocked = localStorage.getItem('audioUnlocked') === '1';

function waitForUserGestureToUnlockAudio() {
  if (audioContextUnlocked) return;
  const handler = async () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      await ctx.resume();
      await ctx.close();
      localStorage.setItem('audioUnlocked', '1');
      audioContextUnlocked = true;
      console.debug('[audio] Audio unlocked via user gesture');
    } catch (e) {
      console.warn('[audio] unlock attempt failed', e);
    }
  };
  document.addEventListener('click', handler, { once: true });
  console.debug('[audio] Waiting for user gesture to enable audio (click anywhere)');
}

// IndexedDB for storing sound blobs (only as ultimate fallback)
function openSoundDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('AlarmAppSounds', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('sounds');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveSoundBlob(alarmId, file) {
  try {
    const db = await openSoundDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sounds', 'readwrite');
      tx.objectStore('sounds').put(file, alarmId);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) { console.warn('saveSoundBlob failed', e); }
}

async function loadSoundBlob(alarmId) {
  try {
    const db = await openSoundDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sounds', 'readonly');
      const req = tx.objectStore('sounds').get(alarmId);
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch (e) { console.warn('loadSoundBlob failed', e); return null; }
}

async function deleteSoundBlob(alarmId) {
  try {
    const db = await openSoundDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sounds', 'readwrite');
      tx.objectStore('sounds').delete(alarmId);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) { console.warn('deleteSoundBlob failed', e); }
}

// ── Helper: sanitize filename ──
function sanitizeFileName(name) {
  return (name || '').toString().split(/[/\\]/).pop().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || `sound_${Date.now()}`;
}

// ── File persistence via custom Tauri commands ──
async function persistFileToDisk(alarmId, file, fileName) {
  console.group('[persistFileToDisk]');
  console.log('Input:', { alarmId, fileName, fileType: file?.type, fileSize: file?.size });
  try {
    const arrayBuf = await file.arrayBuffer();
    const rawBytes = new Uint8Array(arrayBuf);
    console.log('Read', rawBytes.length, 'bytes');
    const data = Array.from(rawBytes); // Tauri command expects Vec<u8>
    const fname = sanitizeFileName(fileName || file.name || `sound_${Date.now()}`);
    console.log('Invoking save_sound_file with:', { alarmId, fileName: fname, dataLen: data.length });
    const savedPath = await window.__TAURI__.core.invoke('save_sound_file', {
      alarmId,
      fileName: fname,
      data,
    });
    console.log('✅ saved to', savedPath);
    console.groupEnd();
    return savedPath;
  } catch (err) {
    console.error('❌ Failed:', err);
    console.groupEnd();
    return null;
  }
}

async function copyFilePathToDisk(alarmId, sourcePath, fileName) {
  console.group('[copyFilePathToDisk]');
  console.log('Input:', { alarmId, sourcePath, fileName });
  const fname = sanitizeFileName(fileName || sourcePath.split(/[\\/]/).pop() || `sound_${Date.now()}`);
  try {
    const savedPath = await window.__TAURI__.core.invoke('copy_file_to_app_dir', {
      alarmId,
      sourcePath,
      destName: fname,
    });
    console.log('✅ copied to', savedPath);
    console.groupEnd();
    return savedPath;
  } catch (err) {
    console.error('❌ Failed:', err);
    console.groupEnd();
    return null;
  }
}

async function deleteCopiedFile(alarmId, fileName) {
  const alarm = getAlarmById(alarmId);
  if (!alarm || !alarm.soundPath) return;
  console.debug(`[deleteCopiedFile] Deleting ${alarm.soundPath}`);
  try {
    await window.__TAURI__.core.invoke('delete_sound_file', { path: alarm.soundPath });
    console.debug('Deleted successfully');
  } catch (err) { /* ignore */ }
}

// ── Play alarm sound ──
async function playAlarmSound(alarm) {
  console.group('[playAlarmSound]');
  stopAlarmSound();
  if (!alarm.soundPath) {
    console.warn('No soundPath defined, falling back to beep');
    playFallbackBeep();
    console.groupEnd();
    return;
  }
  console.log('Attempting to play:', alarm.soundPath);
  // Verify file existence
  try {
    const exists = await window.__TAURI__.core.invoke('file_exists', { path: alarm.soundPath });
    if (!exists) {
      console.error('File does NOT exist on disk!');
      playFallbackBeep();
      console.groupEnd();
      return;
    }
    console.log('File exists.');
  } catch (e) {
    console.warn('file_exists check failed, trying to play anyway:', e);
  }

  const src = window.__TAURI__.core.convertFileSrc(alarm.soundPath);
  console.log('Converted source URL:', src);
  const audio = new Audio(src);
  audio.loop = true;
  try {
    await audio.play();
    currentAudio = audio;
    console.log('✅ Playing sound');
  } catch (e) {
    console.error('❌ Playback error:', e);
    playFallbackBeep();
  }
  console.groupEnd();
}

// ── Ensure the alarm has a persistent file on disk ──
async function ensureAlarmSoundPersistent(alarm) {
  if (!alarm) return null;
  if (soundCopyPromises[alarm.id]) {
    console.debug('[ensureAlarmSoundPersistent] Waiting for pending copy…');
    await soundCopyPromises[alarm.id];
  }
  if (alarm.soundPath) {
    // Quick check if it still exists
    try {
      const exists = await window.__TAURI__.core.invoke('file_exists', { path: alarm.soundPath });
      if (exists) return alarm.soundPath;
    } catch (e) {}
  }
  console.debug('[ensureAlarmSoundPersistent] No valid disk path, attempting recovery…');
  // Try to recover from IndexedDB as last resort
  try {
    const blob = await loadSoundBlob(alarm.id);
    if (blob) {
      console.log('Found blob in IndexedDB, re-persisting to disk');
      const dest = await persistFileToDisk(alarm.id, blob, alarm.soundFileName || 'recovered');
      if (dest) {
        alarm.soundPath = dest;
        saveAlarms();
        return dest;
      }
    }
  } catch (e) { console.warn('Recovery from IndexedDB failed', e); }
  return null;
}

function stopAlarmSound() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (fallbackOscillator) {
    try { fallbackOscillator.stop(); } catch(e) {}
    fallbackOscillator = null;
  }
  if (fallbackAudioCtx) {
    fallbackAudioCtx.close();
    fallbackAudioCtx = null;
  }
}

function playFallbackBeep() {
  try {
    fallbackAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = fallbackAudioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, fallbackAudioCtx.currentTime);
    osc.connect(fallbackAudioCtx.destination);
    osc.start();
    osc.stop(fallbackAudioCtx.currentTime + 1);
    fallbackOscillator = osc;
  } catch(e) { console.warn('Beep failed', e); }
}

// ── DOM refs ──
const alarmListEl       = document.getElementById('alarmList');
const editorPanelEl     = document.getElementById('editorPanel');
const previewBoxEl      = document.getElementById('previewBox');
const appDisplayEl      = document.getElementById('appDisplay');
const viewSwitchBtn     = document.getElementById('viewSwitchBtn');
const platformToggle    = document.getElementById('platformToggle');
const timeFormatToggle  = document.getElementById('timeFormatToggle');
const logPanel          = document.getElementById('logPanel');
const logToggle         = document.getElementById('logToggle');
const addAlarmBtn       = document.getElementById('addAlarmBtn');
const soundFileInput    = document.getElementById('soundFileInput');
const sidebarToggleBtn  = document.getElementById('sidebarToggleBtn');
const sidebarEl         = document.getElementById('sidebar');

// ── View switching ──
function setView(viewName) {
  console.debug('[setView]', viewName);
  document.getElementById('editorView').classList.toggle('active', viewName === 'editor');
  document.getElementById('appView').classList.toggle('active', viewName === 'app');
  viewSwitchBtn.textContent = viewName === 'editor' ? '📱' : '⚙️';
}

// ── Render alarm list ──
function renderAlarmList() {
  if (!alarmListEl) return;
  alarmListEl.innerHTML = alarms.map(a => {
    const primaryScreen = getCurrentScreenId(a, 'primary');
    const timeDisplay = a.triggerType === 'specific'
      ? formatTime(a.time, timeFormat24h)
      : '⛓ Chained';
    const isScheduled = alarmTimers.some(t => t.alarmId === a.id);
    return `
      <div class="alarm-item ${a.id === selectedAlarmId ? 'selected' : ''}" data-id="${a.id}">
        <div class="time">${timeDisplay} ${isScheduled ? '🔔' : ''}</div>
        <div style="font-weight:600;font-size:0.85rem;">${a.label || 'Unnamed'}</div>
        <div class="meta">
          <span class="badge">${primaryScreen}</span>
          ${a.triggerType === 'after-event' ? '<span class="badge chain">chain</span>' : ''}
          ${!a.enabled ? '<span class="badge disabled">off</span>' : ''}
        </div>
      </div>`;
  }).join('');
  alarmListEl.querySelectorAll('.alarm-item').forEach(el => {
    el.addEventListener('click', () => selectAlarm(el.dataset.id));
  });
}

function selectAlarm(id) {
  setSelectedAlarmId(id);
  renderAlarmList();
  renderEditor();
  updatePreview();
}

// ── Scheduling logic ──
function clearAllTimers() {
  alarmTimers.forEach(t => clearTimeout(t.timeoutId));
  alarmTimers = [];
}

async function scheduleAlarm(alarm) {
  if (!alarm.enabled || alarm.triggerType !== 'specific' || !alarm.time) return;
  try {
    await window.__TAURI__.core.invoke('schedule_alarm', {
      alarmId: alarm.id,
      time: alarm.time,
      label: alarm.label || 'Alarm',
      sound: alarm.soundFileName || '',
    });
  } catch (e) { console.error('schedule_alarm invoke failed:', e); }
  alarmTimers.push({ alarmId: alarm.id });
}

async function cancelAlarm(alarmId) {
  try { await window.__TAURI__.core.invoke('cancel_alarm', { alarmId }); } catch (e) {}
  alarmTimers = alarmTimers.filter(t => t.alarmId !== alarmId);
}

// Listen for alarm-triggered
window.__TAURI__.event.listen('alarm-triggered', (event) => {
  console.debug('[ALARM-TRIGGERED]', event.payload);
  triggerAlarm(event.payload);
}).catch(console.error);

function rescheduleAllAlarms() {
  clearAllTimers();
  alarms.filter(a => a.triggerType === 'specific').forEach(scheduleAlarm);
  renderAlarmList();
}

// ── Editor ──
function renderEditor() {
  const alarm = getAlarmById(selectedAlarmId);
  if (!alarm) {
    editorPanelEl.innerHTML = '<p style="color:var(--text2)">Select an alarm to edit.</p>';
    return;
  }

  const screenIds = ['simple-dismiss','swipe-dismiss','hold-dismiss','pattern-dismiss','between-message'];
  const options = screenIds.map(id => `<option value="${id}">${id}</option>`).join('');
  const emptyOption = '<option value="">None</option>';

  const desk = alarm.screens.desktop;
  const andr = alarm.screens.android;
  const eventSources = alarms
    .filter(a => a.id !== alarm.id)
    .map(a => `<option value="${a.id}">Alarm: ${a.label || a.time}</option>`)
    .join('') +
    alarms.map(a => `<option value="button-click:${a.id}">Button click on: ${a.label || a.time}</option>`).join('');

  const [h, m] = (alarm.time || '07:00').split(':').map(Number);
  const hours24 = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);
  const timeHelperText = !timeFormat24h && alarm.time
    ? `<div class="time-helper">12h equivalent: ${formatTime(alarm.time, false)}</div>`
    : '';

  editorPanelEl.innerHTML = `
    <div class="section-title">Basic</div>
    <div class="form-row">
      <div class="form-group"><label>Label</label><input id="editLabel" value="${alarm.label||''}"></div>
      <div class="form-group"><label>Trigger</label><select id="editTrigger">
        <option value="specific" ${alarm.triggerType==='specific'?'selected':''}>Specific Time</option>
        <option value="after-event" ${alarm.triggerType==='after-event'?'selected':''}>After Event</option>
      </select></div>
    </div>
    <div id="specificGroup" ${alarm.triggerType==='after-event'?'style="display:none"':''}>
      <div class="form-group">
        <label>Time (24h)</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <select id="editHour" style="width:80px;">${hours24.map(i => `<option value="${i}" ${i===h?'selected':''}>${String(i).padStart(2,'0')}</option>`).join('')}</select>
          <span style="font-size:1.2rem;">:</span>
          <select id="editMinute" style="width:80px;">${minutes.map(i => `<option value="${i}" ${i===m?'selected':''}>${String(i).padStart(2,'0')}</option>`).join('')}</select>
        </div>
        ${timeHelperText}
      </div>
    </div>
    <div id="afterGroup" ${alarm.triggerType==='after-event'?'':'style="display:none"'}>
      <div class="form-group"><label>Source Event</label><select id="editAfterSource"><option value="">-- select --</option>${eventSources}</select></div>
      <div class="form-group"><label>Delay (min)</label><input type="number" id="editAfterDelay" value="${alarm.afterEventDelay||5}" min="0" max="120"></div>
      <div class="checkbox-group"><input type="checkbox" id="editShowBetween" ${alarm.showBetweenScreen?'checked':''}><label>Show "between" screen</label></div>
    </div>

    <div class="section-title">🖥 Desktop Screens</div>
    <div class="form-row">
      <div class="form-group"><label>Primary</label><select id="deskPrimary">${options.replace(`value="${desk.primary}"`,`value="${desk.primary}" selected`)}</select></div>
      <div class="form-group"><label>Secondary</label><select id="deskSecondary">${emptyOption}${options.replace(`value="${desk.secondary}"`,`value="${desk.secondary}" selected`)}</select></div>
      <div class="form-group"><label>Between</label><select id="deskBetween">${emptyOption}${options.replace(`value="${desk.between}"`,`value="${desk.between}" selected`)}</select></div>
    </div>
    <div class="section-title">📱 Android Screens</div>
    <div class="form-row">
      <div class="form-group"><label>Primary</label><select id="andrPrimary">${options.replace(`value="${andr.primary}"`,`value="${andr.primary}" selected`)}</select></div>
      <div class="form-group"><label>Secondary</label><select id="andrSecondary">${emptyOption}${options.replace(`value="${andr.secondary}"`,`value="${andr.secondary}" selected`)}</select></div>
      <div class="form-group"><label>Between</label><select id="andrBetween">${emptyOption}${options.replace(`value="${andr.between}"`,`value="${andr.between}" selected`)}</select></div>
    </div>

    <div class="section-title">Sound & Behaviour</div>
    <div class="form-row">
      <div class="form-group">
        <label>Sound file</label>
        <div style="display:flex;gap:4px;">
          <span id="soundNameDisplay" style="flex:1;padding:8px;background:var(--surface2);border-radius:8px;">${alarm.soundFileName||'none'}</span>
          <button class="btn btn-outline" id="browseSoundBtn">📁</button>
        </div>
      </div>
      <div class="form-group"><label>Log message</label><input type="text" id="editLogMsg" value="${alarm.logMessage||''}"></div>
    </div>
    <div class="checkbox-group"><input type="checkbox" id="editDisable" ${alarm.disableAfterAction?'checked':''}><label>Disable after action</label></div>
    <div class="checkbox-group"><input type="checkbox" id="editEnabled" ${alarm.enabled?'checked':''}><label>Enabled</label></div>

    <div class="btn-row">
      <button class="btn btn-primary" id="saveBtn">💾 Save</button>
      <button class="btn btn-test" id="testBtn">▶ Test</button>
      <button class="btn btn-danger" id="deleteBtn">🗑 Delete</button>
    </div>
  `;

  // Listeners
  document.getElementById('editTrigger').addEventListener('change', function() {
    document.getElementById('specificGroup').style.display = this.value === 'specific' ? '' : 'none';
    document.getElementById('afterGroup').style.display = this.value === 'after-event' ? '' : 'none';
  });

  document.getElementById('browseSoundBtn').addEventListener('click', async () => {
    const alarm = getAlarmById(selectedAlarmId);
    if (!alarm) return;
    try {
      let filePath = null;
      // Try using native dialog
      if (window.__TAURI__.dialog && window.__TAURI__.dialog.open) {
        const selected = await window.__TAURI__.dialog.open({
          multiple: false,
          filters: [{ name: 'Audio', extensions: ['mp3','wav','ogg','m4a', 'flac'] }]
        });
        filePath = Array.isArray(selected) ? selected[0] : selected;
      }
      if (filePath) {
        const fileName = filePath.split(/[\\/]/).pop();
        alarm.soundFileName = fileName;
        alarm.soundUrl = null;
        const display = document.getElementById('soundNameDisplay');
        if (display) display.textContent = alarm.soundFileName;
        const promise = copyFilePathToDisk(alarm.id, filePath, fileName)
          .then(dest => {
            if (dest) {
              alarm.soundPath = dest;
              saveAlarms();
            }
            return dest;
          })
          .finally(() => { delete soundCopyPromises[alarm.id]; });
        soundCopyPromises[alarm.id] = promise;
      } else {
        soundFileInput.click();
      }
    } catch (e) {
      console.warn('Dialog error, falling back to file input', e);
      soundFileInput.click();
    }
  });

  document.getElementById('saveBtn').addEventListener('click', () => {
    saveCurrentAlarm(alarm);
    rescheduleAllAlarms();
  });

  document.getElementById('testBtn').addEventListener('click', async () => {
    saveCurrentAlarm(alarm);
    rescheduleAllAlarms();
    await triggerAlarm(alarm.id);
  });

  document.getElementById('deleteBtn').addEventListener('click', () => {
    if (confirm('Delete this alarm?')) {
      const idx = alarms.findIndex(a => a.id === alarm.id);
      if (idx !== -1) {
        try { deleteSoundBlob(alarm.id); } catch(e) {}
        try { if (alarm.soundFileName) deleteCopiedFile(alarm.id, alarm.soundFileName); } catch(e) {}
        alarms.splice(idx, 1);
        saveAlarms();
        rescheduleAllAlarms();
        renderAlarmList();
        if (alarms.length) {
          selectAlarm(alarms[0].id);
        } else {
          setSelectedAlarmId(null);
          renderEditor();
          updatePreview();
        }
      }
    }
  });
}

function saveCurrentAlarm(alarm) {
  alarm.label          = document.getElementById('editLabel').value;
  alarm.triggerType    = document.getElementById('editTrigger').value;
  if (alarm.triggerType === 'specific') {
    const h = document.getElementById('editHour').value.padStart(2,'0');
    const m = document.getElementById('editMinute').value.padStart(2,'0');
    alarm.time = `${h}:${m}`;
  } else {
    alarm.afterEventSource = document.getElementById('editAfterSource').value;
    alarm.afterEventDelay  = parseInt(document.getElementById('editAfterDelay').value) || 5;
    alarm.showBetweenScreen = document.getElementById('editShowBetween').checked;
  }
  alarm.screens.desktop.primary   = document.getElementById('deskPrimary').value;
  alarm.screens.desktop.secondary = document.getElementById('deskSecondary').value;
  alarm.screens.desktop.between   = document.getElementById('deskBetween').value;
  alarm.screens.android.primary   = document.getElementById('andrPrimary').value;
  alarm.screens.android.secondary = document.getElementById('andrSecondary').value;
  alarm.screens.android.between   = document.getElementById('andrBetween').value;
  alarm.disableAfterAction = document.getElementById('editDisable').checked;
  alarm.enabled            = document.getElementById('editEnabled').checked;
  alarm.logMessage         = document.getElementById('editLogMsg').value;
  saveAlarms();
  renderAlarmList();
  updatePreview();
}

// ── Preview ──
function updatePreview() {
  const alarm = getAlarmById(selectedAlarmId);
  if (!alarm) {
    previewBoxEl.innerHTML = '<span style="color:var(--text2)">No alarm selected</span>';
    return;
  }
  const screenId = getCurrentScreenId(alarm, 'primary');
  if (!screenId) return;
  loadScreen(screenId).then(screenDef => {
    if (!screenDef) return;
    if (previewBoxEl._cleanup) previewBoxEl._cleanup();
    previewBoxEl.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.className = 'alarm-overlay';
    overlay.style.position = 'relative';
    overlay.innerHTML = `
      <div class="icon">🔔</div>
      <div class="time">${formatTime(alarm.time||'--:--', timeFormat24h)}</div>
      <div class="sub">${alarm.label||''}</div>
      <div class="sound-indicator">🔊 ${alarm.soundFileName||'none'}</div>
      <div id="previewScreenContainer"></div>`;
    previewBoxEl.appendChild(overlay);
    const ctx = { disabled: false, onAction: (type) => addLog(`[Preview] ${type}`) };
    renderScreen(overlay.querySelector('#previewScreenContainer'), screenDef, ctx);
    previewBoxEl._cleanup = () => screenDef.cleanup(overlay.querySelector('#previewScreenContainer'));
  });
}

// ── Alarm Overlay (App View) + Sound ──
async function showAlarmScreen(alarm, container, isSecondary = false, betweenInfo = null) {
  if (container._cleanup) container._cleanup();
  container.innerHTML = '';
  const screenId = getCurrentScreenId(alarm, isSecondary ? 'secondary' : 'primary');
  const screenDef = await loadScreen(screenId);
  if (!screenDef) return;

  const overlay = document.createElement('div');
  overlay.className = 'alarm-overlay';
  overlay.innerHTML = `
    <div class="icon">🔔</div>
    <div class="time">${formatTime(alarm.time||'--:--', timeFormat24h)}</div>
    <div class="sub">${alarm.label||''}</div>
    <div class="sound-indicator">🔊 ${alarm.soundFileName||'tone'}</div>
    <div id="activeScreenContent"></div>`;
  container.appendChild(overlay);

  const content = overlay.querySelector('#activeScreenContent');
  const context = {
    disabled: false,
    onAction: (actionType) => {
      addLog(`[Action] ${actionType} on "${alarm.label}"`);
      const secondaryId = getCurrentScreenId(alarm, 'secondary');
      if (secondaryId && !isSecondary) {
        screenDef.cleanup(content);
        showAlarmScreen(alarm, container, true);
      } else {
        finalDismiss(alarm, container);
      }
    },
    betweenSource: betweenInfo?.sourceLabel,
    betweenTarget: betweenInfo?.targetLabel
  };
  renderScreen(content, screenDef, context);
  container._cleanup = () => screenDef.cleanup(content);

  playAlarmSound(alarm);
}

function finalDismiss(alarm, container) {
  addLog(alarm.logMessage || `Alarm "${alarm.label}" dismissed`);
  stopAlarmSound();
  if (container._cleanup) container._cleanup();
  container.querySelectorAll('.alarm-overlay').forEach(o => o.remove());
  activeAlarmId = null;
  handleChained(alarm.id);
  setView('editor');
  updatePreview();
  rescheduleAllAlarms();
}

// ── Chained alarms ──
function handleChained(sourceId) {
  const chained = alarms.filter(a =>
    a.triggerType === 'after-event' &&
    a.enabled &&
    (a.afterEventSource === sourceId || a.afterEventSource === 'button-click:' + sourceId)
  );
  chained.forEach(target => {
    const source = getAlarmById(sourceId);
    const delayMs = (target.afterEventDelay || 1) * 60000;
    addLog(`Chained "${target.label}" scheduled in ${target.afterEventDelay} min`);
    if (target.showBetweenScreen) {
      showBetweenScreen(source, target, delayMs);
    } else {
      setTimeout(() => triggerAlarm(target.id), delayMs);
    }
  });
}

async function showBetweenScreen(source, target, delayMs) {
  const betweenId = getCurrentScreenId(target, 'between') || 'between-message';
  const screenDef = await loadScreen(betweenId);
  if (!screenDef) return;
  const container = document.getElementById('appDisplay');
  if (container._cleanup) container._cleanup();
  container.innerHTML = '';
  const overlay = document.createElement('div');
  overlay.className = 'alarm-overlay';
  overlay.innerHTML = `<div id="betweenContent"></div>`;
  container.appendChild(overlay);
  const ctx = { betweenSource: source?.label || '?', betweenTarget: target.label || '?' };
  renderScreen(overlay.querySelector('#betweenContent'), screenDef, ctx);
  container._cleanup = () => screenDef.cleanup(overlay.querySelector('#betweenContent'));
  setTimeout(() => triggerAlarm(target.id), delayMs);
}

export async function triggerAlarm(alarmId) {
  console.debug('[triggerAlarm]', alarmId);
  const alarm = getAlarmById(alarmId);
  if (!alarm || !alarm.enabled) return;
  if (soundCopyPromises[alarm.id]) await soundCopyPromises[alarm.id];
  await ensureAlarmSoundPersistent(alarm);
  setView('app');
  showAlarmScreen(alarm, document.getElementById('appDisplay'));
}

window.triggerAlarm = triggerAlarm;

// ── Sound file input fallback ──
function setupSoundInput() {
  soundFileInput.addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    const alarm = getAlarmById(selectedAlarmId);
    if (!alarm) return;
    alarm.soundFileName = file.name;
    alarm.soundUrl = null;
    const display = document.getElementById('soundNameDisplay');
    if (display) display.textContent = file.name;
    // Save to IndexedDB as backup
    try { saveSoundBlob(alarm.id, file); } catch(e) {}
    const promise = persistFileToDisk(alarm.id, file, file.name)
      .then(dest => {
        if (dest) {
          alarm.soundPath = dest;
          saveAlarms();
        }
        return dest;
      })
      .finally(() => { delete soundCopyPromises[alarm.id]; });
    soundCopyPromises[alarm.id] = promise;
  });
}

// ── Sidebar toggle ──
function toggleSidebar() {
  sidebarEl.classList.toggle('hidden');
}

// ── Init ──
async function init() {
  loadAlarms();
  console.debug('[init] Alarms loaded:', alarms.length);

  if (window.__PENDING_ALARM_ID__) {
    const pending = window.__PENDING_ALARM_ID__;
    if (sidebarEl) sidebarEl.classList.add('hidden');
    setView('app');
    const pendingAlarm = getAlarmById(pending);
    if (pendingAlarm) await ensureAlarmSoundPersistent(pendingAlarm);
    triggerAlarm(pending);
    delete window.__PENDING_ALARM_ID__;
  }

  rescheduleAllAlarms();
  renderAlarmList();
  if (alarms.length) selectAlarm(alarms[0].id);

  waitForUserGestureToUnlockAudio();

  viewSwitchBtn.addEventListener('click', () => {
    setView(document.getElementById('editorView').classList.contains('active') ? 'app' : 'editor');
  });

  platformToggle.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      platformToggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setCurrentPlatform(btn.dataset.mode);
      renderAlarmList();
      updatePreview();
    });
  });

  timeFormatToggle.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      timeFormatToggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setTimeFormat24h(btn.dataset.format === '24h');
      renderAlarmList();
      renderEditor();
      updatePreview();
    });
  });

  logToggle.addEventListener('click', () => logPanel.classList.toggle('open'));

  addAlarmBtn.addEventListener('click', () => {
    const newAlarm = {
      id: 'a' + Date.now(),
      label: 'New Alarm',
      time: '08:00',
      triggerType: 'specific',
      afterEventSource: '',
      afterEventDelay: 5,
      screens: {
        desktop: { primary: 'simple-dismiss', secondary: '', between: '' },
        android:  { primary: 'swipe-dismiss', secondary: '', between: '' }
      },
      soundFileName: 'default.mp3',
      soundUrl: null,
      soundPath: null,
      disableAfterAction: true,
      logMessage: '',
      showBetweenScreen: false,
      enabled: true
    };
    alarms.push(newAlarm);
    saveAlarms();
    rescheduleAllAlarms();
    renderAlarmList();
    selectAlarm(newAlarm.id);
  });

  setupSoundInput();
}

if (sidebarToggleBtn) {
  sidebarToggleBtn.addEventListener('click', toggleSidebar);
}

init();