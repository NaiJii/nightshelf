package expo.modules.readercontrols

import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.webkit.WebView
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

class ReaderControlsModule : Module() {
  private var readerWindow: WeakReference<Window>? = null
  private var originalBrightness = -1f
  private var originalKeepAwake = false
  @Volatile private var volumeScrolling = false

  override fun definition() = ModuleDefinition {
    Name("NightShelfReaderControls")
    Events("onVolumeKey")
    OnCreate { instance = WeakReference(this@ReaderControlsModule) }

    AsyncFunction("configure") { active: Boolean, keepAwake: Boolean, brightness: Double, volume: Boolean ->
      if (!active) {
        restore()
      } else {
        val window = appContext.currentActivity?.window ?: throw IllegalStateException("Reader window unavailable")
        if (readerWindow?.get() !== window) {
          restore()
          readerWindow = WeakReference(window)
          originalBrightness = window.attributes.screenBrightness
          originalKeepAwake = window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON != 0
        }
        window.attributes = window.attributes.apply {
          screenBrightness = if (brightness < 0 || !brightness.isFinite()) originalBrightness else brightness.coerceIn(0.1, 1.0).toFloat()
        }
        if (keepAwake || originalKeepAwake) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        volumeScrolling = volume
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("zoomReader") { baseUrl: String, factor: Double ->
      val window = readerWindow?.get()
      if (window == null || window !== appContext.currentActivity?.window || !window.decorView.hasWindowFocus() ||
        !baseUrl.startsWith("file://") || !factor.isFinite() || factor < 1.0 / 6.0 || factor > 2.0) {
        false
      } else {
        val web = findReader(window.decorView, baseUrl)
        if (web == null) false else { web.zoomBy(factor.toFloat()); true }
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersBackground { restore() }
    OnActivityDestroys { restore() }
    OnDestroy {
      volumeScrolling = false
      val window = readerWindow?.get()
      window?.decorView?.post { restore() }
      if (instance?.get() === this@ReaderControlsModule) instance = null
    }
  }

  private fun findReader(view: View, baseUrl: String): WebView? {
    if (!view.isShown) return null
    if (view is WebView) return if (view.url == baseUrl) view else null
    if (view is ViewGroup) for (index in 0 until view.childCount) {
      findReader(view.getChildAt(index), baseUrl)?.let { return it }
    }
    return null
  }

  private fun restore() {
    volumeScrolling = false
    readerWindow?.get()?.let { window ->
      window.attributes = window.attributes.apply { screenBrightness = originalBrightness }
      if (!originalKeepAwake) window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    readerWindow = null
  }

  companion object {
    @Volatile private var instance: WeakReference<ReaderControlsModule>? = null

    @JvmStatic fun handleVolumeKey(event: KeyEvent): Boolean {
      val module = instance?.get() ?: return false
      if (!module.volumeScrolling || (event.keyCode != KeyEvent.KEYCODE_VOLUME_DOWN && event.keyCode != KeyEvent.KEYCODE_VOLUME_UP)) return false
      if (event.action == KeyEvent.ACTION_DOWN && !event.isCanceled && event.repeatCount == 0) {
        module.sendEvent("onVolumeKey", mapOf("direction" to if (event.keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) 1 else -1))
      }
      return true
    }
  }
}
