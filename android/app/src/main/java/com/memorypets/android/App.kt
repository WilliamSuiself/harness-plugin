package com.memorypets.android

import android.app.Application
import com.memorypets.android.di.AppInitializer
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class App : Application() {

    @Inject lateinit var appInitializer: AppInitializer

    override fun onCreate() {
        super.onCreate()
        appInitializer.onCreate(this)
    }
}
