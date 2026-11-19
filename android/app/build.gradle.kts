import groovy.json.JsonSlurper
import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

// AGP 9 provides built-in Kotlin; do not also apply kotlin-android.
val rootPackage = JsonSlurper().parseText(
    providers.fileContents(rootProject.layout.projectDirectory.file("../package.json")).asText.get(),
) as Map<*, *>
val applicationVersion = rootPackage["version"] as? String
    ?: error("Root package.json must define version")
val rootLock = JsonSlurper().parseText(
    providers.fileContents(rootProject.layout.projectDirectory.file("../package-lock.json")).asText.get(),
) as Map<*, *>
val lockedPackages = rootLock["packages"] as? Map<*, *>
val lockedRoot = lockedPackages?.get("") as? Map<*, *>
require(rootLock["version"] == applicationVersion && lockedRoot?.get("version") == applicationVersion) {
    "Root package-lock.json versions must match package.json"
}
require(Regex("\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?").matches(applicationVersion)) {
    "Root package.json version must use SemVer"
}
val releaseSequence = Properties().apply {
    load(providers.fileContents(rootProject.layout.projectDirectory.file("release-sequence.properties")).asText.get().reader())
}
val installationVersion = releaseSequence.getProperty("versionCode")?.toIntOrNull()
    ?: error("release-sequence.properties must define an integer versionCode")
require(installationVersion in 1..2_100_000_000) { "Invalid Android versionCode" }

android {
    namespace = "io.github.xilele777.snotes"
    compileSdk = 37
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "io.github.xilele777.snotes"
        minSdk = 26
        targetSdk = 37
        versionCode = installationVersion
        versionName = applicationVersion
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // This fixture is driven by scripts/verify-process-recovery.ps1 across two processes.
        testInstrumentationRunnerArguments["notClass"] = "io.github.xilele777.snotes.core.ProcessRecoveryFixture,io.github.xilele777.snotes.core.BackendSyncTest,io.github.xilele777.snotes.core.SyncAckProcessFixture"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets {
        getByName("test").resources.directories.add("../../shared/fixtures/android-sync")
    }
    packaging.resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
}

kotlin {
    compilerOptions.jvmTarget.set(JvmTarget.JVM_17)
}

ksp { arg("room.schemaLocation", "$projectDir/schemas") }

val editorDirectory = rootProject.layout.projectDirectory.dir("editor-web")
val installEditorDependencies by tasks.registering(Exec::class) {
    workingDir(editorDirectory)
    commandLine(if (System.getProperty("os.name").startsWith("Windows")) "npm.cmd" else "npm", "ci", "--no-audit", "--no-fund")
    inputs.files(editorDirectory.file("package.json"), editorDirectory.file("package-lock.json"))
    outputs.dir(editorDirectory.dir("node_modules"))
}
abstract class EditorAssetsTask : Exec() {
    @get:OutputDirectory abstract val outputDirectory: DirectoryProperty
}
val buildEditorAssets by tasks.registering(EditorAssetsTask::class) {
    dependsOn(installEditorDependencies)
    workingDir(editorDirectory)
    commandLine(if (System.getProperty("os.name").startsWith("Windows")) "npm.cmd" else "npm", "run", "build")
    inputs.files(fileTree(editorDirectory) { exclude("node_modules/**", "test/**", "README.md") })
    inputs.file(rootProject.layout.projectDirectory.file("../shared/sanitize.ts"))
    inputs.file(rootProject.layout.projectDirectory.file("../package.json"))
    outputDirectory.set(layout.buildDirectory.dir("generated/editorAssets"))
}
androidComponents.onVariants { variant ->
    variant.sources.assets?.addGeneratedSourceDirectory(buildEditorAssets) { it.outputDirectory }
}
tasks.named("preBuild") { dependsOn(buildEditorAssets) }

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.serialization.json)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.coroutines.android)
    implementation(libs.room.runtime)
    implementation(libs.room.paging)
    implementation(libs.paging.runtime)
    implementation(libs.paging.compose)
    implementation(libs.retrofit)
    implementation(libs.retrofit.serialization)
    implementation(libs.okhttp)
    ksp(libs.room.compiler)
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.mockwebserver)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.room.testing)
    androidTestImplementation(libs.mockwebserver)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)
}
