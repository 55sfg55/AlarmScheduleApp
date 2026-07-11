// app.js – alarm scheduling, sidebar toggle, 24h editor helper, sound

import {
  loadAlarms, saveAlarms, alarms,
  selectedAlarmId, currentPlatform, timeFormat24h,
  getAlarmById, getCurrentScreenId,
  setSelectedAlarmId, setCurrentPlatform, setTimeFormat24h
} from './alarmStore.js';
import { addLog, formatTime } from './utils.js';
import { loadScreen, renderScreen, getAvailableScreenIds } from './screenLoader.js';

const { getCurrentWindow } = window.__TAURI__.window;

const win = getCurrentWindow();


let activeAlarmId = null;
let suppressIdleScreen = false;
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

  // ── When leaving app view, stop idle audio and remove idle overlays ──
  if (viewName === 'editor') {
    const container = document.getElementById('appDisplay');
    if (container._idleAudio) {
      container._idleAudio.pause();
      container._idleAudio = null;
    }
    container.querySelectorAll('.alarm-overlay[data-idle]').forEach(o => o.remove());
    if (container._cleanup && container._cleanup._isIdle) {
      container._cleanup();
      container._cleanup = null;
    }
  }

  // ── When entering app view, always create fresh idle screen ──
  if (viewName === 'app') {
    updateAppViewIdleScreen();
  }
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
async function clearAllTimers() {
  await alarmTimers.forEach(t => clearTimeout(t.timeoutId));
  for (const t of alarmTimers) {
    try {
      await window.__TAURI__.core.invoke('cancel_alarm', { alarmId: t.alarmId });
    } catch (e) {
      // Ignore errors (alarm might already be gone)
    }
  }
  // 2. Reset the local tracker
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



async function rescheduleAllAlarms() {
  await clearAllTimers();
  alarms.filter(a => a.triggerType === 'specific').forEach(scheduleAlarm);
  renderAlarmList();
}

function stopAllSounds() {
  stopAlarmSound();  // stops currentAudio, fallback, etc.
  const container = document.getElementById('appDisplay');
  if (container._idleAudio) {
    container._idleAudio.pause();
    container._idleAudio = null;
  }
}

async function updateAppViewIdleScreen() {
    if (suppressIdleScreen) return; 

    const container = document.getElementById('appDisplay');

    // ── Remove any existing idle screen, stop audio, and clean up mute button ──
    container.querySelectorAll('.alarm-overlay[data-idle]').forEach(o => o.remove());
    if (container._idleAudio) {
      container._idleAudio.pause();
      container._idleAudio = null;
    }
    if (container._idleMuteBtn) {
      container._idleMuteBtn.remove();
      container._idleMuteBtn = null;
    }
    if (container._cleanup && container._cleanup._isIdle) {
      container._cleanup();
      container._cleanup = null;
    }

    // ── Only continue if app view is active and no real alarm overlay exists ──
    if (!document.getElementById('appView').classList.contains('active')) return;
    if (container.querySelector('.alarm-overlay:not([data-idle])')) return;  // real alarm present

    const betweenAlarm = alarms.find(a =>
      a.triggerType === 'between' &&
      a.enabled &&
      getAlarmById(a.sourceId)?.enabled &&
      getAlarmById(a.targetId)?.enabled
    );

    if (!betweenAlarm) return;  // no valid idle screen

    if (betweenAlarm.soundPath) {
      // Stop any previous idle audio
      if (container._idleAudio) {
        container._idleAudio.pause();
        container._idleAudio = null;
      }
      // Use the same play function (modify playAlarmSound to accept a loop param if needed)
      // await playAlarmSound(betweenAlarm);
      // Store reference for cleanup
      container._idleAudio = currentAudio;
      
      
    }

    // Ensure the container is positioned for absolute children
    container.style.position = 'relative';

    // Render the between screen as the fresh idle background
    loadScreen(betweenAlarm.screenId || 'between-message').then(async screenDef => {
      if (!screenDef) return;
      if (!document.getElementById('appView').classList.contains('active')) return;
      if (container.querySelector('.alarm-overlay:not([data-idle])')) return;
      if (suppressIdleScreen) return;


       if (betweenAlarm.soundPath) {
        // Stop any lingering audio (just in case)
        stopAllSounds();
        // stopAlarmSound(); already called in stopAllSounds()
        await playAlarmSound(betweenAlarm);
        container._idleAudio = currentAudio;
      }

      container.innerHTML = '';  // clear again (but mute button is already gone)
      
      const overlay = document.createElement('div');
      overlay.className = 'alarm-overlay';
      overlay.setAttribute('data-idle', 'true');
      overlay.innerHTML = '<div id="idleScreenContent"></div>';
      container.appendChild(overlay);

      // ── Mute button (corner of the whole app display) ──
      const muteBtn = document.createElement('button');
      muteBtn.className = 'idle-mute-btn';
      muteBtn.innerHTML = '🔊';   // unmuted icon
      muteBtn.title = 'Mute ambient sound';
      muteBtn.style.cssText = `
        position: absolute; top: 10px; right: 10px; z-index: 1000;
        background: rgba(0,0,0,0.5); border: none; color: white;
        font-size: 1.5rem; border-radius: 50%; width: 40px; height: 40px;
        cursor: pointer;
      `;
      let isMuted = false;
      muteBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        muteBtn.innerHTML = isMuted ? '🔇' : '🔊';
        if (container._idleAudio) {
          container._idleAudio.muted = isMuted;
        }
      });
      container.appendChild(muteBtn);
      container._idleMuteBtn = muteBtn;   // store reference for cleanup

      const ctx = {
        disabled: false,
        onAction: () => {},  // decorative only
        betweenSource: getAlarmById(betweenAlarm.sourceId)?.label,
        betweenTarget: getAlarmById(betweenAlarm.targetId)?.label
      };

      renderScreen(overlay.querySelector('#idleScreenContent'), screenDef, ctx);
      
      // Cleanup: remove the overlay and the mute button
      container._cleanup = () => {
        screenDef.cleanup(overlay.querySelector('#idleScreenContent'));
        if (container._idleMuteBtn) {
          container._idleMuteBtn.remove();
          container._idleMuteBtn = null;
        }
      };
      container._cleanup._isIdle = true;

      // commented out ambient looping sound, since it is most likely a leftover from the previous implementation and not needed anymore. The sound is already handled by playAlarmSound function above. 
      // It also broke "beetween alarm"'s muting button in cases where the screen didn't threw an error.
      // Observed in dev-between.html while lines now deleted from window.__screenDef.js caused reading undefined error which made the mute button work as to opposite case where the lines were removed (and didn't cause an error) and the mute button didn't work - because the code below was treated as the current sound (so the one affected by mute button) even thought "previous sound" (the only one playing) was the one supposed to be muted.
      // Issue was related to container._idleAudio
      // This block was only executed when mentioned code in window.__screenDef.js didn't throw an error.
      //
      // Ambient looping sound (unchanged)
      // if (betweenAlarm.soundPath) {
      //   const src = window.__TAURI__.core.convertFileSrc(betweenAlarm.soundPath);
      //   const audio = new Audio(src);
      //   audio.loop = true;
      //   audio.volume = 0.3;
      //   audio.play().catch(e => console.warn('Idle sound failed', e));
      //   container._idleAudio = audio;
      // }
    });
}


