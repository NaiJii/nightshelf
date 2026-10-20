import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert, AppState } from "react-native";
import { usePathname } from "expo-router";
import NetInfo from "@react-native-community/netinfo";
import { chapterListCached, ContentMode, Series } from "./parser";
import { browseCatalog, enrichCatalogIds, downloadChapters, refreshSeries, searchCatalog, syncCatalog } from "./scraper";
import type { BrowseCursor, BrowseOptions } from "./scraper";
import { deleteChapters, catalogMetadata, loadCatalogAsync, loadPreferences, Preferences, savedStories, mergeCatalog, savePreferences, readChapters, markChapterRead, localChapters, releaseUpdates, setChaptersRead, loadDownloads, saveDownloads } from "./storage";
import { networkGuard, NetworkPaused } from "./network";
import { automaticReleaseIds } from "./release-policy";
import { connectionAccess, connectionPauseMessage, connectionLabel } from "./network-policy";
import { configureReleaseChecks, notifyReleases, requestReleasePermission } from "./releases";
import { DownloadQueue, restoredDownloads } from "./download-queue";
import { throwIfAborted, withLinkedAbort, withForeground } from "./request-control";
import { backgroundTransfers, DownloadPaused, transferStates, stopTransfer } from "./background-downloads";
import { freeBytes, libraryBytesAsync, updateStoryOptions } from "./library-tools";
import type { SavedStory } from "./parser";

