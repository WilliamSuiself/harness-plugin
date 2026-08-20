plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kapt)
    alias(libs.plugins.hilt)
}

android {
    namespace = "com.memorypets.android"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.memorypets.android"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables { useSupportLibrary = true }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            isShrinkResources = false
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14" // 与 Kotlin 2.0.0 对应
    }
    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-crypto"))
    implementation(project(":sync"))

    implementation(libs.kotlin.stdlib)
    implementation(libs.kotlinx.coroutines.android)

    // Core AndroidX
    implementation(libs.lifecycle.viewmodel.ktx)
    implementation(libs.lifecycle.runtime.ktx)
    implementation(libs.lifecycle.process)
    implementation(libs.lifecycle.service)

    // Compose BOM
    implementation(platform(libs.compose.bom))
    androidTestImplementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.extended)
    implementation(libs.compose.navigation)
    implementation(libs.compose.lifecycle.viewmodel)
    implementation(libs.compose.lifecycle.runtime)
    implementation(libs.compose.hilt.navigation)

    // DI
    implementation(libs.hilt.android)
    implementation(libs.hilt.work)
    kapt(libs.hilt.compiler)
    kapt(libs.hilt.compiler.x)

    // Biometric
    implementation(libs.biometric.ktx)

    // WorkManager
    implementation(libs.work.runtime.ktx)

    // UI assets
    implementation(libs.lottie.compose)
    implementation(libs.coil.compose)

    // DataStore（app 层再挂一次，sync 模块也有）
    implementation(libs.datastore.preferences)
    implementation(libs.datastore.core)

    // Testing
    testImplementation(libs.junit5.api)
    testRuntimeOnly(libs.junit5.engine)
    testImplementation(libs.truth)
    testImplementation(libs.mockk.android)
    testImplementation(libs.robolectric)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.work.testing)
}

kapt { correctErrorTypes = true }
