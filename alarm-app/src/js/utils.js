// utils.js – Formatting and logging
import { alarms } from './alarmStore.js';  

export function formatTime(hhmm, use24h = true) {
  if (!hhmm || hhmm.length !== 5) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  if (use24h) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

export const logEntries = [];

export function addLog(message) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  logEntries.unshift({ time: timeStr, msg: message });
  if (logEntries.length > 200) logEntries.pop();
  renderLogPanel();
}

function renderLogPanel() {
  const container = document.getElementById('logContent');
  if (!container) return;
  container.innerHTML = logEntries.map(e => `<div class="log-entry"><span class="log-time">${e.time}</span>${e.msg}</div>`).join('');
}

export function exportLogs(filename = 'alarm-logs.json') {
  const jsonString = JSON.stringify(logEntries, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


function toMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

export function isTimeBlocked(timeStr) {
  if (timeStr == "now") {
    const now = new Date();
    timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  }
  const nowMin = toMinutes(timeStr);
  for (const a of alarms) {
    if (a.triggerType !== 'blocking' || !a.enabled) continue;
    const start = toMinutes(a.blockStartTime);
    const end   = toMinutes(a.blockEndTime);
    // Interval may cross midnight
    if (start < end) {
      if (nowMin >= start && nowMin < end) return true;
    } else {
      if (nowMin >= start || nowMin < end) return true;
    }
  }
  return false;
}