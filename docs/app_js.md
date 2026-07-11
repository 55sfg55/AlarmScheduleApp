# `app.js` Documentation

## Overview
`app.js` is the core orchestrator of the alarm application. It manages alarm scheduling, sidebar toggling, a 24‑hour editor helper, sound playback (including fallback beeps), file persistence, and chained alarms. It initializes the UI, handles user interactions, and communicates with a Tauri backend for native functionality.

---

## Dependencies

| Import | From | Description |
|--------|------|-------------|
| `loadAlarms` | `alarmStore.js` | Loads alarm array from persistent storage. |
| `saveAlarms` | `alarmStore.js` | Saves alarm array to persistent storage. |
| `alarms` | `alarmStore.js` | Reactive alarm array (shared state). |
| `selectedAlarmId` | `alarmStore.js` | Currently selected alarm ID. |
| `currentPlatform` | `alarmStore.js` | Current UI platform (`desktop` or `android`). |
| `timeFormat24h` | `alarmStore.js` | Boolean: `true` for 24‑hour format. |
| `getAlarmById` | `alarmStore.js` | Returns alarm object by ID. |
| `getCurrentScreenId` | `alarmStore.js` | Returns screen ID for current platform and role. |
| `setSelectedAlarmId` | `alarmStore.js` | Sets `selectedAlarmId`. |
| `setCurrentPlatform` | `alarmStore.js` | Sets `currentPlatform`. |
| `setTimeFormat24h` | `alarmStore.js` | Sets `timeFormat24h`. |
| `addLog` | `utils.js` | Adds a log entry to the log panel. |
| `formatTime` | `utils.js` | Formats a 24h time string to 12h or 24h. |
| `loadScreen` | `screenLoader.js` | Loads a screen definition (module). |
| `renderScreen` | `screenLoader.js` | Renders a screen into a container. |

---

## Global Module‑Level State

| Variable | Type | Purpose |
|----------|------|---------|
| `activeAlarmId` | `string|null` | Currently active (ringing) alarm ID. |
| `activeOverlayCleanup` | `function|null` | Unused (declared but never assigned). |
| `alarmTimers` | `Array` | List of scheduled timeouts/IDs for native alarms. |
| `soundCopyPromises` | `Object` | Pending file copy promises keyed by alarm ID. |
| `currentAudio` | `HTMLAudioElement|null` | Currently playing audio element. |
| `fallbackOscillator` | `OscillatorNode|null` | Fallback beep oscillator. |
| `fallbackAudioCtx` | `AudioContext|null` | AudioContext for fallback beep. |
| `audioContextUnlocked` | `boolean` | Whether audio context is unlocked. |

---

## DOM Element References

| Variable | Selector | Purpose |
|----------|----------|---------|
| `alarmListEl` | `#alarmList` | Container for alarm list. |
| `editorPanelEl` | `#editorPanel` | Alarm editor panel. |
| `previewBoxEl` | `#previewBox` | Screen preview box. |
| `appDisplayEl` | `#appDisplay` | Main app view (where alarm overlays appear). |
| `viewSwitchBtn` | `#viewSwitchBtn` | Toggles editor/app views. |
| `platformToggle` | `#platformToggle` | Toggle group for desktop/android. |
| `timeFormatToggle` | `#timeFormatToggle` | Toggle group for 12h/24h. |
| `logPanel` | `#logPanel` | Log panel container. |
| `logToggle` | `#logToggle` | Button to open/close log panel. |
| `addAlarmBtn` | `#addAlarmBtn` | Add‑alarm button. |
| `soundFileInput` | `#soundFileInput` | Hidden file input for sound fallback. |
| `sidebarToggleBtn` | `#sidebarToggleBtn` | Button to toggle sidebar visibility. |
| `sidebarEl` | `#sidebar` | Sidebar container. |

---

## Function Catalogue

### `waitForUserGestureToUnlockAudio()`
**Input:** none  
**Output:** none  
**Side Effects:**  
- If `audioContextUnlocked` is `false`, adds a one‑time click listener to create, resume, and close an AudioContext.  
- Sets `localStorage.audioUnlocked = '1'` and `audioContextUnlocked = true` on success.  
- Logs debug/warning messages.

### `openSoundDB()`
**Input:** none  
**Output:** `Promise<IDBDatabase>`  
**Side Effects:** Opens (or creates) an IndexedDB named `'AlarmAppSounds'` with an object store `'sounds'`.

### `saveSoundBlob(alarmId, file)`
**Input:** `alarmId: string`, `file: Blob`  
**Output:** `Promise<void>`  
**Side Effects:** Stores the file blob in IndexedDB under key `alarmId`. Closes the database on completion.

