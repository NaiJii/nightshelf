package expo.modules.sourcesession

import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebSettings
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SourceSessionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NightShelfSourceSession")
    AsyncFunction("verificationUserAgent") {
      WebSettings.getDefaultUserAgent(appContext.reactContext ?: throw IllegalStateException("WebView context unavailable"))
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("verificationCookies") { url: String ->
      val uri = Uri.parse(url)
      if (uri.scheme != "https" || uri.port !in setOf(-1, 443) || uri.host !in setOf("www.mangakakalot.gg", "mangakakalot.gg")) {
        throw IllegalArgumentException("Unsupported verification host")
      }
      // Only challenge cookies return to the scraper; account/session cookies stay in WebView.
      (CookieManager.getInstance().getCookie(url) ?: "").split(";")
        .map { it.trim() }
        .filter { it.substringBefore("=") in setOf("cf_clearance", "__cf_bm") }
        .joinToString("; ")
    }.runOnQueue(Queues.MAIN)
  }
}
