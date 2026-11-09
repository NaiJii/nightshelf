package expo.modules.backgrounddownloads

import android.content.Intent
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import org.json.JSONObject
import org.json.JSONArray
import java.io.File

class BackgroundDownloadsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NightShelfBackgroundDownloads")
    Function("serviceRunning") { DownloadService.serviceRunning() }
    Function("setNetworkPolicy") { wifiOnly: Boolean -> MeteredPolicy.update(wifiOnly) }
    Function("syncQueue") { json: String -> appContext.reactContext?.let { QueueProgress.sync(it, JSONArray(json)) }; Unit }
    Function("queueSummary") { appContext.reactContext?.let { QueueProgress.summary(it).toString() } ?: "{}" }
    AsyncFunction("readerProgress") { id: String, title: String, message: String, progress: Double, finished: Boolean ->
      DownloadService.checkId(id)
      val context = appContext.reactContext ?: return@AsyncFunction
      val manager = context.getSystemService(NotificationManager::class.java)
      val tag = "reader:$id"
      if (finished) { manager.cancel(tag, 1); return@AsyncFunction }
      if (Build.VERSION.SDK_INT >= 24 && !manager.areNotificationsEnabled()) return@AsyncFunction
      val channel = "reader-downloads"
      if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(channel, "Reading downloads", NotificationManager.IMPORTANCE_LOW))
      val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
      val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, channel).setTimeoutAfter(120_000) else Notification.Builder(context)
      val percent = if (progress.isFinite()) (progress.coerceIn(0.0, 1.0) * 100).toInt() else 0
      manager.notify(tag, 1, builder.setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle(title).setContentText("$message · $percent%")
        .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false).setCategory(Notification.CATEGORY_PROGRESS).setProgress(100, percent, percent == 0).build())
    }.runOnQueue(Queues.MAIN)
    Function("states") { selected: String? ->
      val context = appContext.reactContext ?: return@Function "{}"
      val all = JSONObject()
      if (selected != null) DownloadService.checkId(selected)
      val files = if (selected == null) DownloadService.directory(context).listFiles()?.filter { it.name.endsWith(".state") } ?: emptyList() else listOf(File(DownloadService.directory(context), "$selected.state"))
      files.forEach {
        try { val id = it.name.removeSuffix(".state"); all.put(id, JSONObject(it.readText()).put("active", DownloadService.isActive(id)).put("hasPlan", File(DownloadService.directory(context), "$id.plan").exists())) } catch (_: Exception) {}
      }
      all.toString()
    }
    AsyncFunction("begin") { id: String, title: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Download context unavailable")
      DownloadService.checkId(id)
      DownloadService.clearPause(id)
      DownloadService.state(context, id, "preparing", "Preparing chapters…", 0.0)
      QueueProgress.register(context, id)
      val intent = Intent(context, DownloadService::class.java).putExtra("id", id).putExtra("title", title).setAction("prepare")
      if (DownloadService.serviceRunning()) context.startService(intent) else if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      Unit
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("enqueue") { json: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Download context unavailable")
      val plan = JSONObject(json); val id = plan.getString("id"); DownloadService.checkId(id)
      DownloadService.clearPause(id)
      DownloadService.atomic(File(DownloadService.directory(context), "$id.plan"), json)
      QueueProgress.register(context, id)
      if (plan.optBoolean("automatic")) {
        DownloadWorker.enqueue(context, id)
        DownloadService.finishPreparation(context, id)
        return@AsyncFunction
      }
      DownloadService.state(context, id, "queued", "Queued by Android", 0.0)
      val intent = Intent(context, DownloadService::class.java).putExtra("id", id).putExtra("title", plan.getString("title")).setAction("download")
      if (DownloadService.serviceRunning()) context.startService(intent) else if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      Unit
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("pause") { id: String ->
      DownloadService.checkId(id); DownloadService.pause(id)
      appContext.reactContext?.let { context -> DownloadWorker.pause(context, id).get(); DownloadService.pause(id); if (!DownloadService.isActive(id)) DownloadService.state(context, id, "paused", "Paused", 0.0) }
      Unit
    }
    AsyncFunction("resume") { id: String ->
      DownloadService.checkId(id)
      DownloadService.clearPause(id)
      val context = appContext.reactContext ?: throw IllegalStateException("Download context unavailable")
      val intent = Intent(context, DownloadService::class.java).putExtra("id", id).setAction("download")
      if (DownloadService.serviceRunning()) context.startService(intent) else if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      Unit
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("endPreparation") { id: String ->
      DownloadService.checkId(id)
      val context = appContext.reactContext ?: return@AsyncFunction
      DownloadService.finishPreparation(context, id)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("discard") { id: String ->
      DownloadService.checkId(id)
      val context = appContext.reactContext ?: throw IllegalStateException("Download context unavailable")
      DownloadWorker.pause(context, id).get()
      check(!DownloadService.isActive(id)) { "Wait for the native writer to stop" }
      File(DownloadService.directory(context), "$id.plan").delete()
      File(DownloadService.directory(context), "$id.state").delete()
      Unit
    }
  }
}