### `loadSoundBlob(alarmId)`
**Input:** `alarmId: string`  
**Output:** `Promise<Blob|null>`  
**Side Effects:** Retrieves blob from IndexedDB; returns `null` if not found.

### `deleteSoundBlob(alarmId)`
**Input:** `alarmId: string`  
**Output:** `Promise<void>`  
**Side Effects:** Deletes the blob from IndexedDB.

### `sanitizeFileName(name)`
**Input:** `name: string`  
**Output:** `string`  
**Side Effects:** None (pure). Replaces invalid filename characters.

### `persistFileToDisk(alarmId, file, fileName)`
**Input:**  
- `alarmId: string`  
- `file: File/Blob`  
- `fileName: string`  
**Output:** `Promise<string|null>` – saved file path or `null`.  
**Side Effects:**  
- Reads file as `ArrayBuffer`.  
- Invokes Tauri command `save_sound_file` with `{ alarmId, fileName, data }`.  
- Logs progress/errors.

### `copyFilePathToDisk(alarmId, sourcePath, fileName)`
**Input:**  
- `alarmId: string`  
- `sourcePath: string` – existing file path to copy.  
- `fileName: string`  
**Output:** `Promise<string|null>`  
**Side Effects:**  
- Invokes Tauri command `copy_file_to_app_dir`.  
- Logs progress.

### `deleteCopiedFile(alarmId, fileName)`
**Input:** `alarmId: string`, `fileName: string`  
**Output:** `Promise<void>`  
**Side Effects:**  
- Invokes Tauri command `delete_sound_file` with the alarm’s `soundPath`.  
- Ignores errors.

### `playAlarmSound(alarm)`
**Input:** `alarm: object` (must have `soundPath`)  
**Output:** `Promise<void>`  
**Side Effects:**  
- Stops any currently playing sound.  
- Checks file existence via Tauri `file_exists`.  
- Creates an `Audio` element from `convertFileSrc(soundPath)`, loops it, and plays.  
- Falls back to `playFallbackBeep()` if missing or playback fails.

### `ensureAlarmSoundPersistent(alarm)`
**Input:** `alarm: object`  
**Output:** `Promise<string|null>` – the persistent file path.  
**Side Effects:**  
- Waits for any pending `soundCopyPromises`.  
- If `alarm.soundPath` exists and is valid, returns it.  
- Otherwise tries to recover blob from IndexedDB, re‑persists to disk, and saves alarm.

### `stopAlarmSound()`
**Input:** none  
**Output:** none  
**Side Effects:**  
- Pauses and resets `currentAudio`.  
- Stops and nullifies `fallbackOscillator`.  
- Closes `fallbackAudioCtx`.

### `playFallbackBeep()`
**Input:** none  
**Output:** none  
**Side Effects:**  
- Creates a 1‑second square‑wave beep at 800 Hz via Web Audio API.

### `setView(viewName)`
**Input:** `viewName: 'editor' | 'app'`  
**Output:** none  
**Side Effects:**  
- Toggles CSS classes `.active` on `#editorView` and `#appView`.  
- Updates `viewSwitchBtn` text.

### `renderAlarmList()`
**Input:** none (reads `alarms`, `selectedAlarmId`, `timeFormat24h`, `alarmTimers`).  
**Output:** none (direct DOM manipulation).  
**Side Effects:**  
- Clears and populates `#alarmList` with alarm items.  
- Attaches click listeners to each item for selection.

### `selectAlarm(id)`
**Input:** `id: string`  
**Output:** none  
**Side Effects:**  
- Updates `selectedAlarmId`.  
- Calls `renderAlarmList()`, `renderEditor()`, `updatePreview()`.

### `clearAllTimers()`
**Input:** none  
**Output:** none  
**Side Effects:**  
- Clears all timeouts stored in `alarmTimers` and resets the array.

### `scheduleAlarm(alarm)`
**Input:** `alarm: object`  
**Output:** `Promise<void>`  
**Side Effects:**  
- Invokes Tauri command `schedule_alarm` if alarm is enabled and has a time.  
- Pushes an entry into `alarmTimers`.

### `cancelAlarm(alarmId)`
**Input:** `alarmId: string`  
**Output:** `Promise<void>`  
**Side Effects:**  
- Invokes Tauri command `cancel_alarm`.  
- Removes corresponding entry from `alarmTimers`.

### `rescheduleAllAlarms()`
**Input:** none  
**Output:** none  
**Side Effects:**  
- Clears all timers and re‑schedules all specific‑time alarms.  
- Re‑renders the alarm list.

### `renderEditor()`
**Input:** none (reads `selectedAlarmId`, `alarms`, `timeFormat24h`).  
**Output:** none (DOM rendering).  
**Side Effects:**  
- Populates `#editorPanel` with the editing form.  
- Binds event listeners for browse, save, test, delete, and trigger dropdown.  
- Updates `soundCopyPromises` on browse.

