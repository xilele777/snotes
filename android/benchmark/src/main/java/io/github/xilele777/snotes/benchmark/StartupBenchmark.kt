package io.github.xilele777.snotes.benchmark

import android.content.Intent
import android.content.ComponentName
import androidx.benchmark.macro.*
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StartupBenchmark {
    @get:Rule val benchmark = MacrobenchmarkRule()
    private val packageName = "io.github.xilele777.snotes.benchmark"
    private fun seed() {
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        device.executeShellCommand("am force-stop $packageName")
        device.executeShellCommand("am start -W -n $packageName/io.github.xilele777.snotes.app.BenchmarkSeedActivity")
        check(device.wait(androidx.test.uiautomator.Until.hasObject(androidx.test.uiautomator.By.desc("基准样本已准备")), 30_000)) { "Benchmark data was not committed" }
    }
    @Test fun coldList500Notes() {
        seed()
        benchmark.measureRepeated(packageName = packageName, metrics = listOf(StartupTimingMetric()), iterations = 10,
            startupMode = StartupMode.COLD, compilationMode = CompilationMode.None(), setupBlock = { pressHome() }) {
            startActivityAndWait(Intent().setComponent(ComponentName(packageName, "io.github.xilele777.snotes.app.MainActivity")))
            val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            check(device.wait(androidx.test.uiautomator.Until.hasObject(androidx.test.uiautomator.By.textStartsWith("本机样例")), 10_000)) { "Cached list did not render" }
            device.waitForIdle()
        }
    }
    @Test fun cachedNote2000Characters() {
        seed()
        benchmark.measureRepeated(packageName = packageName, metrics = listOf(StartupTimingMetric()), iterations = 10,
            startupMode = StartupMode.COLD, compilationMode = CompilationMode.None(), setupBlock = { pressHome() }) {
            startActivityAndWait(Intent().setComponent(ComponentName(packageName, "io.github.xilele777.snotes.app.MainActivity")).putExtra("noteId", "benchmark-short"))
            check(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).wait(androidx.test.uiautomator.Until.hasObject(androidx.test.uiautomator.By.desc("编辑器已就绪")), 10_000)) { "Editor did not acknowledge loading" }
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).waitForIdle()
        }
    }
}
