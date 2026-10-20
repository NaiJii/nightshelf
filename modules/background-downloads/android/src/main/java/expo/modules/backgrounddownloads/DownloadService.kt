package expo.modules.backgrounddownloads

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.BitmapFactory
import android.net.ConnectivityManager
import android.net.Uri
import android.os.*
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class DownloadService : Service() {
  private class TransferTask(val id: String, val action: () -> Unit) : Runnable { override fun run() = action() }
  private val executor = ThreadPoolExecutor(2, 2, 0L, TimeUnit.MILLISECONDS, LinkedBlockingQueue<Runnable>())
  @Synchronized private fun reorder() {
    val pending = ArrayList<Runnable>()
    executor.queue.drainTo(pending)
    pending.sortedBy { task -> queueOrder.indexOf((task as TransferTask).id).let { if (it < 0) Int.MAX_VALUE else it } }.forEach { executor.execute(it) }
  }
  private val serviceJobs = ConcurrentHashMap<String, AtomicBoolean>()
  private val started = ConcurrentHashMap<String, AtomicBoolean>()
  private val preparing = ConcurrentHashMap.newKeySet<String>()
  private var wake: PowerManager.WakeLock? = null
  override fun onBind(intent: Intent?) = null
  override fun onCreate() {
    super.onCreate(); instance = this
    try { val jobs = JSONObject(File(directory(this), "queue.json").readText()).getJSONArray("jobs"); queueOrder = (0 until jobs.length()).map { jobs.getJSONObject(it).getString("id") } } catch (_: Exception) {}
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, "Offline downloads", NotificationManager.IMPORTANCE_LOW))
    val notification = notification("Preparing offline downloads…", 0)
    if (Build.VERSION.SDK_INT >= 29) startForeground(NOTICE, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(NOTICE, notification)
    wake = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NightShelf:Downloads").apply { acquire(6 * 60 * 60 * 1000L) }
    // Android may recreate a killed service. Persisted batches resume without JS.
    directory(this).listFiles()?.filter { it.name.endsWith(".plan") }?.sortedBy { queueOrder.indexOf(it.name.removeSuffix(".plan")).let { rank -> if (rank < 0) Int.MAX_VALUE else rank } }?.forEach { file ->
      val id = file.name.removeSuffix(".plan")
      try { if (JSONObject(File(directory(this), "$id.state").readText()).optString("state") in listOf("running", "queued")) run(id) } catch (_: Exception) {}
    }
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "prepare" && flags and START_FLAG_REDELIVERY != 0) {
      intent.getStringExtra("id")?.let { state(this, it, "paused", "Preparation interrupted · resume in the app", 0.0) }
      stopIfIdle(); return START_NOT_STICKY
    }
    if (intent?.action == "pause-all") {
      directory(this).listFiles()?.filter { it.name.endsWith(".state") }?.forEach { file ->
        try { if (JSONObject(file.readText()).optString("state") == "queued") { val id = file.name.removeSuffix(".state"); DownloadWorker.pause(this, id); state(this, id, "paused", "Paused from notification", 0.0) } } catch (_: Exception) {}
      }
      preparing.toList().forEach { state(this, it, "paused", "Paused from notification", 0.0); preparing.remove(it) }
      running.keys.toList().forEach { pause(it) }; stopIfIdle()
    } else {
      val id = intent?.getStringExtra("id")
      if (id != null) {
        checkId(id)
        if (intent.action == "prepare") { preparing.add(id); update("Preparing ${intent.getStringExtra("title") ?: "chapters"}…", 0) }
        else { preparing.remove(id); run(id) }
      }
    }
    return START_REDELIVER_INTENT
  }
  private fun notification(message: String, progress: Int): Notification = makeNotification(this, message, progress)
  private fun update(message: String, progress: Int) { getSystemService(NotificationManager::class.java).notify(NOTICE, notification(message, progress)) }
  private fun run(id: String) {
    val cancelled = acquire(id) ?: return
    serviceJobs[id] = cancelled
    state(this, id, "queued", "Queued by Android", 0.0)
    executor.execute(TransferTask(id) {
      var retry = false
      try {
        if (cancelled.get()) throw InterruptedException("Paused")
        started[id] = cancelled
        state(this, id, "running", "Saving chapters…", 0.0)
        TransferEngine(this).execute(id, cancelled) { message, progress -> update(message, progress) }
      } catch (error: Exception) {
        if (running[id] === cancelled) state(this, id, if (cancelled.get() || error is InterruptedException) "paused" else if (error is NetworkWait) "waiting" else "error", error.message ?: "Download failed", 0.0)
        retry = error is NetworkWait && !wasUserPaused(id)
      } finally { started.remove(id, cancelled); serviceJobs.remove(id, cancelled); running.remove(id, cancelled); if (retry && !wasUserPaused(id)) DownloadWorker.enqueue(this, id); Handler(Looper.getMainLooper()).post { stopIfIdle() } }
    })
    reorder()
  }
  private fun stopIfIdle() { Handler(Looper.getMainLooper()).postDelayed({ if (serviceJobs.isEmpty() && preparing.isEmpty()) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() } }, 5000) }
  override fun onTimeout(startId: Int, fgsType: Int) { serviceJobs.keys.toList().forEach { pause(it) }; preparing.clear(); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
  override fun onDestroy() { serviceJobs.keys.toList().forEach { pause(it) }; wake?.let { if (it.isHeld) it.release() }; instance = null; executor.shutdown(); super.onDestroy() }
  companion object {
    @Volatile private var queueOrder: List<String> = emptyList()
    fun reorder(ids: List<String>) { queueOrder = ids; instance?.reorder() }
    fun makeNotification(context: Context, message: String, progress: Int): Notification {
    if (Build.VERSION.SDK_INT >= 26) context.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "Offline downloads", NotificationManager.IMPORTANCE_LOW))
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
    val pause = PendingIntent.getService(context, 1, Intent(context, DownloadService::class.java).setAction("pause-all"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL) else Notification.Builder(context)
    val queue = QueueProgress.summary(context)
    val total = queue.optInt("total")
    val percent = if (total > 0) (queue.optDouble("progress") * 100).toInt().coerceIn(0, 100) else progress
    val title = if (total > 0) "Downloads · $percent% overall" else "NightShelf downloads"
    val detail = if (total > 0) "${queue.optInt("completed")}/$total series complete · $message" else message
    return builder.setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle(title).setContentText(detail).setStyle(Notification.BigTextStyle().bigText("$detail\nOverall progress averages each series’ saved pages.")).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false).setCategory(Notification.CATEGORY_PROGRESS).setProgress(100, percent, total == 0 && progress == 0).addAction(android.R.drawable.ic_media_pause, "Pause active", pause).build()
  }

    private const val CHANNEL = "offline-downloads"; private const val NOTICE = 901
    private val running = ConcurrentHashMap<String, AtomicBoolean>()
    private val userPaused = ConcurrentHashMap.newKeySet<String>()
    @Volatile private var instance: DownloadService? = null
    fun checkId(id: String) { require(id.matches(Regex("[a-zA-Z0-9_.-]+")) && id != "." && id != "..") }
    fun acquire(id: String): AtomicBoolean? { val flag = AtomicBoolean(userPaused.contains(id)); return if (running.putIfAbsent(id, flag) == null) flag else null }
    fun clearPause(id: String) { userPaused.remove(id) }
    fun wasUserPaused(id: String): Boolean = userPaused.contains(id)
    fun release(id: String, flag: AtomicBoolean) { running.remove(id, flag) }
    fun serviceRunning(): Boolean = instance != null
    fun isActive(id: String): Boolean = running.containsKey(id) || instance?.preparing?.contains(id) == true
    fun directory(context: Context): File = File(context.filesDir, "nightshelf-transfers").apply { mkdirs() }
    @Synchronized fun atomic(file: File, text: String) { file.parentFile?.mkdirs(); val temp = File(file.path + ".tmp"); temp.writeText(text); check(temp.renameTo(file)) { "Could not persist download state" } }
    fun state(context: Context, id: String, value: String, message: String, progress: Double) {
      val file = File(directory(context), "$id.state")
      val previous = if (value != "preparing") try { val old = JSONObject(file.readText()); if (old.optString("state") == "done" && value != "done") 0.0 else old.optDouble("progress", 0.0) } catch (_: Exception) { 0.0 } else 0.0
      atomic(file, JSONObject().put("state", value).put("message", message).put("progress", maxOf(previous, progress)).toString())
    }
    fun pause(id: String) { userPaused.add(id); val flag = running[id]; flag?.set(true); instance?.let { if (flag != null && it.serviceJobs[id] === flag && it.started[id] !== flag) { it.serviceJobs.remove(id, flag); running.remove(id, flag); state(it, id, "paused", "Paused", 0.0); it.stopIfIdle() }; if (it.preparing.remove(id)) { state(it, id, "paused", "Paused from notification", 0.0); it.stopIfIdle() } } }
    fun finishPreparation(context: Context, id: String) { instance?.let { if (it.preparing.remove(id)) { try { if (JSONObject(File(directory(context), "$id.state").readText()).optString("state") == "preparing") state(context, id, "paused", "Preparation stopped", 0.0) } catch (_: Exception) {} ; it.stopIfIdle() } } }
  }
}
