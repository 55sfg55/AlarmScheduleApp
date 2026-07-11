// screenLoader.js – Full implementation with all screen interactions

const screenTemplates = {
  'simple-dismiss': {
    html: `<div class="screen-simple {{disabled}}"><button class="dismiss-btn">Dismiss</button></div>`,
    js: function(container, context) {
      container.innerHTML = container.innerHTML.replace('{{disabled}}', context.disabled ? 'disabled' : '');
      const btn = container.querySelector('.dismiss-btn');
      if (btn && !context.disabled) {
        btn.addEventListener('click', () => context.onAction('button'));
      }
    },
    cleanup: function(container) { container.innerHTML = ''; }
  },

  'swipe-dismiss': {
    html: `<div class="screen-swipe">
      <div class="swipe-track"><div class="swipe-thumb">➤</div><div class="swipe-label">Swipe →</div></div>
    </div>`,
    js: function(container, context) {
      if (context.disabled) return;
      const track = container.querySelector('.swipe-track');
      const thumb = track.querySelector('.swipe-thumb');
      const label = track.querySelector('.swipe-label');
      let dragging = false, startX = 0, thumbLeft = 3;
      const maxLeft = track.clientWidth - thumb.clientWidth - 6;

      function reset() { thumbLeft = 3; thumb.style.left = '3px'; track.classList.remove('swiped'); label.textContent = 'Swipe →'; }
      function onStart(e) { dragging = true; startX = (e.touches ? e.touches[0].clientX : e.clientX) - thumbLeft; }
      function onMove(e) {
        if (!dragging) return;
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        thumbLeft = Math.max(3, Math.min(cx - startX, maxLeft));
        thumb.style.left = thumbLeft + 'px';
        if (thumbLeft > maxLeft * 0.7) { track.classList.add('swiped'); label.textContent = 'Release ✓'; }
        else { track.classList.remove('swiped'); label.textContent = 'Swipe →'; }
      }
      function onEnd() {
        if (!dragging) return;
        dragging = false;
        if (thumbLeft > maxLeft * 0.7) { thumb.style.left = maxLeft + 'px'; track.classList.add('swiped'); setTimeout(() => context.onAction('swipe'), 300); }
        else reset();
      }
      thumb.addEventListener('mousedown', onStart);
      thumb.addEventListener('touchstart', onStart, { passive: false });
      window.addEventListener('mousemove', onMove);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('mouseup', onEnd);
      window.addEventListener('touchend', onEnd);
      container._swipeCleanup = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('mouseup', onEnd);
        window.removeEventListener('touchend', onEnd);
      };
      reset();
    },
    cleanup: function(container) { if (container._swipeCleanup) container._swipeCleanup(); container.innerHTML = ''; }
  },

  'hold-dismiss': {
    html: `<div class="screen-hold">
      <button class="hold-btn">
        <svg class="progress-ring" width="86" height="86" viewBox="0 0 86 86"><circle cx="43" cy="43" r="40"/></svg>
        HOLD
      </button>
    </div>`,
    js: function(container, context) {
      if (context.disabled) return;
      const btn = container.querySelector('.hold-btn');
      const circle = btn.querySelector('circle');
      const circumference = 2 * Math.PI * 40;
      circle.style.strokeDasharray = circumference;
      circle.style.strokeDashoffset = circumference;
      let timer, start;
      function startHold(e) {
        e.preventDefault();
        start = Date.now();
        circle.style.strokeDashoffset = circumference;
        timer = setInterval(() => {
          const progress = Math.min((Date.now() - start) / 2000, 1);
          circle.style.strokeDashoffset = circumference * (1 - progress);
          if (progress >= 1) { clearInterval(timer); context.onAction('hold'); }
        }, 50);
      }
      function cancelHold() { if (timer) clearInterval(timer); circle.style.strokeDashoffset = circumference; }
      btn.addEventListener('mousedown', startHold);
      btn.addEventListener('touchstart', startHold, { passive: false });
      btn.addEventListener('mouseup', cancelHold);
      btn.addEventListener('mouseleave', cancelHold);
      btn.addEventListener('touchend', cancelHold);
      btn.addEventListener('touchcancel', cancelHold);
      container._holdCleanup = cancelHold;
    },
    cleanup: function(container) { if (container._holdCleanup) container._holdCleanup(); container.innerHTML = ''; }
  },

  'pattern-dismiss': {
    html: `<div class="screen-pattern">
      <p style="margin-bottom:10px;color:var(--text2);">Tap: 1 → 2 → 3</p>
      <div class="pattern-grid"><div class="pattern-dot">1</div><div class="pattern-dot">2</div><div class="pattern-dot">3</div></div>
    </div>`,
    js: function(container, context) {
      if (context.disabled) return;
      const sequence = [1,2,3]; let step = 0;
      const dots = container.querySelectorAll('.pattern-dot');
      dots.forEach(dot => {
        dot.addEventListener('click', () => {
          const num = parseInt(dot.textContent);
          if (num === sequence[step]) { dot.classList.add('tapped'); step++; if (step === sequence.length) context.onAction('pattern'); }
          else { dot.classList.add('wrong'); setTimeout(() => dot.classList.remove('wrong'), 400); step = 0; dots.forEach(d => d.classList.remove('tapped')); }
        });
      });
    },
    cleanup: function(container) { container.innerHTML = ''; }
  },

  'between-message': {
    html: `<div class="screen-between"><p>Now between</p><p class="between-msg">{{sourceLabel}}</p><p>and</p><p class="between-msg">{{targetLabel}}</p></div>`,
    js: function(container, context) {
      container.innerHTML = container.innerHTML.replace('{{sourceLabel}}', context.betweenSource || '?').replace('{{targetLabel}}', context.betweenTarget || '?');
    },
    cleanup: function(container) { container.innerHTML = ''; }
  }
};

