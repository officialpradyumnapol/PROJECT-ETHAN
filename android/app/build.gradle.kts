plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.pradyumna.aiengine"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.pradyumna.aiengine"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf(
            "META-INF/DEPENDENCIES",
            "META-INF/LICENSE",
            "META-INF/LICENSE.txt",
            "META-INF/NOTICE",
            "META-INF/NOTICE.txt"
        )
    }
}

dependencies {
    implementation("androidx.core:core:1.16.0")
    implementation("org.mozilla.geckoview:geckoview:157.0.20261005135250")
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

// GeckoView 157 pulls androidx.core 1.19.0, which needs AGP 9.1+.
// Keep core on a version that works with AGP 8.13.
configurations.all {
    resolutionStrategy {
        force("androidx.core:core:1.16.0")
    }
}