### `saveCurrentAlarm(alarm)`
**Input:** `alarm: object` (mutates it)  
**Output:** none  
**Side Effects:**  
- Reads form values and writes them to the alarm object.  
- Calls `saveAlarms()`, re‑renders list and preview.

### `updatePreview()`
**Input:** none (reads `selectedAlarmId`, `timeFormat24h`).  
**Output:** none  
**Side Effects:**  
- Loads the primary screen and renders a preview into `#previewBox`.  
- Cleans up previous preview.

### `showAlarmScreen(alarm, container, isSecondary, betweenInfo)`
**Input:**  
- `alarm: object`  
- `container: HTMLElement`  
- `isSecondary: boolean` (optional)  
- `betweenInfo: object` (optional, with `sourceLabel` and `targetLabel`)  
**Output:** `Promise<void>`  
**Side Effects:**  
- Loads and renders the alarm screen (primary or secondary) into `container`.  
- Plays the alarm sound.  
- Sets up action handling that may chain to secondary screen or final dismissal.

### `finalDismiss(alarm, container)`
**Input:** `alarm: object`, `container: HTMLElement`  
**Output:** none  
**Side Effects:**  
- Stops sound.  
- Cleans up overlay.  
- Calls `handleChained` for after‑event alarms.  
- Switches view to editor and updates preview.

### `handleChained(sourceId)`
**Input:** `sourceId: string`  
**Output:** none  
**Side Effects:**  
- Finds chained alarms that trigger after `sourceId`.  
- Schedules them with a delay, optionally showing a “between” screen.

### `showBetweenScreen(source, target, delayMs)`
**Input:** `source: alarm object`, `target: alarm object`, `delayMs: number`  
**Output:** `Promise<void>`  
**Side Effects:**  
- Renders the “between” screen into `#appDisplay`.  
- Sets a timeout to trigger the target alarm.

### `triggerAlarm(alarmId)` (exported)
**Input:** `alarmId: string`  
**Output:** `Promise<void>`  
**Side Effects:**  
- Ensures sound persistence.  
- Switches view to `'app'`.  
- Calls `showAlarmScreen` with `#appDisplay`.

### `setupSoundInput()`
**Input:** none  
**Output:** none  
**Side Effects:**  
- Adds a `change` listener to `soundFileInput`.  
- On file selection, updates the alarm, saves to IndexedDB, and persists to disk.

### `toggleSidebar()`
**Input:** none  
**Output:** none  
**Side Effects:**  
- Toggles the `hidden` class on `sidebarEl`.

### `init()`
**Input:** none  
**Output:** `Promise<void>`  
**Side Effects:**  
- Loads alarms.  
- Handles pending alarm from `window.__PENDING_ALARM_ID__`.  
- Re‑schedules all alarms.  
- Renders the alarm list and selects the first alarm.  
- Unlocks audio via user gesture.  
- Attaches event listeners to view, platform, time format, log toggle, add alarm, sidebar toggle, and sound input.  
- Exposes `window.triggerAlarm`.

---

## Exported Symbols

| Export | Type | Description |
|--------|------|-------------|
| `triggerAlarm` | `function` | Triggers an alarm by ID. |

---

## Event Handlers (Tauri)

- `alarm-triggered` – listens for native alarm triggers; calls `triggerAlarm(payload)`.

---

## Inputs Summary

- **User interactions:** clicks on alarm list items, buttons (view, platform, time format, log, add, sidebar, browse, save, test, delete, test), file selection.  
- **Imported reactive state:** `alarms`, `selectedAlarmId`, `currentPlatform`, `timeFormat24h`.  
- **Tauri commands:** `schedule_alarm`, `cancel_alarm`, `save_sound_file`, `copy_file_to_app_dir`, `delete_sound_file`, `file_exists`, `convertFileSrc`.  
- **Tauri events:** `alarm-triggered`.  
- **IndexedDB:** `AlarmAppSounds` database for blob backup.  
- **Browser APIs:** `AudioContext`, `Audio`, `localStorage`.  
- **Pending alarm:** `window.__PENDING_ALARM_ID__` set by external script.

## Outputs Summary

- **DOM updates:** alarm list, editor panel, preview, app display (alarm overlays), log panel, sidebar visibility.  
- **Sound output:** custom audio files or fallback beep.  
- **Persistent state changes:** alarms saved to storage, sound files copied to app directory, audio unlocked flag.  
- **Tauri backend:** scheduled native alarms, file operations.  
- **Logs:** via `addLog` to UI and `console.debug/error`.  
- **Exported function:** `triggerAlarm` for external triggering.