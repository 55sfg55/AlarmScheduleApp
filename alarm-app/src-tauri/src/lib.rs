#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;
#[cfg(target_os = "android")]
use url::Url;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// ── Windows: schtasks commands (unchanged) ──
#[tauri::command]
fn schedule_windows_alarm(alarm_id: String, time: String) -> Result<String, String> {
    eprintln!("\n[Rust::schedule_windows_alarm] ====== SCHEDULING ALARM =====");
    eprintln!("[Rust::schedule_windows_alarm] alarm_id: {}", alarm_id);
    eprintln!("[Rust::schedule_windows_alarm] time: {}", time);
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_path = exe.to_string_lossy();
    eprintln!("[Rust::schedule_windows_alarm] exe_path: {}", exe_path);
    let task_name = format!("AlarmApp_{}", alarm_id);
    eprintln!("[Rust::schedule_windows_alarm] task_name: {}", task_name);
    let tr_value = format!("\"{}\" --alarm-id={}", exe_path, alarm_id);
    eprintln!("[Rust::schedule_windows_alarm] tr_value: {}", tr_value);

    let mut cmd = Command::new("schtasks");
    cmd.args(&[
        "/create", "/tn", &task_name, "/tr", &tr_value, "/sc", "once", "/st", &time, "/f",
    ]);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    eprintln!("[Rust::schedule_windows_alarm] Executing: schtasks /create /tn {} /tr \"{}\" /sc once /st {} /f", task_name, tr_value, time);
    let output = cmd.output().map_err(|e| e.to_string())?;

    if output.status.success() {
        eprintln!(
            "[Rust::schedule_windows_alarm] ✓✓✓ Task '{}' created successfully ✓✓✓\n",
            task_name
        );
        Ok(format!("Task '{}' created.", task_name))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        eprintln!("[Rust::schedule_windows_alarm] ✗✗✗ Task creation FAILED ✗✗✗");
        eprintln!("[Rust::schedule_windows_alarm] stderr: {}", stderr);
        eprintln!("[Rust::schedule_windows_alarm] stdout: {}\n", stdout);
        Err(stderr)
    }
}

#[tauri::command]
fn cancel_windows_alarm(alarm_id: String) -> Result<String, String> {
    eprintln!("[Rust::cancel_windows_alarm] Canceling alarm: {}", alarm_id);
    let task_name = format!("AlarmApp_{}", alarm_id);
    let mut cmd = Command::new("schtasks");
    cmd.args(&["/delete", "/tn", &task_name, "/f"]);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd.output().map_err(|e| e.to_string())?;
    if output.status.success() {
        eprintln!(
            "[Rust::cancel_windows_alarm] Task '{}' deleted successfully",
            task_name
        );
        Ok(format!("Task '{}' deleted.", task_name))
    } else {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        eprintln!("[Rust::cancel_windows_alarm] Task deletion failed: {}", err);
        Err(err)
    }
}

// ── Cross‑platform schedule & cancel ──
#[tauri::command]
async fn schedule_alarm(
    _app: tauri::AppHandle,
    alarm_id: String,
    time: String,
    _label: String,
    _sound: String,
) -> Result<(), String> {
    eprintln!(
        "[Rust::schedule_alarm] COMMAND INVOKED | alarm_id: {} | time: {}",
        alarm_id, time
    );
    #[cfg(target_os = "windows")]
    {
        eprintln!("[Rust::schedule_alarm] Platform: Windows, delegating to schedule_windows_alarm");
        schedule_windows_alarm(alarm_id, time)?;
    }
    #[cfg(target_os = "android")]
    {
        let (hours, minutes) = {
            let parts: Vec<&str> = time.split(':').collect();
            if parts.len() != 2 {
                return Err("Invalid time format".into());
            }
            let h: u32 = parts[0].parse().map_err(|_| "Invalid hour")?;
            let m: u32 = parts[1].parse().map_err(|_| "Invalid minute")?;
            (h, m)
        };
        use std::time::{SystemTime, UNIX_EPOCH};
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        let mut trigger_secs = (hours * 3600 + minutes * 60) as i64;
        let now_secs = (now / 1000) as i64 % 86400;
        if trigger_secs <= now_secs {
            trigger_secs += 86400;
        }
        let trigger_ms = (now / 1000) * 1000 + (trigger_secs - now_secs) * 1000;

        let android = _app
            .android_context()
            .ok_or("Android context not available")?;
        let jni = android.jni();
        let env = jni.get_env()?;
        let class = env
            .find_class("com/tauri/alarmapp/AlarmScheduler")
            .map_err(|e| format!("Class not found: {}", e))?;
        let args = [
            env.new_string(&alarm_id).map_err(|e| e.to_string())?.into(),
            env.new_long(trigger_ms).map_err(|e| e.to_string())?.into(),
        ];
        env.call_static_method(
            &class,
            "schedule",
            "(Landroid/content/Context;Ljava/lang/String;J)V",
            &args,
        )
        .map_err(|e| format!("JNI call failed: {}", e))?;
    }
    eprintln!("[Rust::schedule_alarm] SUCCESS - Alarm scheduled");
    Ok(())
}

