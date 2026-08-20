package com.memorypets.android.service

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.memorypets.android.MainActivity
import com.memorypets.android.R

/**
 * 桌面浮动宠物小部件（MVP 占位 — 后续替换为 Lottie/Glide 动画帧）
 *  - 4x1: 宠物 + 待办数 + 点一下进 App
 *  - 4x2: 宠物 + 最近 3 条 label 列表
 */
class PetWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        appWidgetIds.forEach { id ->
            val views = RemoteViews(context.packageName, R.layout.widget_pet_4x1)
            val launchPI = PendingIntent.getActivity(
                context, 0, Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_root, launchPI)
            views.setTextViewText(R.id.widget_title, "MemoryPets")
            views.setTextViewText(R.id.widget_subtitle, "点击进入笔记本")
            appWidgetManager.updateAppWidget(id, views)
        }
    }
}
