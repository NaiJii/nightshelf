package expo.modules.backgrounddownloads

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

// One equal share per series; each series' progress counts its saved pages.
// This avoids pretending we know CDN response sizes before downloading them.
object QueueProgress {
  private fun file(context: Context) = File(DownloadService.directory(context), "queue.json")
  private fun read(context: Context): JSONObject = try { JSONObject(file(context).readText()) } catch (_: Exception) { JSONObject().put("jobs", JSONArray()).put("completed", 0) }
  private fun state(context: Context, id: String): JSONObject = try { JSONObject(File(DownloadService.directory(context), "$id.state").readText()) } catch (_: Exception) { JSONObject() }
  @Synchronized fun sync(context: Context, jobs: JSONArray) {
    val previous = read(context)
    val old = previous.getJSONArray("jobs")
    val ids = (0 until jobs.length()).map { jobs.getJSONObject(it).getString("id") }.toSet()
    var completed = if (old.length() == 0 && jobs.length() > 0) 0 else previous.optInt("completed")
    for (index in 0 until old.length()) {
      val job = old.getJSONObject(index)
      if (job.optBoolean("native") && job.getString("id") !in ids && state(context, job.getString("id")).optString("state") == "done") completed++
    }
    DownloadService.atomic(file(context), JSONObject().put("jobs", jobs).put("completed", completed).toString())
    val order = (0 until jobs.length()).map { jobs.getJSONObject(it).getString("id") }
    if (order != (0 until old.length()).map { old.getJSONObject(it).getString("id") }) DownloadService.reorder(order)
  }
  @Synchronized fun register(context: Context, id: String) {
    val current = read(context)
    var jobs = current.getJSONArray("jobs")
    // Background bookmark jobs can arrive while JS is asleep. Start a new batch
    // when all the old transfers have finished, rather than counting old history.
    if (jobs.length() == 0 || (0 until jobs.length()).all { state(context, jobs.getJSONObject(it).getString("id")).optString("state") == "done" }) {
      jobs = JSONArray(); current.put("completed", 0)
    }
    val existing = (0 until jobs.length()).map { jobs.getJSONObject(it) }.find { it.getString("id") == id }
    if (existing != null) existing.put("native", true)
    else jobs.put(JSONObject().put("id", id).put("native", true).put("progress", 0))
    DownloadService.atomic(file(context), current.put("jobs", jobs).toString())
  }
  @Synchronized fun summary(context: Context): JSONObject {
    val current = read(context)
    val jobs = current.getJSONArray("jobs")
    var pending = 0; var progress = 0.0
    for (index in 0 until jobs.length()) {
      val job = jobs.getJSONObject(index)
      val value = if (job.optBoolean("native")) state(context, job.getString("id")) else JSONObject()
      if (value.optString("state") == "done") continue
      pending++
      val fraction = maxOf(job.optDouble("progress", 0.0), value.optDouble("progress", 0.0))
      progress += if (fraction.isFinite()) fraction.coerceIn(0.0, 1.0) else 0.0
    }
    return JSONObject().put("total", pending).put("completed", 0).put("progress", if (pending > 0) progress / pending else 0.0)
  }
}
