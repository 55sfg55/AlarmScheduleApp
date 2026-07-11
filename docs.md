# Alarm App – Developer Documentation

> A Tauri‑based alarm clock application with a screen‑based dismissal system, chained alarms, platform‑specific screens, and an extensible screen architecture.

## 1. Overview
The Alarm App is a desktop (and Android‑compatible via Tauri) alarm clock that supports:
- Multiple alarms with specific times or delayed “chained” events.
- Customisable dismissal screens (button, swipe, hold, pattern, etc.).
- Separate screen chains for Desktop and Android.
- A secondary screen that appears if the first dismissal fails (or for extra confirmation).
- A “between alarms” screen shown during chained alarm countdowns.
- 24‑hour / 12‑hour time display.
- An action log with custom messages.
- Sound file selection (in real Tauri via native dialog).

The user interface is split into **Editor View** (for configuration) and **App View** (full‑screen alarm display). A toggle button switches between them.

## 2. Project Structure
```
tauri-alarm-app/
├── src/
│   ├── index.html          # Main app shell (sidebar, topbar, views)
│   ├── css/
│   │   └── style.css       # Global styles (dark theme, variables)
│   ├── js/
│   │   ├── utils.js        # Formatting & logging helpers
│   │   ├── alarmStore.js   # Alarm data, persistence, current state
│   │   ├── screenLoader.js # Dynamic screen loading & registry
│   │   └── app.js          # Initialisation, view logic, editor, triggering
│   └── screens/            # Each screen as a self‑contained HTML+JS module
│       ├── simple-dismiss.html
│       ├── swipe-dismiss.html
│       ├── hold-dismiss.html
│       ├── pattern-dismiss.html
│       └── between-message.html
├── package.json
├── tauri.conf.json
└── README.md
```

**Key files and responsibilities:**

- `index.html` – The root document; contains all DOM containers, script includes, and style links.
- `style.css` – Provides the dark theme and layout; screens can add their own `<style>` inside their HTML file.
- `utils.js` – `formatTime(hhmm, use24h)` and an `addLog(message)` function that pushes messages into a global log.
- `alarmStore.js` – Maintains the `alarms` array, `selectedAlarmId`, `currentPlatform`, and `timeFormat24h`. Handles localStorage persistence and migration.
- `screenLoader.js` – A registry that stores built‑in screen templates (or fetches external files in a real build). Exports `loadScreen(id)` and `renderScreen(container, screenDef, context)`.
- `app.js` – Ties everything together: renders alarm list, editor panel, handles view switching, triggers alarms, manages overlay lifecycle (primary → secondary → dismiss).
- `screens/*.html` – Each file is a self‑contained unit with its own `<style>`, HTML markup, and `<script>` that exports `render(container, context)` and `cleanup(container)` functions.

## 3. Core Concepts

### Alarm Data Model
Each alarm is a JavaScript object with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (e.g. `a1712345678`). |
| `label` | string | User‑friendly name. |
| `triggerType` | `'specific'` or `'after-event'` | How the alarm is activated. |
| `time` | string | (if `specific`) `HH:MM` in 24‑h format. |
| `afterEventSource` | string | (if `after-event`) ID of the source alarm, or `'button-click:alarmId'`. |
| `afterEventDelay` | number | Minutes to wait after the source event before triggering. |
| `screens` | object | See “Screen Configuration” below. |
| `soundFileName` | string | Name of the audio file (displayed only; in Tauri it’s a path). |
| `disableAfterAction` | boolean | If true, the primary screen becomes disabled after the first dismiss action. |
| `logMessage` | string | Custom message written to the log when the alarm is finally dismissed. |
| `showBetweenScreen` | boolean | Whether to show the “between” screen during a chained countdown. |
| `enabled` | boolean | Global on/off switch. |

### Screen Configuration
`screens` is an object with two properties: `desktop` and `android`. Each holds:

```javascript
{
  primary: 'screen-id',   // required
  secondary: 'screen-id', // optional, shown after first dismiss
  between: 'screen-id'    // optional, shown during chained delay
}
```

If `secondary` is set, after the primary screen’s `onAction` is called, the app automatically transitions to the secondary screen. Only after the secondary screen’s action (or if no secondary is defined) does the alarm finally dismiss.

`between` is used only for chained alarms (`triggerType === 'after-event'`) when `showBetweenScreen` is `true`. It displays a message like “Now between Alarm X and Y”.

## 4. Screen System
Screens are the heart of the user interaction. Each screen is a self‑contained module that follows a simple contract.

### Screen Definition Contract
A screen module must export two functions (or in our built‑in registry, be an object with the same):

- **`render(container, context)`**
  - `container`: the DOM element where the screen should be placed.
  - `context`: an object with:
    - `disabled` – boolean, if true the screen should be non‑interactive.
    - `onAction(actionType)` – callback to call when the user performs the dismiss action (e.g. `'button'`, `'swipe'`).
    - `betweenSource` / `betweenTarget` – strings passed only to the “between” screen.
  - The function attaches event listeners and creates all DOM elements inside `container`.

