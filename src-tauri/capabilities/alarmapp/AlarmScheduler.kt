package com.tauri.alarmapp

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

class AlarmScheduler {
    companion object {
        @JvmStatic
        fun schedule(context: Context, alarmId: String, triggerAtMs: Long) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, AlarmReceiver::class.java).apply {
                putExtra("alarm_id", alarmId)
            }
            val requestCode = alarmId.hashCode()  // must be unique per alarm
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent
                )
            } else {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent)
            }
        }

        @JvmStatic
        fun cancel(context: Context, alarmId: String) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, AlarmReceiver::class.java)
            val requestCode = alarmId.hashCode()
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_IMMUTABLE
            )
            alarmManager.cancel(pendingIntent)
        }
    }
}