#[tauri::command]
async fn cancel_alarm(_app: tauri::AppHandle, alarm_id: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        cancel_windows_alarm(alarm_id)?;
    }
    #[cfg(target_os = "android")]
    {
        let android = _app
            .android_context()
            .ok_or("Android context not available")?;
        let jni = android.jni();
        let env = jni.get_env()?;
        let class = env
            .find_class("com/tauri/alarmapp/AlarmScheduler")
            .map_err(|e| format!("Class not found: {}", e))?;
        let arg = env.new_string(&alarm_id).map_err(|e| e.to_string())?;
        env.call_static_method(
            &class,
            "cancel",
            "(Landroid/content/Context;Ljava/lang/String;)V",
            &[arg.into()],
        )
        .map_err(|e| format!("Cancel failed: {}", e))?;
    }
    Ok(())
}

// ── NEW: Persistent sound file management (no plugin needed) ──

#[tauri::command]
fn save_sound_file(
    app: tauri::AppHandle,
    alarm_id: String,
    file_name: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let sounds_dir = app_dir.join("alarm-sounds");
    fs::create_dir_all(&sounds_dir).map_err(|e| e.to_string())?;

    let safe_name = sanitize_filename(&format!("{}_{}", alarm_id, file_name));
    let dest = sounds_dir.join(&safe_name);
    fs::write(&dest, &data).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn copy_file_to_app_dir(
    app: tauri::AppHandle,
    alarm_id: String,
    source_path: String,
    dest_name: String,
) -> Result<String, String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let sounds_dir = app_dir.join("alarm-sounds");
    fs::create_dir_all(&sounds_dir).map_err(|e| e.to_string())?;

    let safe_name = sanitize_filename(&format!("{}_{}", alarm_id, dest_name));
    let dest = sounds_dir.join(&safe_name);
    fs::copy(&source_path, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_sound_file(_app: tauri::AppHandle, path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn file_exists(path: String) -> Result<bool, String> {
    Ok(PathBuf::from(path).exists())
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '_' || *c == '-')
        .collect()
}



#[tauri::command]
fn read_screen_file(screen_id: String) -> Result<String, String> {
    // CARGO_MANIFEST_DIR is src-tauri, go one level up to the project root
    let project_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("Failed to determine project root");
    let screens_dir = project_root.join("src").join("screens");
    let file_path = screens_dir.join(format!("{}.html", screen_id));

    std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read {}: {}", file_path.display(), e))
}

#[tauri::command]
fn list_screen_files() -> Vec<String> {
    let project_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("Failed to determine project root");
    let screens_dir = project_root.join("src").join("screens");

    if !screens_dir.exists() {
        return vec![];
    }

    let is_dev = cfg!(debug_assertions);   // true during development

    std::fs::read_dir(&screens_dir)
        .unwrap_or_else(|_| std::fs::read_dir(".").unwrap())
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension()?.to_str()? == "html" {
                let stem = path.file_stem()?.to_string_lossy().to_string();
                // In release mode, skip files starting with "dev-"
                if !is_dev && stem.starts_with("dev-") {
                    return None;
                }
                Some(stem)
            } else {
                None
            }
        })
        .collect()
}

#[tauri::command]
fn debug_list_dir(path: String) -> Vec<String> {
    let dir = std::path::Path::new(&path);
    if !dir.exists() {
        return vec![format!("DIR NOT FOUND: {}", path)];
    }
    let mut entries = vec![];
    if let Ok(read_dir) = std::fs::read_dir(dir) {
        for entry in read_dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            entries.push(format!("{} {}", if is_dir { "[D]" } else { "[F]" }, name));
        }
    }
    entries.sort();
    entries
}