- **`cleanup(container)`**
  - Removes all elements and event listeners attached by `render`. This is called when the screen is replaced or the alarm is dismissed.

### Built‑in Screens

| Screen ID | Description |
|-----------|-------------|
| `simple-dismiss` | A single “Dismiss” button. |
| `swipe-dismiss` | A swipe‑right track (mobile friendly). |
| `hold-dismiss` | Press and hold for 2 seconds with a circular progress indicator. |
| `pattern-dismiss` | Tap numbered dots in the sequence 1 → 2 → 3. |
| `between-message` | Displays text “Now between … and …”. |

### Adding a New Screen
1. Create a new HTML file in `src/screens/`, e.g. `shake-dismiss.html`.
2. Include any custom `<style>` needed (scoped to a parent class).
3. Provide the HTML structure.
4. Write a `<script>` that defines `render(container, context)` and `cleanup(container)`.
   - Inside `render`, call `context.onAction('shake')` when the dismiss gesture is completed.
   - Respect `context.disabled`.
5. Register the screen in `screenLoader.js` by adding it to the `screenTemplates` object (or in a real implementation, ensure the file is discoverable).

In a Tauri build, the loading function would `fetch` the HTML file, parse it, and execute its `<script>` in a controlled context. For this mockup, built‑in templates emulate that.

## 5. Alarm Configuration (Editor)
The **Editor View** consists of two panels:
- **Left panel** – Alarm settings form.
- **Right panel** – Live preview of the currently selected alarm’s primary screen.

### Settings Breakdown
- **Label** – free text.
- **Trigger type** – specific time or after an event.
- **Time** (only for specific) – time input in 24‑h format.
- **After event** – source alarm (dropdown) and delay in minutes.
- **Show between screen** – enables the optional “between” display for chained alarms.
- **Screens for Desktop / Android** – three dropdowns each: Primary, Secondary, Between.
- **Sound file** – a read‑only name + “Browse…” button (mocked with `<input type="file">`).
- **Log message** – custom message logged on final dismiss.
- **Disable after action** – if checked, the current screen becomes disabled after `onAction` is called (prevents double‑tapping).
- **Enabled** – global toggle.

## 6. Chained Alarms
Chained alarms allow a sequence of alarms to trigger automatically. When an alarm is dismissed (either manually or after the final screen), the app looks for any alarm where:
- `triggerType === 'after-event'`
- `afterEventSource` matches the dismissed alarm’s ID (or `'button-click:' + id`)
- The alarm is enabled.

If found, the chained alarm starts a countdown (`afterEventDelay` minutes). If `showBetweenScreen` is `true`, the “between” screen is displayed for the entire duration, then the target alarm’s overlay replaces it. Otherwise, the app simply waits and then shows the target alarm.

## 7. View Modes
Two main views are toggled with the **⚙️/📱** button in the top‑right corner:

- **Editor View** – Shows the sidebar, alarm editor, and preview panel.
- **App View** – A full‑screen display that shows the active alarm overlay. This is where alarms appear when triggered (either manually via the “Test” button or automatically).

While in App View, pressing **Escape** dismisses the current alarm.

## 8. Platform & Time Format
- **Platform switch**: `🖥 Desktop` / `📱 Android` – changes which set of screens (`screens.desktop` or `screens.android`) is used.
- **Time format**: `24h` / `12h` – changes how times are displayed throughout the UI. All stored times remain in 24‑h format.

Both settings are persisted in `localStorage`.

## 9. Logging
Every alarm dismiss action and manual action (like switching screens) writes an entry to the **Log Panel** at the bottom. Each log entry includes a timestamp and a message (the alarm’s `logMessage` if defined, otherwise a default).

The log panel can be toggled open/closed with the **📋 Log** button.

## 10. Build & Run (Tauri)
This project is structured for Tauri. To build and run:

1. Ensure you have [Rust](https://www.rust-lang.org/) and [Node.js](https://nodejs.org/) installed.
2. Install Tauri CLI: `npm install -g @tauri-apps/cli` or use `npx`.
3. In the project root, install dependencies: `npm install`.
4. Start development: `npm run tauri dev`.
5. Build for distribution: `npm run tauri build`.

### Sound File Selection in Tauri
Replace the mock `<input type="file">` with Tauri’s file dialog API:
```javascript
import { open } from '@tauri-apps/api/dialog';
const filePath = await open({ filters: [{ name: 'Audio', extensions: ['mp3','wav'] }] });
if (filePath) alarm.soundFileName = filePath;
```

The same goes for actually playing the sound – use a library or the Web Audio API.

## 11. Future Enhancements
- **Custom screen import**: Allow users to drop a `.html` file into a folder and have it appear in the dropdown.
- **Snooze**: Add a snooze button that triggers a repeated chained alarm after X minutes.
- **Multiple sound options**: Volume control, different sounds for different alarms.
- **Schedule days**: Repeat alarms on specific days of the week.
- **System tray integration**: Run in the background and show notifications via Tauri.

This documentation provides everything needed to continue development or to onboard new developers. Refer to the inline comments in the source files for implementation details.