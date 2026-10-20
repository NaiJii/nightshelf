import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert, AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { ContentMode, Series } from "./parser";
import { browseCatalog, downloadChapters, refreshSeries, searchCatalog, syncCatalog } from "./scraper";
import type { BrowseCursor, BrowseOptions } from "./scraper";
import { deleteChapters, loadCatalog, loadPreferences, Preferences, savedStories, mergeCatalog, savePreferences, toggleSaved, readChapters, markChapterRead, saveReleaseSnapshot, localChapters, releaseUpdates, clearReleaseUpdates, setChaptersRead, loadDownloads, saveDownloads } from "./storage";
import { networkGuard, NetworkPaused } from "./network";
import { connectionAccess, connectionPauseMessage, connectionLabel } from "./network-policy";
import { configureReleaseChecks, notifyReleases, requestReleasePermission } from "./releases";
import { DownloadQueue, restoredDownloads } from "./download-queue";
import { throwIfAborted } from "./request-control";
import { backgroundTransfers, DownloadPaused, transferStates, stopTransfer } from "./background-downloads";
import { freeBytes, libraryBytes, updateStoryOptions } from "./library-tools";
import type { SavedStory } from "./parser";

function useAppState() {
  const [catalog, setCatalog] = useState(loadCatalog);
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
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sourceSessionRevision, setSourceSessionRevision] = useState(0);
  const sourceSessionChanged = useCallback(() => { setNotice(current => current.includes("needs browser verification") ? "" : current); setSourceSessionRevision(value => value + 1); }, []);
  const detailLocks = useRef(new Set<string>());
  const notificationLock = useRef(false);
  const syncLock = useRef(false);
  const deleteLock = useRef(false);
  const lastAttempt = useRef(0);
  const lastAccess = useRef<ReturnType<typeof connectionAccess> | null>(null);
  const showFailure = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof NetworkPaused) setNetworkNotice(message);
    else setNotice(message);
  }, []);

  const [downloads, setDownloads] = useState(() => restoredDownloads(loadDownloads()));
  const [queue] = useState(() => new DownloadQueue(downloads, async (job, signal, progress, plan) => {
    try {
      const item = loadCatalog().find(item => item.slug === job.series.slug) || job.series;
      const current = transferStates(item.slug)[item.slug];
      if (backgroundTransfers && current?.hasPlan && ["running", "queued"].includes(current.state)) {
        if (!current.active && current.state === "running") await backgroundTransfers.resume(item.slug);
        return "native" as const;
      }
      const access = networkGuard("Save these chapters for offline reading?", job.automatic, Boolean(backgroundTransfers));
      const guard = async () => {
        if (backgroundTransfers && transferStates(item.slug)[item.slug]?.state === "paused") throw new DownloadPaused("Paused from notification");
        if (job.autoBookmark) {
          const network = await NetInfo.fetch();
          if (network.type !== "wifi" || network.details?.isConnectionExpensive || !network.isConnected) throw new NetworkPaused("Automatic downloads wait for unmetered Wi-Fi.");
          if (libraryBytes() >= loadPreferences().autoDownloadLimitMB * 1024 ** 2 || freeBytes() < 64 * 1024 ** 2) throw new NetworkPaused("Automatic download storage limit reached.");
        }
        await access();
      };
      if (backgroundTransfers && AppState.currentState === "active") await requestReleasePermission();
      await access();
      if (backgroundTransfers) await backgroundTransfers.begin(item.slug, item.title);
      await downloadChapters(item, job.selection, progress, guard, signal, job.chapters, plan, () => setCatalog(loadCatalog()), job.autoBookmark, Boolean(backgroundTransfers));
      if (backgroundTransfers) return "native" as const;
    } finally { if (signal.aborted) await stopTransfer(job.series.slug); await backgroundTransfers?.endPreparation(job.series.slug).catch(() => {}); setCatalog(loadCatalog()); setPreferences(loadPreferences()); }
  }, jobs => { saveDownloads(jobs); backgroundTransfers?.syncQueue(JSON.stringify(jobs.map(job => ({ id: job.series.slug, native: Boolean(job.native), progress: job.progress })))); setDownloads(jobs); }, slug => deleteChapters(slug, [], true), () => AppState.currentState === "active" || Boolean(backgroundTransfers?.serviceRunning())));
  const downloadBusy = useCallback((slug?: string) => queue.isBusy(slug) || Object.entries(transferStates(slug)).some(([id, value]) => (value.active || (value.hasPlan && ["queued", "waiting", "running", "preparing"].includes(value.state))) && (!slug || id === slug)), [queue]);
  const pauseDownload = useCallback((slug: string) => { queue.pause(slug); void backgroundTransfers?.pause(slug); }, [queue]);
  const resumeDownload = useCallback((slug: string) => { if (deleteLock.current) { setNotice("Wait for deletion to finish before resuming downloads."); return; } void stopTransfer(slug).then(() => queue.resume(slug)); }, [queue]);
  const cancelDownload = useCallback(async (slug: string, deleteFiles = false) => { if (queue.jobs.find(job => job.series.slug === slug)?.autoBookmark) { updateStoryOptions(slug, { autoDownload: false }); setSaved(savedStories()); } await queue.cancel(slug, deleteFiles, async () => { await stopTransfer(slug); await backgroundTransfers?.discard(slug); }); setCatalog(loadCatalog()); }, [queue]);

  const search = useCallback(async (query: string, mode: ContentMode) => {
    setNetworkNotice("");
    try {
      const ids = await searchCatalog(query, mode, networkGuard("Search the website for comics and novels?"));
      setCatalog(loadCatalog()); setNetworkNotice("");
      return ids;
    } catch (error) { if (error instanceof NetworkPaused) showFailure(error); throw error; }
  }, [showFailure]);
  const browse = useCallback(async (options: BrowseOptions, cursor: BrowseCursor, signal: AbortSignal, manual = false) => {
    try {
      const page = await browseCatalog(options, cursor, networkGuard("Load more comics and novels?", !manual), signal);
      throwIfAborted(signal); setCatalog(loadCatalog()); setNetworkNotice(""); return page;
    } catch (error) { if (!signal.aborted && error instanceof NetworkPaused) showFailure(error); throw error; }
  }, [showFailure]);

  const removeDownloads = useCallback(async (item: Series, chapters: string[], all = false) => {
    if (deleteLock.current) return false;
    if (downloadBusy(item.slug) || queue.jobs.some(job => job.series.slug === item.slug && ["queued", "downloading", "waiting", "cancelling"].includes(job.status))) { setNotice("Pause or cancel this story’s download before deleting its chapters."); return false; }
    deleteLock.current = true;
    setDeleting(true);
    await new Promise(resolve => setTimeout(resolve, 30));
    try { deleteChapters(item.slug, chapters, all); setCatalog(loadCatalog()); return true; }
    catch (error) { setCatalog(loadCatalog()); Alert.alert("Could not delete chapters", error instanceof Error ? error.message : String(error)); return false; }
    finally { deleteLock.current = false; setDeleting(false); }
  }, [queue, downloadBusy]);
  const completeChapter = useCallback((slug: string, chapter: string) => { markChapterRead(slug, chapter); setRead(readChapters()); }, []);
  const setReadStatus = useCallback((slug: string, chapters: string[], value: boolean) => { setChaptersRead(slug, chapters, value); setRead(readChapters()); }, []);
  const leaveChapter = useCallback((slug: string, chapter: string) => {
    if (!loadPreferences().deleteAfterReading || !readChapters()[slug]?.[chapter] || !localChapters(slug).includes(chapter) || downloadBusy(slug)) return;
    try { deleteChapters(slug, [chapter]); setCatalog(loadCatalog()); }
    catch { setNotice("The read chapter could not be deleted. You can remove it in Manage downloads."); }
  }, [downloadBusy]);
  const loadDetails = useCallback(async (slug: string, force = false) => {
    const item = loadCatalog().find(value => value.slug === slug);
    if (!item) return;
    if (!force && item.detailsCached && item.chapterIds && item.sourceDates && item.summary && Date.now() - Date.parse(item.syncedAt || "") < 6 * 3600_000) return;
    if (detailLocks.current.has(slug)) return;
    detailLocks.current.add(slug); setDetailsLoading(current => [...current, slug]);
    setNetworkNotice("");
    try {
      const fresh = await refreshSeries(item, networkGuard("Refresh this story’s details?"));
      mergeCatalog([fresh]);
      setCatalog(loadCatalog());
      setNetworkNotice("");
    } catch (error) { showFailure(error); }
    finally { detailLocks.current.delete(slug); setDetailsLoading(current => current.filter(value => value !== slug)); }
  }, [showFailure]);

  const toggleStory = useCallback((slug: string, field: "liked" | "bookmarked") => {
    toggleSaved(slug, field); setSaved(savedStories());
    if (field === "bookmarked") {
      clearReleaseUpdates(slug); setUpdates(releaseUpdates());
      saveReleaseSnapshot(slug, savedStories()[slug]?.bookmarked ? loadCatalog().find(item => item.slug === slug)?.chapterIds : undefined);
      if (savedStories()[slug]?.bookmarked) void loadDetails(slug);
    }
  }, [loadDetails]);

  const updatePreferences = useCallback((change: Partial<Preferences>) => {
    const value = { ...loadPreferences(), ...change };
    savePreferences(value);
    setPreferences(value);
  }, []);

  const setStoryOptions = useCallback((slug: string, change: Partial<SavedStory>) => { updateStoryOptions(slug, change); setSaved(savedStories()); }, []);
  const reloadLocal = useCallback(() => { setCatalog(loadCatalog()); setRead(readChapters()); setSaved(savedStories()); setPreferences(loadPreferences()); }, []);
  const autoDownload = useCallback(async () => {
    const network = await NetInfo.fetch();
    if (AppState.currentState !== "active" || network.type !== "wifi" || !network.isConnected || network.isInternetReachable === false || network.details?.isConnectionExpensive) return;
    const options = savedStories(), ledger = readChapters(), releases = releaseUpdates();
    for (const item of loadCatalog()) if (options[item.slug]?.bookmarked && options[item.slug]?.autoDownload && item.detailsCached) {
      if (["running", "preparing", "queued"].includes(transferStates(item.slug)[item.slug]?.state)) continue;
      const ids = (releases[item.slug] || []).filter(id => item.chapterIds?.includes(id) && !item.localChapters?.includes(id) && !ledger[item.slug]?.[id]);
      if (ids.length) queue.enqueue(item, ids.join(","), true);
    }
  }, [queue]);

  useEffect(() => { void autoDownload().catch(showFailure); void configureReleaseChecks().catch(showFailure); }, [autoDownload, saved, showFailure]);

  const setReleaseNotifications = useCallback(async (enabled: boolean) => {
    if (notificationLock.current) return;
    notificationLock.current = true; setNotificationBusy(true);
    try {
      if (enabled && !await requestReleasePermission()) { Alert.alert("Notifications are disabled", "Allow NightShelf notifications in Android Settings to receive bookmarked release alerts."); return; }
      if (enabled) for (const item of loadCatalog()) if (savedStories()[item.slug]?.bookmarked) saveReleaseSnapshot(item.slug, item.chapterIds);
      updatePreferences({ releaseNotifications: enabled });
      await configureReleaseChecks();
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { notificationLock.current = false; setNotificationBusy(false); }
  }, [updatePreferences]);

  const sync = useCallback(async (automatic = false) => {
    const settings = loadPreferences();
    if (syncLock.current || queue.isBusy() || (automatic && (!settings.autoSync || Date.now() - lastAttempt.current < settings.interval * 60_000))) return;
    syncLock.current = true;
    lastAttempt.current = Date.now();
    setSyncing(true);
    setNetworkNotice("");
    if (!automatic) setRefreshing(true);
    try {
      const fresh = await syncCatalog(() => {}, networkGuard("Refresh story summaries, ratings and chapter lists?", automatic), !automatic);
      setCatalog(fresh);
      await notifyReleases(fresh);
      await autoDownload();
      setNotice("");
    } catch (error) {
      setCatalog(loadCatalog());
      showFailure(error);
      if (error instanceof NetworkPaused) lastAttempt.current = 0;
    } finally {
      syncLock.current = false;
      setSyncing(false);
      setRefreshing(false);
      setPreferences(loadPreferences());
      setUpdates(releaseUpdates());
    }
  }, [showFailure, queue, autoDownload]);

  const startDownload = useCallback((item: Series, selection: string) => {
    if (deleteLock.current) { setNotice("Wait for deletion to finish before adding a download."); return false; }
    setNetworkNotice("");
    return queue.enqueue(item, selection);
  }, [queue]);

  useEffect(() => {
    let mounted = true;
    void NetInfo.fetch().then(state => {
      if (!mounted) return;
      const access = connectionAccess(state, preferences.mobileData, false);
      setNetworkNotice(current => current ? connectionPauseMessage(access) : "");
      if (access === "allow") { if (!syncLock.current) lastAttempt.current = 0; if (AppState.currentState === "active") { queue.resumeWaiting(); void sync(true); } }
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
      if (before !== after) setCatalog(loadCatalog());
    };
    poll(); const timer = setInterval(poll, 1000);
    return () => clearInterval(timer);
  }, [queue]);

  useEffect(() => {
    const states = transferStates();
    for (const job of [...queue.jobs]) {
      const state = states[job.series.slug];
      if (state?.state === "done") void queue.cancel(job.series.slug);
      else if (job.native && state?.state === "running" && !state.active && state.hasPlan && AppState.currentState === "active") void backgroundTransfers?.resume(job.series.slug).catch(showFailure);
      else if (job.native) queue.reconcileNative(states);
      else if (["running", "preparing", "queued"].includes(state?.state)) queue.resume(job.series.slug);
    }
    void configureReleaseChecks().catch(() => setNotice("Background release checks are unavailable. Releases will still be checked when the app is open."));
    const timer = setInterval(() => { if (AppState.currentState === "active") void sync(true); }, 60_000);
    const app = AppState.addEventListener("change", state => {
      if (state === "active") { setNetworkNotice(""); setCatalog(loadCatalog()); setRead(readChapters()); setUpdates(releaseUpdates()); setPreferences(loadPreferences()); queue.resumeWaiting(); queue.pump(); void sync(true); }
      else if (!backgroundTransfers) queue.suspend();
    });
    const unsubscribe = NetInfo.addEventListener(state => {
      const next = connectionLabel(state);
      setConnection(current => current.label === next.label ? current : next);
      const access = connectionAccess(state, loadPreferences().mobileData, false);
      if (access === "allow" && lastAccess.current !== "allow" && !syncLock.current) lastAttempt.current = 0;
      lastAccess.current = access;
      setNetworkNotice(current => current ? connectionPauseMessage(access) : "");
      if (state.isConnected && AppState.currentState === "active") { if (access === "allow") queue.resumeWaiting(); void sync(true); }
    });
    return () => { clearInterval(timer); app.remove(); unsubscribe(); };
  }, [sync, queue, showFailure]);

  return { connection, setStoryOptions, reloadLocal, sourceSessionRevision, sourceSessionChanged, catalog, saved, read, updates, completeChapter, setReadStatus, leaveChapter, detailsLoading, notificationBusy, deleting, setReleaseNotifications, toggleStory, loadDetails, removeDownloads, search, browse, preferences, updatePreferences, syncing, refreshing, downloads, downloadBusy, pauseDownload, resumeDownload, cancelDownload, notice: networkNotice || notice, dismissNotice: () => { setNotice(""); setNetworkNotice(""); }, sync, startDownload };
}
const AppContext = createContext<ReturnType<typeof useAppState> | null>(null);
export function AppProvider({ children }: { children: ReactNode }) { return <AppContext.Provider value={useAppState()}>{children}</AppContext.Provider>; }
export function useShelf() { const value = useContext(AppContext); if (!value) throw new Error("AppProvider is missing"); return value; }

