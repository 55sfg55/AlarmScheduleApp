package com.tauri.alarmapp

import android.content.Intent
import app.tauri.TauriActivity
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriInvoke
import io.github.tauri_plugin_opener.Plugin

class MainActivity : TauriActivity() {
    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        intent?.getStringExtra("alarm_id")?.let { alarmId ->
            // Emit a Tauri event to the Rust backend
            this.eval("window.__TAURI_INTERNALS__.invoke('plugin:event|alarm-triggered', { payload: '$alarmId' })")
        }
    }
}