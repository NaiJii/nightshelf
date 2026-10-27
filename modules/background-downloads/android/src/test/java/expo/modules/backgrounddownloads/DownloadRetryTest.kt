package expo.modules.backgrounddownloads

import org.junit.Assert.*
import org.junit.Test

class DownloadRetryTest {
  @Test fun temporaryImageFailuresCanRecover() {
    for (code in listOf(408, 429, 500, 502, 503, 504)) assertTrue(DownloadRetry.transient("Image request failed ($code)", false))
    assertTrue(DownloadRetry.transient("Incomplete or damaged image", false))
    assertTrue(DownloadRetry.transient("Connection reset", true))
  }
  @Test fun accessAndPermanentErrorsNeedAttention() {
    for (code in listOf(401, 403, 404)) assertFalse(DownloadRetry.transient("Image request failed ($code)", false))
    assertFalse(DownloadRetry.transient("Unsafe image URL", false))
    assertFalse(DownloadRetry.transient("Download outside library", false))
  }
}
