package expo.modules.backgrounddownloads;

import java.io.File;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

public class TransferRecoveryTest {
  @Rule public TemporaryFolder temporary = new TemporaryFolder();

  @Test public void pauseSurvivesServiceAndRuntimeRecreation() throws Exception {
    File directory = temporary.newFolder();
    TransferRecovery.pause(directory, "story");
    // No in-memory flag is passed to the recreated runtime.
    assertTrue(TransferRecovery.isPaused(new File(directory.getPath()), "story"));
    assertFalse(TransferRecovery.canStart(true, "running", TransferRecovery.isPaused(directory, "story")));
    assertFalse(TransferRecovery.canStart(true, "queued", TransferRecovery.isPaused(directory, "story")));
  }

  @Test public void explicitResumeClearsOnlyThatStory() throws Exception {
    File directory = temporary.newFolder();
    TransferRecovery.pause(directory, "story");
    TransferRecovery.pause(directory, "other");
    TransferRecovery.resume(directory, "story");
    TransferRecovery.resume(directory, "story");
    assertFalse(TransferRecovery.isPaused(directory, "story"));
    assertTrue(TransferRecovery.isPaused(directory, "other"));
    assertTrue(TransferRecovery.canStart(true, "queued", TransferRecovery.isPaused(directory, "story")));
  }

  @Test public void redeliveredCompletedIntentCannotReplaceDoneWithError() {
    assertFalse(TransferRecovery.canStart(false, "done", false));
    // Death between committing Done and deleting the plan is also harmless.
    assertFalse(TransferRecovery.canStart(true, "done", false));
    assertFalse(TransferRecovery.canStart(false, "queued", false));
  }

  @Test public void incompletePlansRecoverButTerminalAndPreparationStatesDoNot() {
    for (String state : new String[]{"queued", "running", "waiting"}) {
      assertTrue(TransferRecovery.canStart(true, state, false));
      assertFalse(TransferRecovery.canStart(true, state, true));
    }
    for (String state : new String[]{"paused", "error", "preparing", ""}) {
      assertFalse(TransferRecovery.canStart(true, state, false));
    }
  }

  @Test public void bridgeGapPauseCancellationAndReaderHoldsBlockRecovery() {
    assertTrue(TransferRecovery.stopRequested(true, false, "downloading"));
    assertTrue(TransferRecovery.stopRequested(false, false, "paused"));
    assertTrue(TransferRecovery.stopRequested(false, false, "cancelling"));
    assertTrue(TransferRecovery.stopRequested(false, true, "queued"));
    assertFalse(TransferRecovery.stopRequested(false, false, "queued"));
    assertFalse(TransferRecovery.stopRequested(false, false, "downloading"));
  }

  @Test public void serviceRedeliveryCannotBypassScheduledWifiOrBackoffWaits() {
    for (String state : new String[]{"queued", "running", "waiting"}) {
      assertFalse(TransferRecovery.canStartService(true, state, false, true));
      assertTrue(TransferRecovery.canStart(true, state, false));
      assertTrue(TransferRecovery.canStartService(true, state, false, false));
    }
    assertFalse(TransferRecovery.canStartService(false, "done", false, false));
    assertFalse(TransferRecovery.canStartService(true, "running", true, false));
  }
}
