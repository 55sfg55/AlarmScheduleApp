## How to Create Screens

> **Important:**  
> - The script **must** set `window.__screenDef` with exactly two functions: `js` and `cleanup`.  
> - The script is executed using `(0, eval)(scriptCode)`, so it runs in the global scope.  
> - You can use any valid JavaScript inside the functions; they are normal browser code.

---

## 📘 How to Create a New Screen

### 1. Create a new `.html` file inside `src/screens/`

Name it `your-screen-name.html`. The filename (without `.html`) is the **screen ID** that will appear in the editor dropdowns.

### 2. Structure the file

- Put any `<style>` you want at the top (will be part of the visual HTML).
- Add the visual markup (buttons, text, progress indicators).
- Add exactly **one** `<script>` block that defines `window.__screenDef`.

### 3. The `window.__screenDef` object

| Property | Type | Description |
|----------|------|-------------|
| `js` | `function(container, context)` | Called once when the screen appears. Add event listeners and start animations here. |
| `cleanup` | `function(container)` | Called when the screen is removed. Remove all event listeners, clear timers. |

### 4. The `context` object passed to `js`

| Property | Type | Description |
|----------|------|-------------|
| `disabled` | `boolean` | If `true`, the alarm is disabled – do not allow interaction. |
| `onAction(type)` | `function` | Call this when the user completes the dismissal challenge. `type` is a string like `"button"`, `"swipe"`, `"hold"` – pick a descriptive name. |
| `time` | `string` | The alarm time, formatted according to the current 12h/24h setting (e.g. `"07:15"` or `"7:15 AM"`). |
| `label` | `string` | The alarm’s label (e.g. `"Morning"`). |
| `soundFileName` | `string` | Name of the sound file selected for this alarm. |
| `betweenSource` | `string` | (only for between‑screens) label of the source alarm. |
| `betweenTarget` | `string` | (only for between‑screens) label of the target alarm. |

### 5. Example: Hold‑to‑dismiss screen

```html
<style>
  .hold-screen .hold-btn {
    position: relative;
    width: 80px;
    height: 80px;
    border: none;
    background: var(--accent);
    color: #fff;
    border-radius: 50%;
    font-weight: bold;
  }
  .hold-screen .hold-btn svg circle {
    fill: none;
    stroke: #fff;
    stroke-width: 6;
  }
</style>

<div class="hold-screen">
  <p class="alarm-time"></p>
  <button class="hold-btn">
    <svg width="86" height="86" viewBox="0 0 86 86">
      <circle cx="43" cy="43" r="40"/>
    </svg>
    HOLD
  </button>
</div>

<script>
window.__screenDef = {
  js: function(container, context) {
    if (context.disabled) return;
    const timeEl = container.querySelector('.alarm-time');
    if (timeEl) timeEl.textContent = context.time || '';

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
        if (progress >= 1) {
          clearInterval(timer);
          context.onAction('hold');
        }
      }, 50);
    }
    function cancelHold() {
      if (timer) clearInterval(timer);
      circle.style.strokeDashoffset = circumference;
    }

    btn.addEventListener('mousedown', startHold);
    btn.addEventListener('touchstart', startHold, { passive: false });
    btn.addEventListener('mouseup', cancelHold);
    btn.addEventListener('mouseleave', cancelHold);
    btn.addEventListener('touchend', cancelHold);
    btn.addEventListener('touchcancel', cancelHold);

    container._cleanupHold = () => {
      cancelHold();
      btn.removeEventListener('mousedown', startHold);
      btn.removeEventListener('touchstart', startHold);
      btn.removeEventListener('mouseup', cancelHold);
      btn.removeEventListener('mouseleave', cancelHold);
      btn.removeEventListener('touchend', cancelHold);
      btn.removeEventListener('touchcancel', cancelHold);
    };
  },

  cleanup: function(container) {
    if (container._cleanupHold) container._cleanupHold();
    container.innerHTML = '';
  }
};
</script>
```

### 6. How the screen gets displayed

1. When an alarm fires (or you press **Test**), the app calls `loadScreen("your-screen-name")`.
2. The loader reads your HTML file via Tauri command, finds the script that sets `window.__screenDef`, and executes it.
3. The loader stores your `{ html, js, cleanup }` and passes it to `renderScreen`.
4. `renderScreen` injects the HTML (replacing `{{disabled}}` with the CSS class if needed), then calls your `js` function with the context.
5. When the user completes the challenge, your `js` calls `context.onAction('action-type')`. This triggers the app’s logic (maybe show a secondary screen, or dismiss and chain).
6. When the screen is removed, `cleanup` is called to prevent memory leaks.

### 7. Optional: Adding the screen to the dropdowns

The editor automatically shows all `.html` files found in `src/screens/` (via the `list_screen_files` Tauri command).  
No manifest needed – just drop a correctly formatted `.html` file into that folder, restart the dev server (`cargo tauri dev`), and the new screen ID appears in the Primary/Secondary/Between dropdowns.

---

### 8. Development‑only screens (`dev-` prefix)

If you’re working on an experimental screen or a debug tool that should never appear in production, simply **start the filename with `dev-`**.

For example:  
`dev-experiment.html`, `dev-debug.html`