function useAppState() {
  const pathname = usePathname();
  const [catalog, setCatalog] = useState(catalogMetadata);
  const [catalogReady, setCatalogReady] = useState(false);
  const catalogScan = useRef<{ running: Promise<void> | null; again: boolean }>({ running: null, again: false });
  const refreshCatalog = useCallback((): Promise<void> => {
    if (catalogScan.current.running) { catalogScan.current.again = true; return catalogScan.current.running; }
    const scan = async () => {
      do {
        catalogScan.current.again = false;
        const fresh = await loadCatalogAsync();
        setCatalog(previous => {
          const old = new Map(previous.map(item => [item.slug, item]));
          const next = fresh.map(item => JSON.stringify(old.get(item.slug)) === JSON.stringify(item) ? old.get(item.slug)! : item);
          return next.length === previous.length && next.every((item, index) => item === previous[index]) ? previous : next;
        });
        setCatalogReady(true);
      } while (catalogScan.current.again);
    };
    catalogScan.current.running = scan().catch(error => { setNotice(error instanceof Error ? error.message : String(error)); }).finally(() => { catalogScan.current.running = null; });
    return catalogScan.current.running;
  }, []);
  const [preferences, setPreferences] = useState(loadPreferences);
  const [saved, setSaved] = useState(savedStories);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [networkNotice, setNetworkNotice] = useState("");
  const [connection, setConnection] = useState(() => connectionLabel({ type: "unknown", isConnected: null, isInternetReachable: null }));
  const [read, setRead] = useState(readChapters);
  const [updates, setUpdates] = useState(releaseUpdates);
  const [detailsLoading, setDetailsLoading] = useState<string[]>([]);
  const [detailsErrors, setDetailsErrors] = useState<Record<string, string>>({});
  const noticeScope = useRef("");
  const scope = `${pathname}:${preferences.source}:${preferences.webtoonLanguage}:${preferences.webtoonCollection}`;
  useEffect(() => {
    noticeScope.current = scope;
    setNotice(""); setNetworkNotice("");
  }, [scope]);
  useEffect(() => { void refreshCatalog().catch(error => setNotice(error instanceof Error ? error.message : String(error))); }, [refreshCatalog]);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sourceSessionRevision, setSourceSessionRevision] = useState(0);
  const sourceSessionChanged = useCallback(() => { setNotice(current => current.includes("needs browser verification") ? "" : current); setSourceSessionRevision(value => value + 1); }, []);
  const detailLocks = useRef(new Set<string>());
  const notificationLock = useRef(false);
  const syncLock = useRef(false);
  const providerRequests = useRef(new AbortController());
  const deleteLock = useRef(false);
  const lastAttempt = useRef(0);
  const lastAccess = useRef<ReturnType<typeof connectionAccess> | null>(null);
  const showFailure = useCallback((error: unknown, origin = noticeScope.current) => {
    if (origin !== noticeScope.current) return;
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof NetworkPaused) setNetworkNotice(message);
    else setNotice(message);
  }, []);

  const lastQueueSave = useRef({ at: 0, state: "" });
  const [queue] = useState(() => new DownloadQueue(restoredDownloads(loadDownloads()), async (job, signal, progress, plan) => {
    try {
      const item = (await loadCatalogAsync(signal)).find(item => item.slug === job.series.slug) || job.series;
      const current = transferStates(item.slug)[item.slug];
      const access = networkGuard("Save these chapters for offline reading?", job.automatic, Boolean(backgroundTransfers));
      const guard = async () => {
        if (backgroundTransfers && transferStates(item.slug)[item.slug]?.state === "paused") throw new DownloadPaused("Paused from notification");
        if (job.autoBookmark) {
          const network = await NetInfo.fetch();
          if (network.type !== "wifi" || network.details?.isConnectionExpensive || !network.isConnected) throw new NetworkPaused("Automatic downloads wait for unmetered Wi-Fi.");
          if (await libraryBytesAsync(signal) >= loadPreferences().autoDownloadLimitMB * 1024 ** 2 || freeBytes() < 64 * 1024 ** 2) throw new NetworkPaused("Automatic download storage limit reached.");
        }
        await access();
      };
      await access();
      backgroundTransfers?.setNetworkPolicy(loadPreferences().mobileData === "never");
      if (backgroundTransfers && AppState.currentState === "active") await requestReleasePermission();
      throwIfAborted(signal);
      if (backgroundTransfers && current?.hasPlan) {
        if (job.autoBookmark) { const network = await NetInfo.fetch(); if (network.type !== "wifi" || network.details?.isConnectionExpensive) throw new NetworkPaused("Automatic downloads wait for unmetered Wi-Fi."); }
        throwIfAborted(signal);
        if (!current.active) await backgroundTransfers.resume(item.slug);
        return "native" as const;
      }
      if (backgroundTransfers) await backgroundTransfers.begin(item.slug, item.title);
      await downloadChapters(item, job.selection, progress, guard, signal, job.chapters, plan, () => void refreshCatalog(), job.autoBookmark, Boolean(backgroundTransfers));
      if (backgroundTransfers) return "native" as const;
    } finally { if (signal.aborted) await stopTransfer(job.series.slug); await backgroundTransfers?.endPreparation(job.series.slug).catch(() => {}); void refreshCatalog(); setPreferences(loadPreferences()); }
  }, jobs => {
    const state = jobs.map(job => `${job.series.slug}:${job.status}:${Boolean(job.native)}:${job.chapters?.join(",")}`).join("|");
    if (state !== lastQueueSave.current.state || Date.now() - lastQueueSave.current.at >= 1000) {
      saveDownloads(jobs); backgroundTransfers?.syncQueue(JSON.stringify(jobs.map(job => ({ id: job.series.slug, native: Boolean(job.native), progress: job.progress }))));
      lastQueueSave.current = { at: Date.now(), state };
    }
  }, slug => deleteChapters(slug, [], true), () => AppState.currentState === "active" || Boolean(backgroundTransfers?.serviceRunning()), loadDownloads));
  const downloadBusy = useCallback((slug?: string) => queue.isBusy(slug) || Object.entries(transferStates(slug)).some(([id, value]) => (value.active || (value.hasPlan && ["queued", "waiting", "running", "preparing"].includes(value.state))) && (!slug || id === slug)), [queue]);
  const pauseDownload = useCallback((slug: string) => { const origin = noticeScope.current; queue.pause(slug); void backgroundTransfers?.pause(slug).catch(error => showFailure(error, origin)); }, [queue, showFailure]);
  const resumeDownload = useCallback((slug: string) => { if (deleteLock.current) { setNotice("Wait for deletion to finish before resuming downloads."); return; } const origin = noticeScope.current; void stopTransfer(slug).then(() => queue.resume(slug)).catch(error => showFailure(error, origin)); }, [queue, showFailure]);
  const cancelDownload = useCallback(async (slug: string, deleteFiles = false) => { if (queue.jobs.find(job => job.series.slug === slug)?.autoBookmark) { updateStoryOptions(slug, { autoDownload: false }); setSaved(savedStories()); } await queue.cancel(slug, deleteFiles, async () => { await stopTransfer(slug); await backgroundTransfers?.discard(slug); }); void refreshCatalog(); }, [queue, refreshCatalog]);

  const search = useCallback(async (query: string, mode: ContentMode) => {
    setNetworkNotice("");
    try {
      const ids = await searchCatalog(query, mode, networkGuard("Search the website for comics and novels?"));
      void refreshCatalog(); setNetworkNotice("");
      return ids;
    } catch (error) { if (error instanceof NetworkPaused) showFailure(error); throw error; }
  }, [showFailure, refreshCatalog]);
  const browse = useCallback(async (options: BrowseOptions, cursor: BrowseCursor, signal: AbortSignal, manual = false) => {
    const providerSignal = providerRequests.current.signal;
    const access = networkGuard("Load more comics and novels?", !manual);
    try {
      const page = await withLinkedAbort([signal, providerSignal], combined => browseCatalog(options, cursor, access, combined, () => void refreshCatalog(), false));
      const origin = noticeScope.current;
      void withLinkedAbort([signal, providerSignal], async combined => {
        await new Promise(resolve => setTimeout(resolve, 120)); throwIfAborted(combined);
        await enrichCatalogIds(page.ids, access, combined, () => void refreshCatalog());
      }).catch(error => { if (!signal.aborted && !providerSignal.aborted && error instanceof NetworkPaused) showFailure(error, origin); });
      throwIfAborted(signal); throwIfAborted(providerSignal); void refreshCatalog(); setNetworkNotice(""); return page;
    } catch (error) { if (!signal.aborted && !providerSignal.aborted && error instanceof NetworkPaused) showFailure(error); throw error; }
  }, [showFailure, refreshCatalog]);

  const removeDownloads = useCallback(async (item: Series, chapters: string[], all = false) => {
    if (deleteLock.current) return false;
    if (downloadBusy(item.slug) || queue.jobs.some(job => job.series.slug === item.slug && ["queued", "downloading", "waiting", "cancelling"].includes(job.status))) { setNotice("Pause or cancel this story’s download before deleting its chapters."); return false; }
    deleteLock.current = true;
    setDeleting(true);
    await new Promise(resolve => setTimeout(resolve, 30));
    try { deleteChapters(item.slug, chapters, all); void refreshCatalog(); return true; }
    catch (error) { void refreshCatalog(); Alert.alert("Could not delete chapters", error instanceof Error ? error.message : String(error)); return false; }
    finally { deleteLock.current = false; setDeleting(false); }
  }, [queue, downloadBusy, refreshCatalog]);
  const completeChapter = useCallback((slug: string, chapter: string) => { markChapterRead(slug, chapter); setRead(readChapters()); }, []);
  const setReadStatus = useCallback((slug: string, chapters: string[], value: boolean) => { setChaptersRead(slug, chapters, value); setRead(readChapters()); }, []);
  const leaveChapter = useCallback((slug: string, chapter: string) => {
    if (!loadPreferences().deleteAfterReading || !readChapters()[slug]?.[chapter] || !localChapters(slug).includes(chapter) || downloadBusy(slug)) return;
    try { deleteChapters(slug, [chapter]); void refreshCatalog(); }
    catch { setNotice("The read chapter could not be deleted. You can remove it in Manage downloads."); }
  }, [downloadBusy, refreshCatalog]);
  const autoDownload = useCallback(async () => {
    const network = await NetInfo.fetch();
    if (deleteLock.current || AppState.currentState !== "active" || network.type !== "wifi" || !network.isConnected || network.isInternetReachable === false || network.details?.isConnectionExpensive) return;
    const items = await loadCatalogAsync();
    if (deleteLock.current || AppState.currentState !== "active") return;
    const options = savedStories(), ledger = readChapters(), releases = releaseUpdates();
    for (const item of items) if (options[item.slug]?.bookmarked && options[item.slug]?.autoDownload && item.detailsCached) {
      if (["running", "preparing", "queued"].includes(transferStates(item.slug)[item.slug]?.state)) continue;
      const ids = automaticReleaseIds(options[item.slug], item, releases[item.slug], ledger[item.slug]);
      if (ids.length) queue.enqueue(item, ids.join(","), true);
    }
  }, [queue]);

  const loadDetails = useCallback(async (slug: string, force = false) => {
    const item = catalogMetadata().find(value => value.slug === slug);
    if (!item) return;
    const cached = chapterListCached(item);
    if (!force && cached && Array.isArray(item.genres)) return;
    if (detailLocks.current.has(slug)) return;
    const origin = noticeScope.current;
    detailLocks.current.add(slug); setDetailsLoading(current => [...current, slug]);
    setDetailsErrors(current => { const next = { ...current }; delete next[slug]; return next; });
    try {
      const fresh = await withForeground(() => refreshSeries(item, networkGuard("Refresh this story’s details?"), undefined, force || !cached));
      mergeCatalog([fresh]);
      await refreshCatalog();
      await notifyReleases([fresh]).catch(error => showFailure(error, origin)); setUpdates(releaseUpdates());
      await autoDownload().catch(error => showFailure(error, origin));
    } catch (error) {
      setDetailsErrors(current => ({ ...current, [slug]: error instanceof Error ? error.message : String(error) }));
    }
    finally { detailLocks.current.delete(slug); setDetailsLoading(current => current.filter(value => value !== slug)); }
  }, [autoDownload, showFailure, refreshCatalog]);

  const toggleStory = useCallback((slug: string, field: "liked" | "bookmarked") => {
    updateStoryOptions(slug, { [field]: !savedStories()[slug]?.[field] });
    setSaved(savedStories()); setUpdates(releaseUpdates());
  }, []);

  const providerViews = useRef<Partial<Record<string, Partial<Preferences>>>>({});
  const updatePreferences = useCallback((change: Partial<Preferences>) => {
    const previous = loadPreferences();
    if (change.source && change.source !== previous.source) {
      const { sort, period, contentMode, hideDownloaded, hideLiked, hideBookmarked } = previous;
      providerViews.current[previous.source || "asura"] = { sort, period, contentMode, hideDownloaded, hideLiked, hideBookmarked };
    }
    const value = { ...previous, ...(change.source && change.source !== previous.source ? providerViews.current[change.source] : {}), ...change };
    if ((["source", "webtoonLanguage", "webtoonCollection"] as const).some(key => value[key] !== previous[key])) {
      providerRequests.current.abort(); providerRequests.current = new AbortController(); lastAttempt.current = 0;
    }
    savePreferences(value);
    backgroundTransfers?.setNetworkPolicy(value.mobileData === "never");
    setPreferences(value);
  }, []);

  const setStoryOptions = useCallback((slug: string, change: Partial<SavedStory>) => { updateStoryOptions(slug, change); setSaved(savedStories()); setUpdates(releaseUpdates()); }, []);
  const reloadLocal = useCallback(() => { void refreshCatalog(); setRead(readChapters()); setSaved(savedStories()); setPreferences(loadPreferences()); }, [refreshCatalog]);

  useEffect(() => { void autoDownload().catch(showFailure); void configureReleaseChecks().catch(showFailure); }, [autoDownload, saved, showFailure, preferences.releaseCheckInterval, preferences.releaseNotifications]);

  const setReleaseNotifications = useCallback(async (enabled: boolean) => {
    if (notificationLock.current) return false;
    notificationLock.current = true; setNotificationBusy(true);
    try {
      if (enabled && !await requestReleasePermission()) { updatePreferences({ releaseNotifications: false }); Alert.alert("Notifications are disabled", "Allow NightShelf notifications in Android Settings to receive release alerts."); return false; }
      updatePreferences({ releaseNotifications: enabled });
      await configureReleaseChecks();
      return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return false; }
    finally { notificationLock.current = false; setNotificationBusy(false); }
  }, [updatePreferences]);

  const setStoryNotifications = useCallback(async (slug: string, enabled: boolean) => {
    if (enabled && !await setReleaseNotifications(true)) return;
    setStoryOptions(slug, { notifyReleases: enabled });
  }, [setReleaseNotifications, setStoryOptions]);

  const sync = useCallback(async (automatic = false) => {
    const settings = loadPreferences();
    if (syncLock.current || queue.isBusy() || (automatic && (!settings.autoSync || Date.now() - lastAttempt.current < settings.interval * 60_000))) return;
    syncLock.current = true;
    lastAttempt.current = Date.now();
    setSyncing(true);
    const signal = providerRequests.current.signal;
    const origin = noticeScope.current;
    setNetworkNotice("");
    if (!automatic) setRefreshing(true);
    try {
      const warnings: string[] = [];
      const fresh = await syncCatalog(() => {}, networkGuard("Refresh story summaries, ratings and chapter lists?", automatic), !automatic, message => warnings.push(message), signal);
      throwIfAborted(signal);
      await refreshCatalog();
      await notifyReleases(fresh);
      await autoDownload();
      if (origin === noticeScope.current) setNotice(warnings.join(" "));
    } catch (error) {
      if (!signal.aborted) { void refreshCatalog(); showFailure(error, origin); }
      if (error instanceof NetworkPaused) lastAttempt.current = 0;
    } finally {
      syncLock.current = false;
      setSyncing(false);
      setRefreshing(false);
      setPreferences(loadPreferences());
      setUpdates(releaseUpdates());
    }
  }, [showFailure, queue, autoDownload, refreshCatalog]);

  const startDownload = useCallback((item: Series, selection: string) => {
    if (deleteLock.current) { setNotice("Wait for deletion to finish before adding a download."); return false; }
    setNetworkNotice("");
    return queue.enqueue(item, selection);
  }, [queue]);

  useEffect(() => {
    backgroundTransfers?.setNetworkPolicy(preferences.mobileData === "never");
    let mounted = true;
    void NetInfo.fetch().then(state => {
      if (!mounted) return;
      const access = connectionAccess(state, preferences.mobileData, false);
      setNetworkNotice(current => current ? connectionPauseMessage(access) : "");
      if (access === "allow") { if (!syncLock.current) lastAttempt.current = 0; if (AppState.currentState === "active") { queue.reconcileNative(transferStates()); queue.resumeWaiting(); void sync(true); } }
    }).catch(() => {});
    return () => { mounted = false; };
  }, [preferences.mobileData, sync, queue]);

  useEffect(() => {
    if (!backgroundTransfers) return;
    const poll = () => {
      if (AppState.currentState !== "active") return;
      const before = queue.jobs.filter(job => job.native).map(job => `${job.series.slug}:${job.progress}:${job.status}`).join("|");
      queue.reconcileNative(transferStates());
      const after = queue.jobs.filter(job => job.native).map(job => `${job.series.slug}:${job.progress}:${job.status}`).join("|");
      if (before !== after) void refreshCatalog();
    };
    poll(); const timer = setInterval(poll, 1000);
    return () => clearInterval(timer);
  }, [queue, refreshCatalog]);

  useEffect(() => {
    const states = transferStates();
    const recovery = setTimeout(() => { for (const job of [...queue.jobs]) if (job.status === "cancelling") void cancelDownload(job.series.slug).catch(showFailure); }, 0);
    queue.reconcileNative(states);
    queue.resumeWaiting();
    void configureReleaseChecks().catch(() => setNotice("Background release checks are unavailable. Releases will still be checked when the app is open."));
    const timer = setInterval(() => { if (AppState.currentState === "active") void sync(true); }, 60_000);
    const app = AppState.addEventListener("change", state => {
      if (state === "active") { setNetworkNotice(""); void refreshCatalog(); setRead(readChapters()); setUpdates(releaseUpdates()); setPreferences(loadPreferences()); queue.reconcileNative(transferStates()); queue.resumeWaiting(); queue.pump(); void sync(true); }
      else if (!backgroundTransfers) queue.suspend();
    });
    const unsubscribe = NetInfo.addEventListener(state => {
      const next = connectionLabel(state);
      setConnection(current => current.label === next.label ? current : next);
      const access = connectionAccess(state, loadPreferences().mobileData, false);
      if (access === "allow" && lastAccess.current !== "allow" && !syncLock.current) lastAttempt.current = 0;
      lastAccess.current = access;
      setNetworkNotice(current => current ? connectionPauseMessage(access) : "");
      if (state.isConnected && AppState.currentState === "active") { queue.reconcileNative(transferStates()); if (access === "allow") queue.resumeWaiting(); void sync(true); }
    });
    return () => { clearTimeout(recovery); clearInterval(timer); app.remove(); unsubscribe(); };
  }, [sync, queue, showFailure, cancelDownload, refreshCatalog]);

  return { catalogReady, connection, setStoryNotifications, setStoryOptions, reloadLocal, sourceSessionRevision, sourceSessionChanged, catalog, saved, read, updates, completeChapter, setReadStatus, leaveChapter, detailsLoading, detailsErrors, notificationBusy, deleting, setReleaseNotifications, toggleStory, loadDetails, removeDownloads, search, browse, preferences, updatePreferences, syncing, refreshing, downloadQueue: queue, downloadBusy, pauseDownload, resumeDownload, cancelDownload, notice: networkNotice || notice, dismissNotice: () => { setNotice(""); setNetworkNotice(""); }, sync, startDownload };
}
const AppContext = createContext<ReturnType<typeof useAppState> | null>(null);
export function AppProvider({ children }: { children: ReactNode }) { return <AppContext.Provider value={useAppState()}>{children}</AppContext.Provider>; }
export function useShelf() { const value = useContext(AppContext); if (!value) throw new Error("AppProvider is missing"); return value; }
export function useDownloads(statusOnly = false) { const { downloadQueue } = useShelf(); const snapshot = statusOnly ? downloadQueue.getStatusSnapshot : downloadQueue.getSnapshot; return useSyncExternalStore(downloadQueue.subscribe, snapshot, snapshot); }

