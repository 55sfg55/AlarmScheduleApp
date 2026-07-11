# alarmStore.js Documentation

## Overview

`alarmStore.js` is the central module for alarm data persistence and shared state management. It loads alarms from `localStorage`, provides default data, migrates older alarm formats, and exposes reactive variables along with setter functions. It also offers helper functions to retrieve alarms and resolve screen IDs per platform.

---

## Exported Symbols

| Export | Type | Description |
|--------|------|-------------|
| `alarms` | `Array` | The complete list of alarm objects (reactive, but not proxied; replaced on load). |
| `selectedAlarmId` | `string|null` | Currently selected alarm ID in the UI. |
| `currentPlatform` | `string` | Active platform: `'desktop'` or `'android'`. |
| `timeFormat24h` | `boolean` | Whether to display times in 24‑hour format. |
| `setSelectedAlarmId` | `function` | Setter for `selectedAlarmId`. |
| `setCurrentPlatform` | `function` | Setter for `currentPlatform`. |
| `setTimeFormat24h` | `function` | Setter for `timeFormat24h`. |
| `loadAlarms` | `function` | Loads alarms from `localStorage`, applies migration, and falls back to defaults. |
| `saveAlarms` | `function` | Persists the alarm array (without `soundUrl`) to `localStorage`. |
| `getAlarmById` | `function` | Returns the alarm object matching a given ID. |
| `getCurrentScreenId` | `function` | Resolves a screen ID for the current platform and a given slot. |

---

## Module-Level State (non‑exported)

| Variable | Description |
|----------|-------------|
| `STORAGE_KEY` | `'alarmAppData'` – key used in `localStorage`. |

---

## Function Details

### `createDefaults()`
**Input:** none  
**Output:** `Array<Alarm>` – three default alarms:  
1. **Morning** (`a1`): specific time 07:00, simple‑dismiss/swipe‑dismiss.  
2. **Reminder** (`a2`): specific time 08:30, hold‑dismiss primary, secondary fallback.  
3. **Chained after Morning** (`a3`): after‑event, triggers 2 min after `a1`, pattern‑dismiss with between‑message screen.  
**Side Effects:** none (pure).

### `migrate(alarm)`
**Input:** `alarm: object`  
**Output:** `alarm: object` (mutated in place, also returned)  
**Purpose:** Ensures an alarm object conforms to the current schema. It:  
- Provides default `screens` structure if missing (from old `screenDesktop`/`screenAndroid`).  
- Adds `showBetweenScreen` (default `false`).  
- Adds `logMessage` (default `''`).  
- Removes deprecated `soundDataUrl` and `soundUrl` to avoid bloating `localStorage`.  
- Sets `soundPath` to `null` if undefined.  
**Side Effects:** Modifies the input alarm object.

### `loadAlarms()`
**Input:** none  
**Output:** none  
**Side Effects:**  
- Reads `localStorage` using `STORAGE_KEY`.  
- If found, parses the JSON, maps each alarm through `migrate()`, and assigns to the exported `alarms` array.  
- If parsing fails or no data exists, calls `createDefaults()` and assigns.  
- Calls `saveAlarms()` to immediately persist any migrated version.  
- Logs debug information.

### `saveAlarms()`
**Input:** none (reads `alarms`)  
**Output:** none  
**Side Effects:**  
- Maps the current `alarms` array to a clean copy, stripping any `soundUrl` property.  
- Stringifies the cleaned array and writes to `localStorage[STORAGE_KEY]`.  
- Logs debug data.

### `getAlarmById(id)`
**Input:** `id: string`  
**Output:** `Alarm|undefined` – the alarm object or `undefined` if not found.  
**Side Effects:** Logs debug/warning information about the alarm’s sound properties.

### `getCurrentScreenId(alarm, slot)`
**Input:**  
- `alarm: object` (must have `screens` property).  
- `slot: string` – `'primary'`, `'secondary'`, or `'between'`.  
**Output:** `string` – the screen ID for the given slot on `currentPlatform`.  
**Side Effects:** none (pure). Falls back to `'simple-dismiss'` for `primary` if nothing defined.

---

## Alarm Object Structure (current schema)

```typescript
interface Alarm {
  id: string;
  label: string;
  time: string;            // "HH:MM" for specific, empty for after-event
  triggerType: 'specific' | 'after-event';
  afterEventSource: string; // source alarm ID or "button-click:alarmId"
  afterEventDelay: number;  // minutes
  screens: {
    desktop: { primary: string; secondary: string; between: string };
    android:  { primary: string; secondary: string; between: string };
  };
  soundFileName: string;    // display name of sound file
  soundPath: string | null; // persistent file path (Tauri app‑dir)
  soundUrl: string | null;  // ephemeral object URL – NEVER persisted
  disableAfterAction: boolean;
  logMessage: string;
  showBetweenScreen: boolean;
  enabled: boolean;
}
```

## Inputs Summary

- **`localStorage`** key `'alarmAppData'` (JSON string) – the source of alarm data.  
- **Internal state:** `currentPlatform` used by `getCurrentScreenId`.  
- **Exported reactive variables** can be set directly (by the module itself) or through the provided setter functions.

## Outputs Summary

- **Exported reactive variables:** `alarms`, `selectedAlarmId`, `currentPlatform`, `timeFormat24h` – consumed by other modules.  
- **LocalStorage write:** on `loadAlarms` (post‑migration) and on every `saveAlarms` call.  
- **Logging:** detailed debug/warning messages to the console.  
- **Return values:** from `getAlarmById`, `getCurrentScreenId`, and `createDefaults`.