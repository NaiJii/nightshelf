package expo.modules.backgrounddownloads

internal object DownloadRetry {
  fun transient(message: String?, io: Boolean): Boolean {
    if (io) return true
    return Regex("(?i)(image request failed \\((408|429|5[0-9]{2})\\)|incomplete or damaged image|timed? ?out|connection (reset|interrupted)|network request failed)").containsMatchIn(message ?: "")
  }
}
