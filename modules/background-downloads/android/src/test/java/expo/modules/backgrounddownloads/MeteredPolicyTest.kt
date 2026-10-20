package expo.modules.backgrounddownloads

import org.junit.Assert.*
import org.junit.Test

class MeteredPolicyTest {
  @Test fun liveRestrictionsOverrideExistingTransferApproval() {
    assertFalse(MeteredPolicy.allowsMetered(false) { error("An unapproved plan must stay Wi-Fi only") })
    assertFalse(MeteredPolicy.allowsMetered(true) { true })
    MeteredPolicy.update(false)
    assertTrue(MeteredPolicy.allowsMetered(true) { error("Live policy should already be loaded") })
    assertFalse(MeteredPolicy.allowsMetered(false) { false })
    MeteredPolicy.update(true)
    assertFalse(MeteredPolicy.allowsMetered(true) { false })
  }
}