// ── Dynamic screen file loader via Tauri command ──
const screenFileCache = {};

async function loadScreenFromFile(screenId) {
  if (screenFileCache[screenId]) return screenFileCache[screenId];

  try {
    // Read the HTML file from disk – no HTTP fetch!
    const htmlText = await window.__TAURI__.core.invoke('read_screen_file', {
      screenId: screenId
    });

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');

    const allScripts = [...doc.querySelectorAll('script')];
    const targetScript = allScripts.find(s => s.textContent.includes('window.__screenDef'));
    if (!targetScript) throw new Error('No __screenDef script found');

    // Execute the script in global scope
    window.__screenDef = null;
    (0, eval)(targetScript.textContent);

    const screenDef = window.__screenDef;
    if (!screenDef || typeof screenDef.js !== 'function' || typeof screenDef.cleanup !== 'function') {
      throw new Error('Invalid __screenDef');
    }

    // Visual HTML (body minus scripts)
    const bodyClone = doc.body.cloneNode(true);
    bodyClone.querySelectorAll('script').forEach(s => s.remove());
    screenDef.html = bodyClone.innerHTML.trim();

    screenFileCache[screenId] = screenDef;
    return screenDef;
  } catch (err) {
    console.error(`Failed to load screen "${screenId}":`, err);
    return null;
  }
}

// ── Get all available screen IDs ──
export async function getAvailableScreenIds() {
  const staticIds = Object.keys(screenTemplates);
  try {
    const fileIds = await window.__TAURI__.core.invoke('list_screen_files');
    const allIds = [...new Set([...staticIds, ...fileIds])];
    return allIds.sort();
  } catch (e) {
    console.warn('Could not list screen files, using static list', e);
    return staticIds;
  }
}

// ── Exported functions ──
export async function loadScreen(screenId) {
  if (screenTemplates[screenId]) return screenTemplates[screenId];
  return loadScreenFromFile(screenId);
}

export function renderScreen(container, screenDef, context) {
  // Start with the screen's visual HTML
  let html = screenDef.html;

  // Replace {{disabled}} first (special case for CSS class)
  html = html.replace('{{disabled}}', context.disabled ? 'disabled' : '');

  // Replace any other {{key}} with context[key] if it exists
  html = html.replace(/\{\{(.+?)\}\}/g, (match, key) => {
    // If context has this key, use its value; otherwise leave placeholder untouched
    return context.hasOwnProperty(key) ? context[key] : match;
  });

  container.innerHTML = html;
  screenDef.js(container, context);
  container._cleanup = () => screenDef.cleanup(container);
}