package expo.modules.backgrounddownloads

object MeteredPolicy {
  @Volatile private var wifiOnly: Boolean? = null
  @Synchronized fun update(onlyWifi: Boolean) { wifiOnly = onlyWifi }
  fun allowsMetered(granted: Boolean, readWifiOnly: () -> Boolean): Boolean {
    if (!granted) return false
    val restricted = wifiOnly ?: synchronized(this) { wifiOnly ?: readWifiOnly().also { wifiOnly = it } }
    return !restricted
  }
}
