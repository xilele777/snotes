package io.github.xilele777.snotes.core.sync

import android.content.Context
import androidx.work.*
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import io.github.xilele777.snotes.core.database.LocalProfile
import java.util.concurrent.TimeUnit
import androidx.glance.appwidget.updateAll

@EntryPoint @InstallIn(SingletonComponent::class)
interface SyncWorkerAccess {
    fun coordinator(): SyncCoordinator
    fun profile(): LocalProfile
}

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val access = EntryPointAccessors.fromApplication(applicationContext, SyncWorkerAccess::class.java)
        val id = inputData.getString("profile") ?: return Result.failure()
        return when (access.coordinator().background(id)) {
            BackgroundResult.SUCCESS -> Result.success()
            BackgroundResult.RETRY -> Result.retry()
        }
    }
}

object SyncWork {
    private val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
    private fun data(id: String) = workDataOf("profile" to id)
    fun enqueue(context: Context, id: String) {
        WorkManager.getInstance(context).enqueueUniqueWork("widget-refresh", ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<WidgetUpdateWorker>().setInitialDelay(2, TimeUnit.SECONDS).build())
        val request = OneTimeWorkRequestBuilder<SyncWorker>().setInputData(data(id)).setConstraints(constraints)
            .setInitialDelay(3, TimeUnit.SECONDS).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).addTag("profile:$id").build()
        WorkManager.getInstance(context).enqueueUniqueWork("sync:$id", ExistingWorkPolicy.KEEP, request)
    }
    fun periodic(context: Context, id: String) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(constraints)
            .setInputData(data(id)).addTag("profile:$id").build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("periodic:$id", ExistingPeriodicWorkPolicy.KEEP, request)
    }
    fun cancel(context: Context, id: String) = WorkManager.getInstance(context).cancelAllWorkByTag("profile:$id")
}

class WidgetUpdateWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        io.github.xilele777.snotes.feature.notes.NotesWidget().updateAll(applicationContext)
        return Result.success()
    }
}
