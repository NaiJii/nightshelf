import * as Notifications from "expo-notifications";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";
import { chapterListCached } from "./parser";
import type { Series } from "./parser";
import { refreshSeries, downloadChapters } from "./scraper";
import { loadCatalog, loadPreferences, releaseSnapshots, savedStories, mergeCatalog, saveReleaseSnapshot, addReleaseUpdates, readChapters, releaseUpdates, loadDownloads, saveDownloads } from "./storage";
import { newReleases, automaticReleaseIds, unreadReleases } from "./release-policy";
import { backgroundTransfers, transferStates } from "./background-downloads";
import { freeBytes, libraryBytes, updateStoryOptions, cleanupReadDownloads } from "./library-tools";

const TASK = "nightshelf-bookmarked-releases";
const CHANNEL = "bookmarked-releases";
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });

let permissionRequest: Promise<boolean> | undefined;
export async function releasePermissionGranted(): Promise<boolean> { return (await Notifications.getPermissionsAsync()).granted; }
export async function requestReleasePermission(promptAgain = true): Promise<boolean> {
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Bookmarked releases", importance: Notifications.AndroidImportance.DEFAULT });
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (current.canAskAgain === false || (!promptAgain && current.status !== "undetermined")) return false;
  permissionRequest ??= Notifications.requestPermissionsAsync().then(result => result.granted).finally(() => { permissionRequest = undefined; });
  return permissionRequest;
}

let notificationWork = Promise.resolve();
export function notifyReleases(items: Series[]): Promise<void> {
  // Detail refreshes and sync can finish together; consume each release snapshot once.
  notificationWork = notificationWork.catch(() => {}).then(() => publishReleases(items));
  return notificationWork;
}
async function publishReleases(items: Series[]): Promise<void> {
  const enabled = loadPreferences().releaseNotifications && (await Notifications.getPermissionsAsync()).granted;
  const failures: unknown[] = [];
  for (const item of items) {
    try {
      const story = savedStories()[item.slug];
      if (!story?.bookmarked || !chapterListCached(item)) continue;
      if (story.autoDownload && !Array.isArray(story.autoDownloadBaseline)) updateStoryOptions(item.slug, { autoDownloadBaseline: [...item.chapterIds!] });
      const previous = releaseSnapshots()[item.slug];
      const added = newReleases(previous, item.chapterIds!);
      if (added.length) addReleaseUpdates(item.slug, added);
      if (enabled && story.notifyReleases !== false && added.length) {
        const identifier = `release-${item.slug}`;
        const pending = (await Notifications.getPresentedNotificationsAsync()).find(notification => notification.request.identifier === identifier)?.request.content.data?.chapters;
        const chapters = unreadReleases([...(Array.isArray(pending) ? pending.filter((id): id is string => typeof id === "string") : []), ...added], readChapters()[item.slug], item.chapterIds);
        // A stable identifier replaces the previous alert for this series in Android's tray.
        const current = savedStories()[item.slug];
        if (chapters.length && loadPreferences().releaseNotifications && current?.bookmarked && current.notifyReleases !== false) await Notifications.scheduleNotificationAsync({
          identifier,
          content: { title: item.title, body: `${chapters.length} new ${chapters.length === 1 ? "chapter" : "chapters"}`, data: { slug: item.slug, chapters }, sound: false },
          trigger: { channelId: CHANNEL },
        });
      }
      saveReleaseSnapshot(item.slug, [...new Set([...(previous || []), ...item.chapterIds!])]);
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw failures[0];
}

function releaseChecksEnabled(): boolean {
  const preferences = loadPreferences();
  return preferences.deleteAfterReading || Object.values(savedStories()).some(story => story.bookmarked && (story.autoDownload || (preferences.releaseNotifications && story.notifyReleases !== false)));
}
let configuration = Promise.resolve();
export function configureReleaseChecks(): Promise<void> {
  configuration = configuration.catch(() => {}).then(async () => {
    const enabled = releaseChecksEnabled(), interval = loadPreferences().releaseCheckInterval;
    const registered = await TaskManager.isTaskRegisteredAsync(TASK);
    const options = registered ? await TaskManager.getTaskOptionsAsync<{ minimumInterval?: number }>(TASK) : undefined;
    if (registered && (!enabled || options?.minimumInterval !== interval)) await BackgroundTask.unregisterTaskAsync(TASK);
    if (enabled && (!registered || options?.minimumInterval !== interval)) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: interval });
  });
  return configuration;
}

TaskManager.defineTask(TASK, async () => {
  const enabled = releaseChecksEnabled;
  if (!enabled() || AppState.currentState === "active") return BackgroundTask.BackgroundTaskResult.Success;
  await cleanupReadDownloads(slug => AppState.currentState === "active" || loadDownloads().some(job => job.series.slug === slug) || Boolean(transferStates(slug)[slug]?.active || transferStates(slug)[slug]?.hasPlan));
  if (backgroundTransfers) { const states = transferStates(); saveDownloads(loadDownloads().filter(job => states[job.series.slug]?.state !== "done")); }
  // Background work never opens a consent dialog or silently uses cellular data.
  const guard = async () => {
    const state = await NetInfo.fetch();
    if (AppState.currentState === "active" || !enabled() || state.type !== "wifi" || !state.isConnected || state.isInternetReachable === false || state.details?.isConnectionExpensive) throw new Error("Background check paused.");
  };
  try {
    for (const item of loadCatalog().filter(item => { const story = savedStories()[item.slug]; return story?.bookmarked && (story.autoDownload || (loadPreferences().releaseNotifications && story.notifyReleases !== false)); })) {
      await guard();
      try {
        const fresh = await refreshSeries(item, guard);
        await guard();
        mergeCatalog([fresh]);
        await notifyReleases([fresh]).catch(() => {});
        if (backgroundTransfers && savedStories()[fresh.slug]?.autoDownload && !loadDownloads().some(job => job.series.slug === fresh.slug) && !["running", "preparing", "queued"].includes(transferStates(fresh.slug)[fresh.slug]?.state) && libraryBytes(true) < loadPreferences().autoDownloadLimitMB * 1024 ** 2 && freeBytes() >= 64 * 1024 ** 2) {
          const ids = automaticReleaseIds(savedStories()[fresh.slug], fresh, releaseUpdates()[fresh.slug], readChapters()[fresh.slug]).slice(0, 20);
          if (ids.length) await downloadChapters(fresh, ids.join(","), () => {}, guard, undefined, ids, undefined, undefined, true, true);
        }
      } catch { await guard(); /* One unavailable story must not block the other bookmarks. */ }
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch { return BackgroundTask.BackgroundTaskResult.Failed; }
});
