plugins {
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.android.library)
    alias(libs.plugins.kapt)
    alias(libs.plugins.hilt)
}

android {
    namespace = "com.memorypets.sync"
    compileSdk = 34

    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures { buildConfig = true }
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-crypto"))

    implementation(libs.kotlin.stdlib)
    implementation(libs.kotlinx.coroutines.android)

    // Network
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging.interceptor)
    implementation(libs.retrofit)
    implementation(libs.retrofit.converter.gson)
    implementation(libs.gson)

    // Local persistence
    implementation(libs.datastore.preferences)
    implementation(libs.datastore.core)

    // WorkManager for scheduled sync
    implementation(libs.work.runtime.ktx)
    implementation(libs.work.hilt)
    kapt(libs.hilt.compiler.x)

    // Hilt
    implementation(libs.hilt.android)
    kapt(libs.hilt.compiler)

    // Testing
    testImplementation(libs.junit5.api)
    testRuntimeOnly(libs.junit5.engine)
    testImplementation(libs.truth)
    testImplementation(libs.mockk.android)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.work.testing)
}

kapt { correctErrorTypes = true }
