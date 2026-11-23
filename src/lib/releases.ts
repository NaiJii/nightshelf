import * as Notifications from "expo-notifications";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { chapterListCached, type Series } from "./parser";
import { refreshSeries } from "./scraper";
import { loadPreferences, catalogMetadata, releaseSnapshots, savedStories, mergeCatalog, saveReleaseSnapshot, addReleaseUpdates, readChapters } from "./storage";
import { newReleases, unreadReleases } from "./release-policy";
import { updateStoryOptions } from "./library-tools";
import { NetworkPaused } from "./network";
import { throwIfAborted } from "./request-control";

const TASK = "nightshelf-bookmarked-releases";
const CHANNEL = "bookmarked-releases";
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });

let permissionRequest: Promise<boolean> | undefined;
let releaseChannel: Promise<void> | undefined;
function ensureReleaseChannel(): Promise<void> {
  return releaseChannel ??= Notifications.setNotificationChannelAsync(CHANNEL, { name: "Bookmarked releases", importance: Notifications.AndroidImportance.DEFAULT })
    .then(() => {}).catch(error => { releaseChannel = undefined; throw error; });
}
export async function releasePermissionGranted(): Promise<boolean> { return (await Notifications.getPermissionsAsync()).granted; }
export async function requestReleasePermission(promptAgain = true): Promise<boolean> {
  await ensureReleaseChannel();
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
      if (!(story?.bookmarked || story?.autoDownload) || !chapterListCached(item)) continue;
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

export async function removeLegacyReleaseSchedule(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(TASK)) await BackgroundTask.unregisterTaskAsync(TASK);
}

// An existing installation may wake once before the app is opened after updating.
TaskManager.defineTask(TASK, async () => {
  await removeLegacyReleaseSchedule().catch(() => {});
  return BackgroundTask.BackgroundTaskResult.Success;
});

export async function refreshTrackedReleases(
  guard: () => Promise<void>,
  warn: (message: string) => void,
  signal?: AbortSignal,
  onProgress?: (checked: number, total: number) => void,
): Promise<Series[]> {
  const saved = savedStories();
  const tracked = catalogMetadata().filter(item => saved[item.slug]?.bookmarked || saved[item.slug]?.autoDownload);
  const fresh: Series[] = [];
  if (tracked.length) onProgress?.(0, tracked.length);
  try {
    for (const [index, item] of tracked.entries()) {
      throwIfAborted(signal);
      await guard();
      try {
        const details = await refreshSeries(item, guard, signal);
        throwIfAborted(signal);
        fresh.push(details);
      } catch (error) {
        throwIfAborted(signal);
        if (error instanceof NetworkPaused) throw error;
        warn(error instanceof Error ? error.message : `Could not check ${item.title} for releases.`);
      }
      onProgress?.(index + 1, tracked.length);
    }
  } finally {
    if (fresh.length) mergeCatalog(fresh);
  }
  return fresh;
}
