# utils.js Documentation

## Overview

`utils.js` provides utility functions for time formatting and application logging. It exports a time formatter that supports both 24‑hour and 12‑hour display, and a logging system that stores the latest 200 entries and renders them into a dedicated DOM panel.

---

## Exported Symbols

| Export | Type | Description |
|--------|------|-------------|
| `formatTime` | `function(hhmm, use24h)` | Converts a `HH:MM` string to 24‑hour or 12‑hour format. |
| `logEntries` | `Array` | The mutable log entries array. Each entry is an object `{ time: string, msg: string }`. |
| `addLog` | `function(message)` | Adds a timestamped log entry to the array and re‑renders the log panel. |

---

## Function Details

### `formatTime(hhmm, use24h = true)`
**Input:**  
- `hhmm: string` – Time string in `"HH:MM"` format (e.g., `"07:15"`).  
- `use24h: boolean` (optional, default `true`) – If `true`, returns the time in `"HH:MM"` (zero‑padded). If `false`, returns a 12‑hour format like `"7:15 AM"`.  
**Output:** `string` – Formatted time. If the input is not a 5‑character string, it is returned unchanged.  
**Side Effects:** none (pure).  

**Examples:**  
- `formatTime("07:15")` → `"07:15"`  
- `formatTime("07:15", false)` → `"7:15 AM"`  
- `formatTime("14:30", false)` → `"2:30 PM"`  
- `formatTime("00:05", false)` → `"12:05 AM"`  
- `formatTime("invalid")` → `"invalid"`  

### `addLog(message)`
**Input:** `message: string` – The log message to record.  
**Output:** none (returns `undefined`).  
**Side Effects:**  
- Creates a timestamped entry (`{ time, msg }`) and prepends it to the exported `logEntries` array.  
- If the array exceeds 200 entries, the oldest entry is removed.  
- Calls `renderLogPanel()` to update the DOM.  

### `renderLogPanel()` (private, not exported)
**Input:** none (reads `logEntries` and the DOM element `#logContent`).  
**Output:** none.  
**Side Effects:**  
- If the element with id `logContent` exists, its `innerHTML` is replaced with the rendered log entries. Each entry is wrapped in a `<div class="log-entry">` containing a `<span class="log-time">` for the time and the message text.  

---

## Inputs Summary

- **`formatTime`** receives a time string and an optional boolean.  
- **`addLog`** receives a message string.  
- **`renderLogPanel`** reads the global `logEntries` array and the DOM via `document.getElementById('logContent')`.  

## Outputs Summary

- **`formatTime`** returns a formatted time string.  
- **`addLog`** modifies the `logEntries` array (observable by other modules) and the DOM log panel.  
- No direct return values from `addLog` or `renderLogPanel`.  

---

## Dependencies

- Browser `document` object (for `getElementById`).  
- The DOM element `#logContent` is expected to exist in the HTML; the function silently does nothing if it is missing.