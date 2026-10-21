package expo.modules.backgrounddownloads

import android.content.Context
import android.content.ContextWrapper
import android.graphics.BitmapFactory
import android.net.ConnectivityManager
import android.net.Uri
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import expo.modules.backgrounddownloads.DownloadService.Companion.atomic
import expo.modules.backgrounddownloads.DownloadService.Companion.directory
import expo.modules.backgrounddownloads.DownloadService.Companion.state

internal class NetworkWait(message: String) : Exception(message)
class TransferEngine(context: Context) : ContextWrapper(context) {
  companion object {
    private val STORAGE_LOCK = Any()
    private var reservedBytes = 0L
    private var accountedBytes = 0L
    private var accountedAt = 0L
    private var writers = 0
  }
  // Reconcile external deletions/writes at page boundaries, never in the chunk loop.
  private fun refreshStorage() {
    val now = android.os.SystemClock.elapsedRealtime()
    if (accountedAt == 0L || now - accountedAt >= 30000L) {
      accountedBytes = directorySize(File(filesDir, "nightshelf/library")); accountedAt = now
    }
  }
  private fun discard(file: File) = synchronized(STORAGE_LOCK) {
    val bytes = file.length()
    if (file.exists()) { require(file.delete()) { "Could not remove partial download" }; accountedBytes = (accountedBytes - bytes).coerceAtLeast(0) }
  }
  private fun writeMetadata(file: File, text: String) = synchronized(STORAGE_LOCK) {
    val before = file.length()
    try { atomic(file, text) } finally { accountedBytes += file.length() - before }
  }
  private fun meteredAllowed(granted: Boolean) = MeteredPolicy.allowsMetered(granted) {
    val preferences = File(filesDir, "nightshelf/preferences.json")
    try { preferences.exists() && JSONObject(preferences.readText()).optString("mobileData") == "never" } catch (_: Exception) { true }
  }
  fun execute(id: String, cancelled: AtomicBoolean, update: (String, Int) -> Unit) {
    val plan = JSONObject(File(directory(this), "$id.plan").readText())
    val chapters = plan.getJSONArray("chapters"); val total = (0 until chapters.length()).sumOf { chapters.getJSONObject(it).getJSONArray("files").length().coerceAtLeast(1) }.coerceAtLeast(1)
    synchronized(STORAGE_LOCK) { if (writers == 0) accountedAt = 0; refreshStorage(); writers++ }
    try {
      // Only touch partials owned by this plan; another story can still be writing.
      for (chapterIndex in 0 until chapters.length()) {
        val files = chapters.getJSONObject(chapterIndex).getJSONArray("files")
        for (index in 0 until files.length()) discard(File(target(files.getJSONObject(index).getString("target")).path + ".part"))
      }
      var done = 0
      for (chapterIndex in 0 until chapters.length()) {
        if (cancelled.get()) throw InterruptedException("Paused from notification")
        val chapter = chapters.getJSONObject(chapterIndex); val files = chapter.getJSONArray("files")
        val marker = target(chapter.getString("marker")); marker.parentFile?.mkdirs()
        synchronized(STORAGE_LOCK) { refreshStorage() }
        if (chapter.has("text")) {
          val textFile = target(chapter.getString("textTarget")); val text = chapter.getString("text")
          synchronized(STORAGE_LOCK) {
            val limit = plan.optLong("limitBytes")
            if (textFile.parentFile!!.usableSpace < text.toByteArray().size + 8 * 1024 * 1024L || (limit > 0 && accountedBytes + reservedBytes - textFile.length() + text.toByteArray().size > limit)) throw NetworkWait("Download storage limit reached")
            writeMetadata(textFile, text)
          }
          writeMetadata(marker, JSONObject().put("kind", "novel").put("hash", hash(textFile)).toString()); done++
        } else {
          val urls = JSONArray(); val hashes = JSONArray()
          // Keep a valid saved chapter visible while checking reusable pages.
          for (index in 0 until files.length()) {
            if (cancelled.get()) throw InterruptedException("Paused from notification")
            val file = files.getJSONObject(index); val url = file.getString("url"); val output = target(file.getString("target")); val original = target(file.getString("original"))
            val expected = file.optString("hash"); val digest = if (output.exists()) hash(output) else ""
            val reusable = output.exists() && original.exists() && original.readText() == url && imageValid(output) && (expected.isEmpty() || digest == expected)
            if (!reusable) {
              discard(File(output.path + ".part"))
              val network = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
              if (!meteredAllowed(plan.optBoolean("allowMetered")) && network.isActiveNetworkMetered) throw NetworkWait("Waiting for unmetered Wi-Fi")
              val limit = plan.optLong("limitBytes")
              if (limit > 0 && synchronized(STORAGE_LOCK) { refreshStorage(); accountedBytes + reservedBytes >= limit }) throw NetworkWait("Automatic download storage limit reached")
              if (output.parentFile!!.usableSpace < 32 * 1024 * 1024L) throw NetworkWait("Phone storage is almost full")
              fetch(file, output, marker, cancelled, plan.optBoolean("allowMetered"), plan.optLong("limitBytes"))
              writeMetadata(original, url)
            }
            urls.put(url); hashes.put(if (reusable) digest else hash(output)); done++
            val message = "${plan.getString("title")} · ${chapter.getString("id")} · ${index + 1}/${files.length()}"
            state(this, id, "running", message, done.toDouble() / total); update(message, done * 100 / total)
          }
          writeMetadata(marker, JSONObject().put("quality", 2).put("urls", urls).put("hashes", hashes).toString())
        }
        state(this, id, "running", "Chapter ${chapter.getString("id")} saved", done.toDouble() / total)
      }
      state(this, id, "done", "Saved for offline reading", 1.0)
      update("Saved for offline reading", 100)
      File(directory(this), "$id.plan").delete()
    } finally { synchronized(STORAGE_LOCK) { writers-- } }
  }
  private fun target(uri: String): File {
    require(uri.startsWith("file://")) { "Invalid download path" }
    val file = File(Uri.parse(uri).path ?: "").canonicalFile
    require(file.path.startsWith(File(filesDir, "nightshelf/library").canonicalPath + File.separator)) { "Download outside library" }
    return file
  }
  private fun fetch(file: JSONObject, output: File, marker: File, cancelled: AtomicBoolean, allowMetered: Boolean, limitBytes: Long) {
    var url = URL(file.getString("url")); var connection: HttpURLConnection? = null
    try {
      for (redirect in 0..5) {
        if (!meteredAllowed(allowMetered) && (getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered) throw NetworkWait("Waiting for unmetered Wi-Fi")
        require(url.protocol == "https") { "Unsafe image URL" }
        connection = url.openConnection() as HttpURLConnection
        connection.connectTimeout = 30000; connection.readTimeout = 30000; connection.instanceFollowRedirects = false
        connection.setRequestProperty("User-Agent", file.getString("agent")); connection.setRequestProperty("Referer", if (url.host == "2xstorage.com" || url.host.endsWith(".2xstorage.com") || url.host == "storage.waitst.com") "https://www.mangakakalot.gg/" else file.getString("referer"))
        val code = connection.responseCode
        if (code in 300..399) { val location = connection.getHeaderField("Location") ?: throw IllegalStateException("Invalid image redirect"); val next = URL(url, location); connection.disconnect(); url = next; continue }
        require(code in 200..299 && connection.contentType?.startsWith("image/") == true) { "Image request failed ($code)" }
        val expectedLength = connection.contentLengthLong
        val temp = File(output.path + ".part"); var length = 0L; var reservation = 0L
        discard(temp)
        try {
          if (limitBytes > 0 && expectedLength > 0) synchronized(STORAGE_LOCK) {
            if (accountedBytes + reservedBytes + expectedLength > limitBytes) throw NetworkWait("Automatic download storage limit reached")
            reservation = expectedLength; reservedBytes += expectedLength
          }
        connection.inputStream.use { input -> temp.outputStream().use { stream ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            if (cancelled.get()) throw InterruptedException("Paused")
            val count = input.read(buffer); if (count < 0) break
            if (temp.parentFile!!.usableSpace < 8 * 1024 * 1024L) throw NetworkWait("Phone storage is almost full")
            if (!meteredAllowed(allowMetered) && (getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered) throw NetworkWait("Waiting for unmetered Wi-Fi")
            synchronized(STORAGE_LOCK) {
              val unreserved = (count.toLong() - reservation).coerceAtLeast(0)
              if (limitBytes > 0 && unreserved > 0 && accountedBytes + reservedBytes + unreserved > limitBytes) throw NetworkWait("Automatic download storage limit reached")
              try { stream.write(buffer, 0, count); accountedBytes += count }
              catch (error: IOException) { accountedAt = 0; throw error }
              val used = count.toLong().coerceAtMost(reservation); reservation -= used; reservedBytes -= used
            }
            length += count
          }
        } }
        require(length > 0 && (expectedLength < 0 || expectedLength == length) && imageValid(temp)) { "Incomplete or damaged image" }
        synchronized(STORAGE_LOCK) {
          val replaced = output.length()
          discard(marker)
          require(temp.renameTo(output)) { "Could not save image" }
          accountedBytes -= replaced
        }
        return
        } finally {
          synchronized(STORAGE_LOCK) { reservedBytes -= reservation }
          discard(temp)
        }
      }
      throw IllegalStateException("Too many image redirects")
    } catch (error: IOException) {
      val network = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
      if (network.activeNetwork == null || (!meteredAllowed(allowMetered) && network.isActiveNetworkMetered)) throw NetworkWait("Connection interrupted · waiting for an allowed network")
      throw error
    } finally { connection?.disconnect() }
  }
  private fun imageValid(file: File): Boolean { val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeFile(file.path, options); return options.outWidth > 0 && options.outHeight > 0 }
  private fun hash(file: File): String { val digest = MessageDigest.getInstance("MD5"); file.inputStream().use { input -> val buffer = ByteArray(65536); while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) } }; return digest.digest().joinToString("") { "%02x".format(it) } }
  private fun directorySize(file: File): Long = if (file.isDirectory) file.listFiles()?.sumOf { directorySize(it) } ?: 0 else file.length()
}
