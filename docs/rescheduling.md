Let’s trace the full lifecycle, from the moment you save an alarm to the moment it rings and you dismiss it.

---

## 1. Creating / Editing an Alarm
When you open an alarm in the editor and click **Save**, the function `saveCurrentAlarm()` (in `app.js`) reads all form fields and updates the alarm object. Then it calls:

```js
saveAlarms();            // persists to localStorage
rescheduleAllAlarms();   // re-registers all native alarms
```

The alarm is now stored and ready to be scheduled.

---

## 2. Scheduling with the Operating System
`rescheduleAllAlarms()` clears any previous timers and calls `scheduleAlarm(alarm)` for every enabled alarm with `triggerType: 'specific'`.

The function `scheduleAlarm(alarm)` sends a request to the **Tauri backend**:

```js
await window.__TAURI__.core.invoke('schedule_alarm', {
  alarmId: alarm.id,
  time: alarm.time,        // "HH:MM"
  label: alarm.label || 'Alarm',
  sound: alarm.soundFileName || '',
});
```

The **Rust backend** (not shown in the provided JS files) receives this command and tells the operating system (Windows, macOS, Linux, Android) to fire a native alarm at that time.  
The backend stores the alarm ID and possibly a sound file reference so that it can later notify the app.

> **Note:** No JavaScript timer is used – the alarm will fire even if the app is closed, because the OS is in charge.

---

## 3. The Alarm Rings (Native → App)
When the scheduled time arrives, the OS notifies the Tauri backend.  
The backend emits an event back to the JavaScript side: `alarm-triggered`.  
The app has been listening for this event since startup:

```js
window.__TAURI__.event.listen('alarm-triggered', (event) => {
  triggerAlarm(event.payload);  // payload = alarmId
});
```

At this point **`triggerAlarm(alarmId)`** is called.

---

## 4. `triggerAlarm()` – Preparing the Alarm
```js
export async function triggerAlarm(alarmId) {
  const alarm = getAlarmById(alarmId);
  if (!alarm || !alarm.enabled) return;

  // Wait for any pending sound file copies
  if (soundCopyPromises[alarm.id]) await soundCopyPromises[alarm.id];

  // Make sure the sound file is really on disk
  await ensureAlarmSoundPersistent(alarm);

  // Switch the UI to the "app" view (where alarm overlays appear)
  setView('app');

  // Show the interactive dismissal screen
  showAlarmScreen(alarm, document.getElementById('appDisplay'));
}
```

This function is also exposed globally (`window.triggerAlarm`) and is called when you press the **Test** button in the editor.

---

## 5. `showAlarmScreen()` – Displaying the Dismissal Challenge
```js
async function showAlarmScreen(alarm, container, isSecondary = false, betweenInfo = null)
```

1. It determines which screen to show:  
   - Normally the **primary** screen for the current platform (desktop/android).  
   - If it’s a secondary challenge (after completing the first), it loads the **secondary** screen.

2. It builds an overlay HTML with the alarm icon, time, label, sound indicator, and a placeholder for the screen content.

3. It loads the screen definition via `loadScreen(screenId)` (from `screenLoader.js`).

4. It renders the screen using `renderScreen(content, screenDef, context)`.  
   The context object contains:
   - `disabled: false`
   - `onAction: (actionType) => { … }` – the callback when the user completes the challenge.

5. **Starts playing the alarm sound** by calling `playAlarmSound(alarm)`.  
   This reads the persistent file path (`alarm.soundPath`), converts it to a URL via `convertFileSrc`, creates an `Audio` element, and loops it.

---

## 6. Dismissal Challenge Flow
The user now interacts with the screen (e.g., presses a button, swipes, holds, taps a pattern).  
When the challenge is completed, the screen’s JavaScript calls `context.onAction(actionType)`.

Inside that callback, the app decides what happens next:

```js
onAction: (actionType) => {
  addLog(`[Action] ${actionType} on "${alarm.label}"`);
  const secondaryId = getCurrentScreenId(alarm, 'secondary');
  if (secondaryId && !isSecondary) {
    // There is a secondary screen – show it now
    screenDef.cleanup(content);
    showAlarmScreen(alarm, container, true);
  } else {
    // No secondary screen, or we already did it – dismiss completely
    finalDismiss(alarm, container);
  }
}
```

So the user may have to complete **two** challenges in a row (primary → secondary) if configured.

---

## 7. `finalDismiss()` – Stopping and Cleaning Up
```js
function finalDismiss(alarm, container) {
  addLog(alarm.logMessage || `Alarm "${alarm.label}" dismissed`);
  stopAlarmSound();                       // pause & reset audio
  if (container._cleanup) container._cleanup(); // remove screen events
  container.querySelectorAll('.alarm-overlay').forEach(o => o.remove());
  activeAlarmId = null;
  handleChained(alarm.id);                // schedule any after-event alarms
  setView('editor');                      // return to editor view
  updatePreview();
  rescheduleAllAlarms();                  // re-schedule recurring alarms
}
```

The alarm is now fully dismissed.

---

## 8. Chained Alarms (After‑Event)
If another alarm is configured with `triggerType: 'after-event'` and its `afterEventSource` matches the just‑dismissed alarm, it will be triggered automatically after a delay.

```js
function handleChained(sourceId) {
  const chained = alarms.filter(a => 
    a.triggerType === 'after-event' &&
    a.enabled &&
    (a.afterEventSource === sourceId || a.afterEventSource === 'button-click:' + sourceId)
  );
  chained.forEach(target => {
    const delayMs = (target.afterEventDelay || 1) * 60000;
    addLog(`Chained "${target.label}" scheduled in ${target.afterEventDelay} min`);
    if (target.showBetweenScreen) {
      showBetweenScreen(source, target, delayMs); // shows "between" screen
    } else {
      setTimeout(() => triggerAlarm(target.id), delayMs);
    }
  });
}
```

If `showBetweenScreen` is enabled, a static “between” screen is shown in the app view for the duration of the delay, then the next alarm fires. Otherwise, the timer runs silently.

---

## Visual Summary

```
USER SAVES ALARM
     ↓
rescheduleAllAlarms()
     ↓
Tauri: schedule_alarm(alarmId, time, label, sound)
     ↓
OS fires at scheduled time
     ↓
Tauri emits 'alarm-triggered' event
     ↓
triggerAlarm(alarmId)
     ↓
switch to App View + showAlarmScreen()
     ↓
Play sound & render screen (primary)
     ↓
User completes challenge → onAction()
     ↓
Secondary screen? → repeat challenge
     ↓
finalDismiss() → stop sound, log, check chained alarms
     ↓
(if chained) showBetweenScreen() or setTimeout() → next triggerAlarm()
     ↓
Return to editor view
```

---

## Key Takeaways
- **Scheduling is native** – no JavaScript `setTimeout` for main alarms.  
- **Sound persistence** – the app ensures the sound file is on disk before playing, using Tauri’s file APIs and IndexedDB as backup.  
- **Screens are pluggable** – defined in `screenLoader.js`, completely self‑contained with their own HTML, JS, and cleanup.  
- **Chaining** enables one alarm to automatically trigger another after a set delay.  

This design keeps the alarm reliable even if the browser tab is closed, while the UI remains fast and modular.