package com.tauri.alarmapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val alarmId = intent.getStringExtra("alarm_id") ?: return
        val uri = android.net.Uri.parse("myalarmapp://alarm?alarm_id=$alarmId")
        val launchIntent = Intent(Intent.ACTION_VIEW, uri).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(launchIntent)
    }
}