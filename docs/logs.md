# Logging System Documentation

## Overview

The application uses a simple in-memory logging system to record events such as alarm triggers, user actions, scheduling changes, and preview tests. Logs are displayed in a dedicated panel within the UI and can be toggled open/closed.

The logging system is implemented across two files:
- `utils.js` – Core logging functions and data storage.
- `app.js` – Integration and usage throughout the alarm application.

---

## Data Structure

Logs are stored in the `logEntries` array (defined in `utils.js`). Each entry is an object with two properties:

```javascript
{
  time: string,  // e.g., "14:32:05"
  msg:  string   // the log message
}
```

- **`time`**: A formatted timestamp (HH:MM:SS) generated at the moment of logging.
- **`msg`**: A descriptive string describing the event.

The array is limited to a maximum of **200** entries. When a new entry is added and the limit is exceeded, the oldest entry is removed (`pop()` is used, so the most recent entry is at index `0` after `unshift`).

---

## Core Functions

### `addLog(message)` (defined in `utils.js`)

**Purpose**: Add a new log entry to the global log store and update the UI.

**Parameters**:
- `message` (string): The content of the log entry.

**Behavior**:
1. Creates a timestamp from the current date/time.
2. Unshifts the entry to the beginning of `logEntries`.
3. If the array exceeds 200 items, removes the last element.
4. Calls `renderLogPanel()` to immediately reflect the change in the UI.

**Example**:
```javascript
addLog('Alarm "Morning Alarm" dismissed');
```

---

### `renderLogPanel()` (defined in `utils.js`)

**Purpose**: Rebuild the HTML of the log panel’s content area based on the current `logEntries` array.

**Behavior**:
- Targets the DOM element with id `logContent`.
- Clears its innerHTML and recreates a list of `<div class="log-entry">` elements.
- Each entry contains a `<span class="log-time">` for the timestamp and the message text.

**Note**: This function is called automatically by `addLog()` but can also be called manually if needed (e.g., after clearing the logs, though no clear function is currently provided).

---

## UI Integration

### HTML Structure (assumed)
The log panel is expected to exist in the HTML with the following structure:

```html
<div id="logPanel">
  <div id="logContent"></div>
</div>
<button id="logToggle">📋</button> <!-- or similar icon -->
```

- `#logPanel`: The container that slides open/closed.
- `#logContent`: The scrollable area where log entries are rendered.
- `#logToggle`: A button that toggles the visibility of the log panel.

### Toggle Behavior (defined in `app.js` init)
```javascript
logToggle.addEventListener('click', () => logPanel.classList.toggle('open'));
```
The CSS class `open` is added/removed to show/hide the panel.

---

## Usage in `app.js`

The `addLog` function is imported from `utils.js` and used in several places to record significant events:

1. **Preview Testing** (`updatePreview`):
   ```javascript
   onAction: (type) => addLog(`[Preview] ${type}`)
   ```
   Logs actions triggered from the preview screen.

2. **Alarm Dismissal** (`finalDismiss`):
   ```javascript
   addLog(alarm.logMessage || `Alarm "${alarm.label}" dismissed`)
   ```
   If the alarm has a custom `logMessage`, it is used; otherwise a generic dismissal message is logged.

3. **Chained Alarm Scheduling** (`handleChained`):
   ```javascript
   addLog(`Chained "${target.label}" scheduled at ${timeStr}`);
   ```
   Records when an after-event alarm is scheduled.

4. **User Actions on Active Alarm** (`showAlarmScreen` callback):
   ```javascript
   addLog(`[Action] ${actionType} on "${alarm.label}"`);
   ```
   Logs interactions like swipe, button press, etc., performed on the alarm overlay.

5. (Additional contextual logs could be added anywhere else in the codebase as needed.)

---

## Lifecycle and Limitations

- **Persistence**: Logs are **not** persisted to disk or localStorage. They only exist in memory during the current application session. Refreshing the page or restarting the app clears all logs.
- **Size Limit**: Hard-coded to 200 entries. Older entries are discarded automatically.
- **No Export/Filter**: There is no built-in functionality to export, filter, or search logs.
- **Thread Safety**: All log operations are synchronous and run on the main UI thread, which is acceptable for a desktop-like application with low logging volume.

---

## Extending the System

If future requirements demand persistent or more advanced logging, consider:
- Saving log entries to a file via Tauri’s filesystem API.
- Adding severity levels (info, warn, error).
- Providing a “Clear Log” button or periodic auto-clear.

The modular design (separate `utils.js` and a dedicated render function) makes it easy to add such features without changing the usage sites.