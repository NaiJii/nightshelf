package expo.modules.appupdates

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipFile

class AppUpdatesModule : Module() {
  private fun context() = appContext.reactContext ?: error("Update context unavailable")
  private fun flags() = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
  @Suppress("DEPRECATION")
  private fun installed() = context().packageManager.getPackageInfo(context().packageName, flags())
  @Suppress("DEPRECATION")
  private fun code(info: PackageInfo) = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
  @Suppress("DEPRECATION")
  private fun signers(info: PackageInfo): Set<String> {
    val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
    return signatures?.map { signature -> MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).joinToString("") { "%02x".format(it) } }?.toSet() ?: emptySet()
  }
  private fun file(uri: String): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file" && parsed.host.isNullOrEmpty()) { "Invalid update file" }
    val file = File(parsed.path ?: error("Missing update path")).canonicalFile
    val root = File(context().cacheDir, "app-updates").canonicalFile
    require(file.parentFile == root && file.name == "update.apk" && file.isFile) { "Update file unavailable" }
    return file
  }
  private fun abi() = if (Process.is64Bit()) "arm64-v8a" else "armeabi-v7a"

  override fun definition() = ModuleDefinition {
    Name("NightShelfAppUpdates")
    Function("installed") {
      val info = installed()
      JSONObject().put("version", info.versionName).put("versionCode", code(info))
        .put("architecture", if (Process.is64Bit()) "arm64" else "armv7")
        .put("canInstall", Build.VERSION.SDK_INT < 26 || context().packageManager.canRequestPackageInstalls()).toString()
    }
    // Hashing and APK parsing run on the module queue, never the UI thread.
    AsyncFunction("verify") { uri: String, expected: String, version: String ->
      require(expected.matches(Regex("[a-f0-9]{64}"))) { "Missing update checksum" }
      val apk = file(uri)
      val digest = MessageDigest.getInstance("SHA-256")
      apk.inputStream().use { input ->
        val buffer = ByteArray(65536)
        while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
      }
      require(digest.digest().joinToString("") { "%02x".format(it) } == expected) { "Update checksum mismatch. Download again." }
      val current = installed()
      val update = context().packageManager.getPackageArchiveInfo(apk.path, flags()) ?: error("Invalid Android package")
      require(update.packageName == context().packageName && update.versionName == version && code(update) > code(current)) { "This APK is not a newer NightShelf version" }
      require((update.applicationInfo?.minSdkVersion ?: Int.MAX_VALUE) <= Build.VERSION.SDK_INT) { "This update requires a newer Android version" }
      val trusted = signers(current)
      require(trusted.isNotEmpty() && signers(update) == trusted) { "Update signing certificate does not match NightShelf" }
      ZipFile(apk).use { zip ->
        val abis = zip.entries().asSequence().map { it.name }.filter { it.startsWith("lib/") && it.endsWith(".so") }.map { it.split('/')[1] }.toSet()
        require(abis == setOf(abi())) { "Update architecture does not match this installation" }
      }
      true
    }
    AsyncFunction("install") { uri: String, contentUri: String ->
      file(uri)
      val activity = appContext.currentActivity ?: error("Open NightShelf to install the update")
      if (Build.VERSION.SDK_INT >= 26 && !context().packageManager.canRequestPackageInstalls()) {
        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context().packageName}")))
        "permission"
      } else {
        val content = Uri.parse(contentUri)
        require(content.scheme == "content" && content.authority == "${context().packageName}.FileSystemFileProvider") { "Invalid update content URI" }
        activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(content, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        "installer"
      }
    }.runOnQueue(Queues.MAIN)
  }
}
