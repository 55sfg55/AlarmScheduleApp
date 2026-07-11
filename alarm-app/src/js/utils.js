// utils.js – Formatting and logging

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