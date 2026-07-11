## What Happens When an Alarm Is Dismissed

Once the user completes all required dismissal challenges (primary screen, and optionally a secondary screen), the function **`finalDismiss(alarm, container)`** is called. Here’s the exact sequence of events, line by line, with explanations.

---

### 1. Log the Dismissal
```js
addLog(alarm.logMessage || `Alarm "${alarm.label}" dismissed`);
```
- If the alarm has a custom `logMessage`, it uses that; otherwise it logs a generic dismissal message.
- The log entry appears in the on‑screen log panel and is stored in `logEntries`.

---

### 2. Stop the Alarm Sound
```js
stopAlarmSound();
```
This function:
- Pauses the `currentAudio` (`HTMLAudioElement`) and resets its `currentTime` to `0`.
- Stops the fallback beep oscillator (if any) and closes its `AudioContext`.
- Sets all sound‑related globals (`currentAudio`, `fallbackOscillator`, `fallbackAudioCtx`) to `null`.

The looped alarm sound stops immediately.

---

### 3. Clean Up the Screen
```js
if (container._cleanup) container._cleanup();
```
- Every screen renderer (from `screenLoader.js`) sets a `_cleanup` property on the container. This is called to remove any event listeners (`_swipeCleanup`, `_holdCleanup`, etc.) and prevent memory leaks.
- After cleanup, the container’s inner HTML is usually cleared by the screen’s cleanup method.

```js
container.querySelectorAll('.alarm-overlay').forEach(o => o.remove());
```
- All alarm overlay DOM elements inside the container are explicitly removed, ensuring a clean slate for future alarms.

---

### 4. Reset Active Alarm State
```js
activeAlarmId = null;
```
- The global variable tracking the currently ringing alarm is cleared. No alarm is now “active”.

---

### 5. Handle Chained (After‑Event) Alarms
```js
handleChained(alarm.id);
```
This function looks for other alarms that are configured to trigger **after** the just‑dismissed alarm.  
It searches for alarms where:
- `triggerType` is `'after-event'`
- `enabled` is `true`
- `afterEventSource` equals the dismissed alarm’s `id` (or `"button-click:" + id`)

For each such alarm:
- It calculates the delay in milliseconds (`afterEventDelay * 60000`).
- If `showBetweenScreen` is `true`, it immediately shows a **between screen** (e.g., the `between-message` screen) in the app view, then uses `setTimeout` to call `triggerAlarm(target.id)` after the delay.
- If `showBetweenScreen` is `false`, it simply sets a timeout to trigger the next alarm.

This is how one alarm can automatically start another after a user‑defined interval.

---

### 6. Switch Back to Editor View
```js
setView('editor');
```
- The app returns from the full‑screen “app” view (where the alarm overlay was shown) to the normal **editor** view, showing the alarm list, editor panel, and preview.

---

### 7. Update the Preview Panel
```js
updatePreview();
```
- The preview box (showing how the alarm screen looks) is refreshed based on the currently selected alarm (if any). If the dismissed alarm was selected, its preview remains; otherwise the selection might have changed.

---

### 8. Re‑schedule All Alarms
```js
rescheduleAllAlarms();
```
- This clears all current native alarm timers and re‑registers every enabled, specific‑time alarm with the Tauri backend.
- If the dismissed alarm had `disableAfterAction` set to `true`, it was already **disabled** before this call (the editor’s “save” would have set `alarm.enabled = false`), so it will not be re‑scheduled.
- Recurring or other alarms remain active and are re‑scheduled normally.

---

### Additional Note: Disable After Action
The `disableAfterAction` flag is not explicitly changed inside `finalDismiss`.  
It is typically applied **when the user saves the alarm** (or perhaps when the test button is clicked).  
In the current code, `saveCurrentAlarm()` reads the checkbox `editDisable` and sets `alarm.disableAfterAction`. If the alarm is configured with this option **and** the alarm was triggered via the native OS, the OS may have already removed the schedule (implementation‑specific).  
However, the app’s own `rescheduleAllAlarms()` will skip it if it’s disabled. If you want the alarm to disable itself upon firing, you should set `alarm.enabled = false` *before* the OS schedules it. The current code does **not** do this automatically – that logic would typically be in the OS‑level scheduling handler or a pre‑trigger hook. In the given code, the editor’s “Disable after action” checkbox only sets the property; it doesn’t enforce disabling on trigger. It’s up to the backend or future enhancements to use that flag.

---

## Summary Flow of Dismissal

```
User completes last challenge
        │
        ▼
onAction() callback
        │
        ▼
finalDismiss(alarm, container)
        │
        ├── 1. Log dismissal message
        ├── 2. Stop sound immediately
        ├── 3. Clean up screen events & DOM
        ├── 4. activeAlarmId = null
        ├── 5. handleChained() – schedule next alarm(s) if any
        ├── 6. Switch UI back to editor
        ├── 7. Refresh preview
        └── 8. Re‑schedule all remaining alarms with the OS
```

After this, the app returns to idle, ready for the next alarm, chained event, or user editing.