- **During development** (`cargo tauri dev` / debug mode) these screens appear normally in the editor dropdowns.
- **When you build for release** (`cargo tauri build`) they are automatically hidden – the `list_screen_files` Rust command filters out any file whose name begins with `dev-`.

> ⚠️ `read_screen_file` can still load a `dev-` screen if an alarm already references it.  
> Make sure to either delete those alarms before building for production, or keep the files in `src/screens/` (they just won’t be selectable in the UI).

This lets you safely develop and test new screens without worrying about them leaking into the final app.

### 9. The alarm header (optional customisation)

Every alarm overlay normally includes a **header** at the top – a dark bar showing the bell icon, the time, the alarm label, and the sound file name. This header is completely separate from your screen content and is automatically added by the app.

You can control what appears in that header by adding an optional `headerHtml` string to `window.__screenDef`:

- **If you don’t define `headerHtml`** – the standard header is shown (icon + time + label + sound).
- **Set `headerHtml: ""`** – the header disappears entirely. Only your screen’s interactive area is visible.
- **Set `headerHtml` to custom HTML** – the app will insert your markup instead of the default header. You can use the same `{{placeholders}}` as in the screen body (see section 10) to include the alarm data.

#### Example: hide the header completely
```js
window.__screenDef = {
  headerHtml: "",   // no header at all
  js: …
  cleanup: …
};
```

#### Example: keep only the time and the icon
```js
headerHtml: `<div class="my-header">{{icon}} {{time}}</div>`
```

The app replaces the placeholders with the actual alarm values when the screen is rendered.  
If you want to keep the original look but restyle it, copy the default structure and apply your own CSS classes:

```html
<div class="icon">{{icon}}</div>
<div class="time">{{time}}</div>
<div class="sub">{{label}}</div>
<div class="sound-indicator">🔊 {{sound}}</div>
```

---

### 10. Using placeholders in your screen HTML

You can insert the alarm’s time, label, bell icon, and sound name directly into your **visual HTML** (the `<div>` that contains your screen’s design). The app will automatically replace any `{{key}}` with the matching value from the context. No JavaScript required for static display.

**Available placeholders** (work everywhere – header and screen body):

| Placeholder | Description |
|-------------|-------------|
| `{{time}}`  | Alarm time, formatted according to the current 12h/24h setting (e.g. `07:15` or `7:15 AM`) |
| `{{label}}` | Alarm label (the name you gave it, e.g. “Morning”) |
| `{{icon}}`  | Bell emoji 🔔 |
| `{{sound}}` | Sound file name (e.g. “chime.mp3”) |
| `{{betweenSource}}` |	Label of the source alarm (only available for between‑screens) |
| `{{betweenTarget}}` |	Label of the target alarm (only available for between‑screens) |


You can also use `{{disabled}}` to add the CSS class `disabled` when the alarm is disabled, for styling purposes.

#### Example: a minimal screen with no JavaScript for display

```html
<div class="my-screen {{disabled}}">
  <style> .my-screen { color: white; text-align: center; } </style>
  <div class="icon">{{icon}}</div>
  <div class="time">{{time}}</div>
  <div class="label">{{label}}</div>
  <button class="dismiss-btn">Dismiss</button>
</div>
<script>
window.__screenDef = {
  js: function(container, context) {
    if (context.disabled) return;
    container.querySelector('.dismiss-btn').addEventListener('click', () => {
      context.onAction('button');
    });
  },
  cleanup: function(container) { container.innerHTML = ''; }
};
</script>
```

Every `{{time}}`, `{{label}}`, etc. inside the `<div class="my-screen">` will be replaced with the correct alarm data when the screen is shown.

---

### 🔧 Common pitfalls

- **Don’t use `export`** – the script is not a module. Use `window.__screenDef = { ... }`.
- **Always check `context.disabled`** before adding interactive listeners.
- **Always provide a `cleanup`** that removes all listeners and timers. Store any teardown function on the container (e.g., `container._myCleanup`).
- **The `html` string** is automatically extracted from the file (body minus script). You can put `<style>` directly in the file – it will be included in the rendered overlay.
- **To style disabled state**, add a `.disabled` class to your root element and use CSS like `.my-screen.disabled .btn { opacity:0.5; pointer-events:none; }`. The loader replaces `{{disabled}}` in the HTML with the word `disabled` when context.disabled is true, so you can use `<div class="my-screen {{disabled}}">` and the element will have class `my-screen disabled`.
- **❌ Don’t rely on named function expressions for cleanup**  
    ```javascript
    btn.addEventListener('click', function onClick() { ... });
    container._cleanup = () => btn.removeEventListener('click', onClick); // ❌ onClick is not defined
    ```
    **✅ Store the function in a variable instead:**
    ```javascript
    const onClick = () => { ... };
    btn.addEventListener('click', onClick);
    container._cleanup = () => btn.removeEventListener('click', onClick);
    ```
- **🔧 Place `<style>` inside the main `<div>` container** – not at the top level of the HTML file.  
 The parser may move a top‑level `<style>` into `<head>`, and the loader only uses the body’s inner HTML.  
 Putting `<style>` inside your root element guarantees it’s rendered with the screen.


---

Now you’re ready to create your own interactive alarm screens. Each file is a self‑contained HTML+JS block that works seamlessly with the app.





