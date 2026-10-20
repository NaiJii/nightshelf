import * as Notifications from "expo-notifications";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";
import type { Series } from "./parser";
import { refreshSeries, downloadChapters } from "./scraper";
import { loadCatalog, loadPreferences, releaseSnapshots, savedStories, mergeCatalog, saveReleaseSnapshot, addReleaseUpdates, readChapters, releaseUpdates, loadDownloads, saveDownloads } from "./storage";
import { newReleases } from "./release-policy";
import { backgroundTransfers, transferStates } from "./background-downloads";
import { freeBytes, libraryBytes } from "./library-tools";

const TASK = "nightshelf-bookmarked-releases";
const CHANNEL = "bookmarked-releases";
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });

export async function requestReleasePermission(): Promise<boolean> {
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Bookmarked releases", importance: Notifications.AndroidImportance.DEFAULT });
  const current = await Notifications.getPermissionsAsync();
  return current.granted || (await Notifications.requestPermissionsAsync()).granted;
}

export async function notifyReleases(items: Series[]): Promise<void> {
  const enabled = loadPreferences().releaseNotifications && (await Notifications.getPermissionsAsync()).granted;
  for (const item of items) {
    if (!savedStories()[item.slug]?.bookmarked || !item.chapterIds) continue;
    const previous = releaseSnapshots()[item.slug];
    const added = newReleases(previous, item.chapterIds);
    if (added.length) addReleaseUpdates(item.slug, added);
    if (enabled && added.length) {
      const identifier = `release-${item.slug}`;
      const pending = (await Notifications.getPresentedNotificationsAsync()).find(notification => notification.request.identifier === identifier)?.request.content.data?.chapters;
      const chapters = [...new Set([...(Array.isArray(pending) ? pending.filter((id): id is string => typeof id === "string") : []), ...added])];
      // A stable identifier replaces the previous alert for this series in Android's tray.
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: { title: item.title, body: `${chapters.length === 1 ? "1 new chapter is" : `${chapters.length} new chapters are`} available. Tap to choose what to download.`, data: { slug: item.slug, chapters }, sound: false },
        trigger: { channelId: CHANNEL },
      });
    }
    saveReleaseSnapshot(item.slug, [...new Set([...(previous || []), ...item.chapterIds])]);
  }
}

export async function configureReleaseChecks(): Promise<void> {
  const enabled = loadPreferences().releaseNotifications || Object.values(savedStories()).some(story => story.bookmarked && story.autoDownload);
  const registered = await TaskManager.isTaskRegisteredAsync(TASK);
  if (enabled && !registered) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
  if (!enabled && registered) await BackgroundTask.unregisterTaskAsync(TASK);
}

TaskManager.defineTask(TASK, async () => {
  const enabled = () => loadPreferences().releaseNotifications || Object.values(savedStories()).some(story => story.bookmarked && story.autoDownload);
  if (!enabled() || AppState.currentState === "active") return BackgroundTask.BackgroundTaskResult.Success;
  if (backgroundTransfers) { const states = transferStates(); saveDownloads(loadDownloads().filter(job => states[job.series.slug]?.state !== "done")); }
  // Background work never opens a consent dialog or silently uses cellular data.
  const guard = async () => {
    const state = await NetInfo.fetch();
    if (AppState.currentState === "active" || !enabled() || state.type !== "wifi" || !state.isConnected || state.isInternetReachable === false || state.details?.isConnectionExpensive) throw new Error("Background check paused.");
  };
  try {
    for (const item of loadCatalog().filter(item => savedStories()[item.slug]?.bookmarked)) {
      await guard();
      try {
        const fresh = await refreshSeries(item, guard);
        await guard();
        mergeCatalog([fresh]);
        await notifyReleases([fresh]);
        if (backgroundTransfers && savedStories()[fresh.slug]?.autoDownload && !loadDownloads().some(job => job.series.slug === fresh.slug) && !["running", "preparing", "queued"].includes(transferStates(fresh.slug)[fresh.slug]?.state) && libraryBytes() < loadPreferences().autoDownloadLimitMB * 1024 ** 2 && freeBytes() >= 64 * 1024 ** 2) {
          const ids = (releaseUpdates()[fresh.slug] || []).filter(id => fresh.chapterIds?.includes(id) && !fresh.localChapters?.includes(id) && !readChapters()[fresh.slug]?.[id]).slice(0, 20);
          if (ids.length) await downloadChapters(fresh, ids.join(","), () => {}, guard, undefined, ids, undefined, undefined, true, true);
        }
      } catch { await guard(); /* One unavailable story must not block the other bookmarks. */ }
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch { return BackgroundTask.BackgroundTaskResult.Failed; }
});
