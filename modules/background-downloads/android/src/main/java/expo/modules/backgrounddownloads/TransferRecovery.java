package expo.modules.backgrounddownloads;

import java.io.File;
import java.io.IOException;

/** Persistent user intent must outlive both the service and the JS runtime. */
public final class TransferRecovery {
  private TransferRecovery() {}

  public static boolean canStart(boolean hasPlan, String state, boolean paused) {
    return hasPlan && !paused && ("queued".equals(state) || "running".equals(state) || "waiting".equals(state));
  }

  public static boolean canStartService(boolean hasPlan, String state, boolean paused, boolean scheduled) {
    return !scheduled && canStart(hasPlan, state, paused);
  }

  public static boolean stopRequested(boolean pauseRequested, boolean readerHeld, String status) {
    return pauseRequested || readerHeld || "paused".equals(status) || "cancelling".equals(status);
  }

  public static boolean isPaused(File directory, String id) {
    return new File(directory, id + ".pause").exists();
  }

  public static void pause(File directory, String id) throws IOException {
    File marker = new File(directory, id + ".pause");
    if (!marker.exists() && !marker.createNewFile()) throw new IOException("Could not persist download pause");
  }

  public static void resume(File directory, String id) throws IOException {
    File marker = new File(directory, id + ".pause");
    if (marker.exists() && !marker.delete()) throw new IOException("Could not clear download pause");
  }
}
