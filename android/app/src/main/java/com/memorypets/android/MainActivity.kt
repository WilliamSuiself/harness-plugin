package com.memorypets.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.view.WindowCompat
import com.memorypets.android.presentation.root.MemoryPetsApp
import com.memorypets.android.presentation.root.RootViewModel
import com.memorypets.android.ui.theme.MemoryPetsTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private val rootViewModel: RootViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContent {
            MemoryPetsTheme(darkTheme = rootViewModel.darkMode.collectAsState().value) {
                MemoryPetsApp(
                    startDestination = rootViewModel.startDestination,
                    onFinish = rootViewModel::onActivityResult
                )
            }
        }
    }
}
