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
  companion object { private val STORAGE_LOCK = Any(); private var reservedBytes = 0L }
  private fun meteredAllowed(granted: Boolean) = MeteredPolicy.allowsMetered(granted) {
    val preferences = File(filesDir, "nightshelf/preferences.json")
    try { preferences.exists() && JSONObject(preferences.readText()).optString("mobileData") == "never" } catch (_: Exception) { true }
  }
  fun execute(id: String, cancelled: AtomicBoolean, update: (String, Int) -> Unit) {
        val plan = JSONObject(File(directory(this), "$id.plan").readText())
        val chapters = plan.getJSONArray("chapters"); val total = (0 until chapters.length()).sumOf { chapters.getJSONObject(it).getJSONArray("files").length().coerceAtLeast(1) }.coerceAtLeast(1)
        var done = 0
        for (chapterIndex in 0 until chapters.length()) {
          if (cancelled.get()) throw InterruptedException("Paused from notification")
          val chapter = chapters.getJSONObject(chapterIndex); val files = chapter.getJSONArray("files")
          val marker = target(chapter.getString("marker")); marker.parentFile?.mkdirs()
          if (chapter.has("text")) {
            val textFile = target(chapter.getString("textTarget")); val text = chapter.getString("text")
            synchronized(STORAGE_LOCK) {
              val limit = plan.optLong("limitBytes")
              if (textFile.parentFile!!.usableSpace < text.toByteArray().size + 8 * 1024 * 1024L || (limit > 0 && directorySize(File(filesDir, "nightshelf/library")) - textFile.length() + text.toByteArray().size > limit)) throw NetworkWait("Download storage limit reached")
              atomic(textFile, text)
            }
            atomic(marker, JSONObject().put("kind", "novel").put("hash", hash(textFile)).toString()); done++
          } else {
            val urls = JSONArray(); val hashes = JSONArray()
            // Invalidate the old completion flag until every page passes validation.
            marker.delete()
            for (index in 0 until files.length()) {
              if (cancelled.get()) throw InterruptedException("Paused from notification")
              val file = files.getJSONObject(index); val url = file.getString("url"); val output = target(file.getString("target")); val original = target(file.getString("original"))
              val expected = file.optString("hash"); val digest = if (output.exists()) hash(output) else ""
              val reusable = output.exists() && original.exists() && original.readText() == url && imageValid(output) && (expected.isEmpty() || digest == expected)
              if (!reusable) {
                val network = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
                if (!meteredAllowed(plan.optBoolean("allowMetered")) && network.isActiveNetworkMetered) throw NetworkWait("Waiting for unmetered Wi-Fi")
                val limit = plan.optLong("limitBytes")
                if (limit > 0 && directorySize(File(filesDir, "nightshelf/library")) >= limit) throw NetworkWait("Automatic download storage limit reached")
                if (output.parentFile!!.usableSpace < 32 * 1024 * 1024L) throw NetworkWait("Phone storage is almost full")
                fetch(file, output, cancelled, plan.optBoolean("allowMetered"), plan.optLong("limitBytes"))
                atomic(original, url)
              }
              urls.put(url); hashes.put(if (reusable) digest else hash(output)); done++
              val message = "${plan.getString("title")} · ${chapter.getString("id")} · ${index + 1}/${files.length()}"
              state(this, id, "running", message, done.toDouble() / total); update(message, done * 100 / total)
            }
            atomic(marker, JSONObject().put("quality", 2).put("urls", urls).put("hashes", hashes).toString())
          }
          state(this, id, "running", "Chapter ${chapter.getString("id")} saved", done.toDouble() / total)
        }
        state(this, id, "done", "Saved for offline reading", 1.0)
        update("Saved for offline reading", 100)
        File(directory(this), "$id.plan").delete()
  }
  private fun target(uri: String): File {
    require(uri.startsWith("file://")) { "Invalid download path" }
    val file = File(Uri.parse(uri).path ?: "").canonicalFile
    require(file.path.startsWith(File(filesDir, "nightshelf/library").canonicalPath + File.separator)) { "Download outside library" }
    return file
  }
  private fun fetch(file: JSONObject, output: File, cancelled: AtomicBoolean, allowMetered: Boolean, limitBytes: Long) {
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
        if (temp.exists()) temp.delete()
        try {
          if (limitBytes > 0 && expectedLength > 0) synchronized(STORAGE_LOCK) {
            if (directorySize(File(filesDir, "nightshelf/library")) + reservedBytes + expectedLength > limitBytes) throw NetworkWait("Automatic download storage limit reached")
            reservation = expectedLength; reservedBytes += expectedLength
          }
        connection.inputStream.use { input -> temp.outputStream().use { stream ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            if (cancelled.get()) throw InterruptedException("Paused")
            val count = input.read(buffer); if (count < 0) break
            if (temp.parentFile!!.usableSpace < 8 * 1024 * 1024L) throw NetworkWait("Phone storage is almost full")
            if (!meteredAllowed(allowMetered) && (getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered) throw NetworkWait("Waiting for unmetered Wi-Fi")
            if (limitBytes > 0) synchronized(STORAGE_LOCK) {
              val unreserved = (count.toLong() - reservation).coerceAtLeast(0)
              if (unreserved > 0 && directorySize(File(filesDir, "nightshelf/library")) + reservedBytes + unreserved > limitBytes) throw NetworkWait("Automatic download storage limit reached")
              stream.write(buffer, 0, count)
              val used = count.toLong().coerceAtMost(reservation); reservation -= used; reservedBytes -= used
            } else stream.write(buffer, 0, count)
            length += count
          }
        } }
        } finally { if (reservation > 0) synchronized(STORAGE_LOCK) { reservedBytes -= reservation } }
        require(length > 0 && (expectedLength < 0 || expectedLength == length) && imageValid(temp)) { "Incomplete or damaged image" }
        require(temp.renameTo(output)) { "Could not save image" }
        return
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