// ── Editor ──
async function renderEditor() {
  const alarm = getAlarmById(selectedAlarmId);
  if (!alarm) {
    editorPanelEl.innerHTML = '<p style="color:var(--text2)">Select an alarm to edit.</p>';
    return;
  }

    // Get the full list of available screen IDs (includes static + file-based)
  // const screenIds = await getAvailableScreenIds();
  // Sort alphabetically for a clean dropdown
  

  // const options = screenIds.map(id => `<option value="${id}">${id}</option>`).join('');
  // const emptyOption = '<option value="">None</option>';



  const screenIds = await getAvailableScreenIds();
  screenIds.sort();
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

  // ── Between alarm dropdowns (with preselection) ──
  const betweenSourceOptions = alarms
    .filter(a => a.id !== alarm.id)
    .map(a => `<option value="${a.id}" ${alarm.sourceId === a.id ? 'selected' : ''}>${a.label || a.time || a.id}</option>`)
    .join('') || '<option value="">-- no other alarms --</option>';

  const betweenTargetOptions = alarms
    .filter(a => a.id !== alarm.id)
    .map(a => `<option value="${a.id}" ${alarm.targetId === a.id ? 'selected' : ''}>${a.label || a.time || a.id}</option>`)
    .join('') || '<option value="">-- no other alarms --</option>';

  const betweenScreenOptions = screenIds
    .map(id => `<option value="${id}" ${alarm.screenId === id ? 'selected' : ''}>${id}</option>`)
    .join('');

  editorPanelEl.innerHTML = `
    <div class="section-title">Basic</div>
    <div class="form-row">
      <div class="form-group"><label>Label</label><input id="editLabel" value="${alarm.label||''}"></div>
      <div class="form-group"><label>Trigger</label><select id="editTrigger">
        <option value="specific" ${alarm.triggerType==='specific'?'selected':''}>Specific Time</option>
        <option value="after-event" ${alarm.triggerType==='after-event'?'selected':''}>After Event</option>
        <option value="between" ${alarm.triggerType==='between'?'selected':''}>Between</option>
      </select></div>
    </div>

    <div id="specificGroup" ${alarm.triggerType==='between' || alarm.triggerType==='after-event'?'style="display:none"':''}>
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
    </div>

    <div id="betweenGroup" ${alarm.triggerType==='between'?'':'style="display:none"'}>
      <div class="form-group"><label>Source Alarm</label><select id="editBetweenSource"><option value="">-- select --</option>${betweenSourceOptions}</select></div>
      <div class="form-group"><label>Target Alarm</label><select id="editBetweenTarget"><option value="">-- select --</option>${betweenTargetOptions}</select></div>
      <div class="form-group"><label>Screen</label><select id="editBetweenScreen">${betweenScreenOptions}</select></div>
    </div>

    <div class="checkbox-group"><input type="checkbox" id="editShowBetween" ${alarm.showBetweenScreen?'checked':''}><label>Show "between" screen</label></div>

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
    document.getElementById('betweenGroup').style.display = this.value === 'between' ? '' : 'none';
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
        // Delete old sound file before copying the new one
        if (alarm.soundPath) {
          await deleteCopiedFile(alarm.id, alarm.soundFileName);
          try { await deleteSoundBlob(alarm.id); } catch (e) {}
        }

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
  }
  else if (alarm.triggerType === 'between') {
    alarm.sourceId = document.getElementById('editBetweenSource').value;
    alarm.targetId = document.getElementById('editBetweenTarget').value;
    alarm.screenId = document.getElementById('editBetweenScreen').value;
  }
  else {
    alarm.afterEventSource = document.getElementById('editAfterSource').value;
    alarm.afterEventDelay  = parseInt(document.getElementById('editAfterDelay').value) || 5;
  }

  alarm.showBetweenScreen = document.getElementById('editShowBetween').checked;
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

function buildAlarmHeader(alarm, screenDef) {
  const defaultHeader = `
    <div class="icon">🔔</div>
    <div class="time">${formatTime(alarm.time||'--:--', timeFormat24h)}</div>
    <div class="sub">${alarm.label||''}</div>
    <div class="sound-indicator">🔊 ${alarm.soundFileName||'tone'}</div>`;

  if (!screenDef || typeof screenDef.headerHtml !== 'string') {
    return defaultHeader;
  }

  // Replace placeholders with actual alarm data
  return screenDef.headerHtml
    .replace(/\{\{time\}\}/g,   formatTime(alarm.time||'--:--', timeFormat24h))
    .replace(/\{\{label\}\}/g,  alarm.label || '')
    .replace(/\{\{icon\}\}/g,   '🔔')
    .replace(/\{\{sound\}\}/g,  alarm.soundFileName || 'tone');
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

    // Use custom header if provided
    overlay.innerHTML = buildAlarmHeader(alarm, screenDef) + `<div id="previewScreenContainer"></div>`;

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

  // Use custom header if provided
  overlay.innerHTML = buildAlarmHeader(alarm, screenDef) + `<div id="activeScreenContent"></div>`;

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
    betweenTarget: betweenInfo?.targetLabel,
    time: formatTime(alarm.time || '--:--', timeFormat24h),
    label: alarm.label || '',
    icon: '🔔',
    sound: alarm.soundFileName || 'tone',
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

  // Check if a between screen will be shown for any chained alarm
  const hasBetween = alarms.some(a =>
    a.triggerType === 'after-event' &&
    a.enabled &&
    (a.afterEventSource === alarm.id || a.afterEventSource === 'button-click:' + alarm.id) &&
    a.showBetweenScreen
  );

  handleChained(alarm.id);

  // Only return to editor if no between screen is imminent
  // if (!hasBetween) {
  //   setView('editor');
  // }

  suppressIdleScreen = false;          // <-- re-enable idle screen
  updateAppViewIdleScreen(); 

  updatePreview();
  rescheduleAllAlarms();
}

// ── Chained alarms ──
function handleChained(sourceId) {
  const source = getAlarmById(sourceId);
  const chained = alarms.filter(a =>
    a.triggerType === 'after-event' &&
    a.enabled &&
    (a.afterEventSource === sourceId || a.afterEventSource === 'button-click:' + sourceId)
  );

  chained.forEach(target => {
    const delayMs = (target.afterEventDelay || 1) * 60000;
    const targetTime = new Date(Date.now() + delayMs);
    const hh = String(targetTime.getHours()).padStart(2, '0');
    const mm = String(targetTime.getMinutes()).padStart(2, '0');
    const timeStr = `${hh}:${mm}`;

    addLog(`Chained "${target.label}" scheduled at ${timeStr}`);

    window.__TAURI__.core.invoke('schedule_alarm', {
      alarmId: target.id,
      time: timeStr,
      label: target.label || 'Alarm',
      sound: target.soundFileName || '',
    }).catch(e => console.error('schedule_alarm for chained failed:', e));

    // DO NOT add to alarmTimers – it will be killed by rescheduleAllAlarms
    // alarmTimers.push({ alarmId: target.id });   ← remove this

    if (source && source.showBetweenScreen) {
      showBetweenScreen(source, target, delayMs);
    }
  });
}

async function showBetweenScreen(source, target, delayMs) {
  // const betweenId = getCurrentScreenId(target, 'between') || 'between-message';
  const betweenId = getCurrentScreenId(source, 'between') || 'between-message';
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

function clearIdleScreen() {
  const container = document.getElementById('appDisplay');
  container.querySelectorAll('.alarm-overlay[data-idle]').forEach(o => o.remove());
  if (container._idleAudio) {
    container._idleAudio.pause();
    container._idleAudio = null;
  }
  if (container._idleMuteBtn) {
    container._idleMuteBtn.remove();
    container._idleMuteBtn = null;
  }
  if (container._cleanup && container._cleanup._isIdle) {
    container._cleanup();
    container._cleanup = null;
  }
}

export async function triggerAlarm(alarmId) {
  console.debug('[triggerAlarm]', alarmId);
  const alarm = getAlarmById(alarmId);
  if (!alarm || !alarm.enabled) return;
  if (soundCopyPromises[alarm.id]) await soundCopyPromises[alarm.id];
  await ensureAlarmSoundPersistent(alarm);

  clearIdleScreen();   // <-- always remove idle overlay and stop its sound
  suppressIdleScreen = true;   // ← prevent idle screen from spawning
  setView('app');

  const container = document.getElementById('appDisplay');
  // Stop idle audio if playing
  if (container._idleAudio) {
    container._idleAudio.pause();
    container._idleAudio = null;
  }
  // Remove idle overlay (showAlarmScreen will also call _cleanup, but we can do it explicitly)
  if (container._cleanup) {
    container._cleanup();
    container._cleanup = null;
  }
  container.innerHTML = '';
  // setView('app'); // already above
  await win.maximize();
  await win.setFocus();
  await win.setAlwaysOnTop(true);
  await win.setAlwaysOnTop(false);
  await showAlarmScreen(alarm, container);

  // suppressIdleScreen = false;  // ← re‑allow idle screen later
}

window.triggerAlarm = triggerAlarm;

// ── Sound file input fallback ──
function setupSoundInput() {
  soundFileInput.addEventListener('change', async function() {
    const file = this.files[0];
    if (!file) return;
    const alarm = getAlarmById(selectedAlarmId);
    if (!alarm) return;

    // Delete old sound file and IndexedDB backup before saving the new one
    if (alarm.soundPath) {
      await deleteCopiedFile(alarm.id, alarm.soundFileName);
      try { await deleteSoundBlob(alarm.id); } catch (e) {}
    }

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
    suppressIdleScreen = true;
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