// In your main function, register the command:
// .invoke_handler(tauri::generate_handler![list_screen_files, ...])

// ── Main entry point ──
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())   // keep for file picker
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            eprintln!("\n[Rust::single_instance] Second instance launched with args: {:?}", args);
            if let Some(id) = args.iter().find(|a| a.starts_with("--alarm-id=")) {
                let alarm_id = id.trim_start_matches("--alarm-id=").to_string();
                eprintln!("[Rust::single_instance] Forwarding alarm_id to first instance: {}", alarm_id);
                if let Some(window) = app.get_webview_window("main") {
                    let js = format!(
                        "if(window.triggerAlarm){{window.triggerAlarm('{}')}}",
                        alarm_id.replace('\'', "\\'")
                    );
                    window.eval(&js).ok();
                    eprintln!("[Rust::single_instance] Trigger eval sent to first instance\n");
                }
            } else {
                eprintln!("[Rust::single_instance] No alarm-id in args\n");
            }
        }))
        .invoke_handler(tauri::generate_handler![
            schedule_alarm,
            cancel_alarm,
            schedule_windows_alarm,
            cancel_windows_alarm,
            save_sound_file,
            copy_file_to_app_dir,
            delete_sound_file,
            file_exists,
            read_screen_file,      
            list_screen_files,
            debug_list_dir   
        ])
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                eprintln!("\n[Rust::setup] ========== APP STARTUP - CHECKING FOR ALARM ID ==========");
                let args: Vec<String> = std::env::args().collect();
                eprintln!("[Rust::setup] Full args: {:?}", args);
                let maybe_id = args
                    .iter()
                    .skip(1)
                    .find_map(|a| {
                        eprintln!("[Rust::setup] Checking arg: {}", a);
                        if a.starts_with("--alarm-id=") {
                            let id = a.trim_start_matches("--alarm-id=").to_string();
                            eprintln!("[Rust::setup] Found --alarm-id= format: {}", id);
                            Some(id)
                        } else {
                            None
                        }
                    })
                    .or_else(|| {
                        args.iter().position(|a| a == "--alarm-id").and_then(|pos| {
                            if args.len() > pos + 1 {
                                let id = args[pos + 1].clone();
                                eprintln!("[Rust::setup] Found --alarm-id format: {}", id);
                                Some(id)
                            } else {
                                eprintln!("[Rust::setup] Found --alarm-id but no value following");
                                None
                            }
                        })
                    });

                if let Some(id) = maybe_id {
                    eprintln!("\n[Rust::setup] ALARM TRIGGERED - ALARM_ID: {} \n", id);
                    let window = app.get_webview_window("main").unwrap();
                    let js = format!(
                        "window.__PENDING_ALARM_ID__='{}';",
                        id.replace('\'', "\\'")
                    );
                    eprintln!("[Rust::setup] Injecting: {}", js);
                    window.eval(&js).ok();
                    let window_clone = window.clone();
                    let id_copy = id.clone();
                    std::thread::spawn(move || {
                        eprintln!("[Rust::backup_trigger] Waiting 1500ms...");
                        std::thread::sleep(std::time::Duration::from_millis(1500));
                        eprintln!("[Rust::backup_trigger] Elapsed, firing backup trigger for: {}", id_copy);
                        let js = format!(
                            "if(window.triggerAlarm && window.__PENDING_ALARM_ID__){{console.debug('[Rust-backup] Firing');window.triggerAlarm(window.__PENDING_ALARM_ID__);delete window.__PENDING_ALARM_ID__}}"
                        );
                        window_clone.eval(&js).ok();
                    });
                    eprintln!("[Rust::setup] Complete for alarm {}\n", id);
                } else {
                    eprintln!("[Rust::setup] No alarm ID found (normal launch)\n");
                }
            }

            #[cfg(target_os = "android")]
            {
                let handle = app.handle().clone();
                app.listen("deep-link://*", move |event| {
                    if let Some(payload) = event.payload() {
                        if let Ok(url) = Url::parse(payload) {
                            if let Some(alarm_id) = url.query_pairs().find(|(k, _)| k == "alarm_id") {
                                handle.emit("alarm-triggered", alarm_id.1.to_string()).ok();
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}