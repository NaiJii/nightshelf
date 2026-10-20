package expo.modules.backgrounddownloads

import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.work.*
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

class DownloadWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  private var cancelled: AtomicBoolean? = null
  override fun doWork(): Result {
    val id = inputData.getString("id") ?: return Result.failure()
    DownloadService.checkId(id)
    if (!File(DownloadService.directory(applicationContext), "$id.plan").exists()) return Result.success()
    val flag = DownloadService.acquire(id) ?: return Result.retry()
    cancelled = flag
    try {
      val notification = DownloadService.makeNotification(applicationContext, "Downloading bookmarked releases…", 0)
      setForegroundAsync(if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(902, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(902, notification)).get()
      DownloadService.state(applicationContext, id, "running", "Saving offline chapters…", 0.0)
      TransferEngine(applicationContext).execute(id, flag) { message, progress ->
        val updated = DownloadService.makeNotification(applicationContext, message, progress)
        setForegroundAsync(if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(902, updated, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(902, updated))
      }
      return Result.success()
    } catch (error: Exception) {
      val paused = DownloadService.wasUserPaused(id)
      DownloadService.state(applicationContext, id, if (paused) "paused" else if (flag.get() || error is NetworkWait) "waiting" else "error", error.message ?: "Background download failed", 0.0)
      return if (!paused && (flag.get() || error is NetworkWait)) Result.retry() else Result.failure()
    } finally { DownloadService.release(id, flag) }
  }
  override fun onStopped() { cancelled?.set(true); super.onStopped() }
  companion object {
    fun enqueue(context: Context, id: String) {
      val plan = JSONObject(File(DownloadService.directory(context), "$id.plan").readText())
      val request = OneTimeWorkRequest.Builder(DownloadWorker::class.java).setInputData(Data.Builder().putString("id", id).build()).setConstraints(Constraints.Builder().setRequiredNetworkType(if (plan.optBoolean("allowMetered")) NetworkType.CONNECTED else NetworkType.UNMETERED).build()).build()
      DownloadService.state(context, id, "queued", "Waiting for Android · Wi-Fi downloads", 0.0)
      WorkManager.getInstance(context).enqueueUniqueWork("nightshelf-$id", ExistingWorkPolicy.REPLACE, request)
    }
    fun pause(context: Context, id: String) = WorkManager.getInstance(context).cancelUniqueWork("nightshelf-$id").result
  }
}
