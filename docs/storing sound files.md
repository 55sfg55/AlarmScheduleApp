When a user selects a sound file for an alarm, the app follows a two‑step process: **acquire the file** (via native dialog or browser fallback) and **persist it to the app’s private directory**. The stored path is then used whenever the alarm rings.

Here’s the detailed flow:

---

## 1. Trigger: The “Browse” button (`renderEditor` → `#browseSoundBtn` click)

The button click handler first attempts to open a **native file dialog** (`window.__TAURI__.dialog.open`) filtered for audio files.

### Path A – Native dialog succeeds (desktop / Tauri)

1. The dialog returns the absolute file system path (e.g., `C:\Users\...\alarm.mp3`).  
2. The alarm’s `soundFileName` is set to the file’s basename (e.g., `alarm.mp3`) – used for display.  
3. The alarm’s `soundUrl` is set to `null` (any previous blob URL is discarded).  
4. The UI label is updated immediately to show the new filename.  
5. `copyFilePathToDisk(alarm.id, filePath, fileName)` is called. This **Tauri command** (`copy_file_to_app_dir`) copies the file from its original location into the app’s dedicated data directory, returning a new persistent path.  
6. The returned promise is stored in `soundCopyPromises[alarm.id]` so that other parts of the app can wait for it if needed.  
7. When the copy finishes, `alarm.soundPath` is set to that persistent path, and `saveAlarms()` writes the updated alarm list to `localStorage` (only the `soundPath` is saved – never a blob URL).

### Path B – Native dialog unavailable / cancelled (fallback to `<input type="file">`)

If the dialog fails, throws, or the user cancels, the code programmatically clicks the hidden `<input type="file">` element (`#soundFileInput`).  
The change event listener (`setupSoundInput`) then:

1. Gets the `File` object from `this.files[0]`.  
2. Sets `alarm.soundFileName` to `file.name`, clears `soundUrl`.  
3. Updates the UI label.  
4. **Optional backup**: Saves the raw file as a `Blob` into **IndexedDB** (`saveSoundBlob`) – a last‑resort recovery fallback if the disk write fails.  
5. Calls `persistFileToDisk(alarm.id, file, file.name)`. This function:  
   - Reads the file’s bytes via `file.arrayBuffer()` → `Uint8Array`.  
   - Invokes the Tauri command `save_sound_file` with the alarm ID, sanitised filename, and the byte array.  
   - The command writes the file to the app’s data directory and returns the persistent path.  
6. The promise is again stored in `soundCopyPromises[alarm.id]`. When resolved, `alarm.soundPath` is set and `saveAlarms()` persists the change.

---

## 2. Persistence details

- **App data directory** – both `copy_file_to_app_dir` and `save_sound_file` store the file inside a dedicated folder managed by Tauri (typically `$APPDATA` on Windows, `~/Library/Application Support` on macOS, `~/.local/share` on Linux). The path is opaque to the user and stable across sessions.  
- **Cleanup** – when an alarm is deleted, the old file is removed via `delete_sound_file` (Tauri command).  
- **Data storage** – only `soundPath` (the persistent absolute path) is saved in `localStorage`. The `soundUrl` (blob URL) is intentionally stripped before saving and removed during migration.  
- **Migration** – `migrate()` in `alarmStore.js` also deletes any legacy `soundDataUrl` or `soundUrl` that might still be present.

---

## 3. How the file is used when the alarm rings

When `triggerAlarm(alarmId)` is called:

1. It waits for any pending file‑copy promise (`soundCopyPromises[alarm.id]`).  
2. It calls `ensureAlarmSoundPersistent(alarm)`, which:
   - Checks if `alarm.soundPath` exists on disk (via `file_exists` Tauri command).  
   - If the file is missing, attempts to recover it from the IndexedDB backup (re‑persists to disk).  
3. `playAlarmSound(alarm)` converts the persistent path to a URL that the webview can load: `window.__TAURI__.core.convertFileSrc(alarm.soundPath)`.  
4. A looped `Audio` element is created with that URL and played.  
5. If playback fails or the file is missing, a fallback oscillator beep is used.

---

## Summary of all inputs/outputs for this flow

| Step | Inputs | Outputs / Side Effects |
|------|--------|------------------------|
| Browse click | User clicks button | Opens native dialog or triggers file input |
| Native dialog path | File path from OS | Sets `soundFileName`, clears `soundUrl`, updates UI, starts `copyFilePathToDisk` |
| File input change | `File` object from `<input>` | Sets `soundFileName`, clears `soundUrl`, optionally saves to IndexedDB, starts `persistFileToDisk` |
| `copyFilePathToDisk` | `alarmId`, source path, display name | Invokes Tauri `copy_file_to_app_dir`, returns persistent path |
| `persistFileToDisk` | `alarmId`, `File`, display name | Reads file bytes, invokes Tauri `save_sound_file`, returns persistent path |
| Both copy functions on success | Persistent path | Sets `alarm.soundPath`, calls `saveAlarms()` → writes to localStorage |
| Deletion (when alarm deleted) | `alarmId` | Calls `delete_sound_file`, removes IndexedDB blob |
| Alarm trigger | `alarmId` | Waits for pending copy, verifies file exists, plays via `convertFileSrc` + `Audio` |

The user never sees the persistent path – it’s an internal detail. From their perspective, they choose a sound, the filename appears in the editor, and the alarm plays that sound.