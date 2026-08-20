package com.memorypets.android.presentation.root

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.memorypets.android.presentation.editor.EditorScreen
import com.memorypets.android.presentation.home.HomeScreen
import com.memorypets.android.presentation.settings.SettingsScreen
import com.memorypets.android.presentation.setup.SetupScreen
import com.memorypets.android.presentation.unlock.UnlockScreen

@Composable
fun MemoryPetsApp(
    startDestination: String = Destinations.SETUP,
    onFinish: (Int, Int, Any?) -> Unit = { _, _, _ -> }
) {
    val navController: NavHostController = rememberNavController()
    Surface(modifier = Modifier.fillMaxSize()) {
        NavHost(
            navController = navController,
            startDestination = startDestination
        ) {
            composable(Destinations.SETUP) {
                SetupScreen(
                    onSetupDone = {
                        navController.navigate(Destinations.HOME) {
                            popUpTo(Destinations.SETUP) { inclusive = true }
                        }
                    }
                )
            }
            composable(Destinations.UNLOCK) {
                UnlockScreen(
                    onUnlock = {
                        navController.navigate(Destinations.HOME) {
                            popUpTo(Destinations.UNLOCK) { inclusive = true }
                        }
                    },
                    goSetup = {
                        navController.navigate(Destinations.SETUP) {
                            popUpTo(0) { inclusive = true }
                        }
                    }
                )
            }
            composable(Destinations.HOME) {
                HomeScreen(
                    onAdd = { navController.navigate(Destinations.editor("new")) },
                    onEdit = { id -> navController.navigate(Destinations.editor(id)) },
                    onSettings = { navController.navigate(Destinations.SETTINGS) },
                    onLock = {
                        navController.navigate(Destinations.UNLOCK) {
                            popUpTo(0) { inclusive = true }
                        }
                    }
                )
            }
            composable(
                route = Destinations.EDITOR,
                arguments = listOf(navArgument("entryId") { type = NavType.StringType })
            ) { backStackEntry ->
                val entryId = backStackEntry.arguments?.getString("entryId") ?: "new"
                EditorScreen(
                    entryId = entryId,
                    onBack = { navController.popBackStack() }
                )
            }
            composable(Destinations.SETTINGS) {
                SettingsScreen(onBack = { navController.popBackStack() })
            }
        }
    }
}
