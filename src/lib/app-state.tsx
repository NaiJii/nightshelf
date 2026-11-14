import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Alert, AppState } from "react-native";
import { usePathname } from "expo-router";
import NetInfo from "@react-native-community/netinfo";
import { chapterListCached, ContentMode, Series, selectChapters } from "./parser";
import { browseCatalog, enrichCatalogIds, downloadChapters, repairSavedPanel, refreshSeries, searchCatalog, syncCatalog } from "./scraper";
import type { BrowseCursor, BrowseOptions } from "./scraper";
import { chapterIntact, deleteChapters, catalogMetadata, loadCatalogAsync, loadPreferences, Preferences, savedStories, mergeCatalog, savePreferences, readChapters, markChapterRead, localChapters, releaseUpdates, setChaptersRead, loadDownloads, saveDownloads, loadDownloadStops, saveDownloadStop } from "./storage";
import { networkGuard, NetworkPaused } from "./network";
import { automaticReleaseIds } from "./release-policy";
import { connectionAccess, connectionPauseMessage, connectionLabel } from "./network-policy";
import { configureReleaseChecks, notifyReleases, requestReleasePermission, releasePermissionGranted } from "./releases";
import { DownloadQueue, restoredDownloads } from "./download-queue";
import { downloadConflicts } from "./download-display";
import { beginReaderTransfer, cancelReaderTransfer, readerTransfers } from "./reader-transfers";
import { throwIfAborted, withAbort, withLinkedAbort, withForeground } from "./request-control";
import { backgroundTransfers, DownloadPaused, transferStates, stopTransfer } from "./background-downloads";
import { freeBytes, libraryBytesAsync, updateStoryOptions, updateStoriesOptions, cleanupReadDownloads } from "./library-tools";
import { readDeletionDue } from "./read-retention";
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
  const [pendingNotifications, setPendingNotifications] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState(false);
  const [sourceSessionRevision, setSourceSessionRevision] = useState(0);
  const sourceSessionChanged = useCallback(() => { setNotice(current => current.includes("needs browser verification") ? "" : current); setSourceSessionRevision(value => value + 1); }, []);
  const detailLocks = useRef(new Map<string, AbortController>());
  const cancelDetails = useCallback((slug?: string) => {
    for (const [key, controller] of detailLocks.current) if (!slug || key === slug) {
      controller.abort(); detailLocks.current.delete(key);
    }
    setDetailsLoading(current => slug ? current.filter(key => key !== slug) : []);
  }, []);
  useEffect(() => () => { for (const controller of detailLocks.current.values()) controller.abort(); }, []);
  const notificationLock = useRef(false);
  const notificationIntents = useRef(new Map<string, number>()), permissionRevision = useRef(0);
  const notificationTargets = useRef(new Map<string, boolean>());
  const permissionKnown = useRef<boolean | undefined>(undefined);
  const globalNotificationIntent = useRef(0);
  const notificationRequest = useRef<{ version: number; promise: Promise<boolean> } | null>(null);
  const clearPendingNotifications = useCallback((slugs: string[]) => {
    let changed = false;
    for (const slug of slugs) if (notificationTargets.current.delete(slug)) changed = true;
    if (changed) setPendingNotifications(Object.fromEntries(notificationTargets.current));
  }, []);
  const invalidateNotificationIntents = useCallback((slugs: string[]) => {
    for (const slug of slugs) notificationIntents.current.set(slug, (notificationIntents.current.get(slug) || 0) + 1);
    clearPendingNotifications(slugs);
  }, [clearPendingNotifications]);
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

  const readerFetches = useRef(new Map<string, { chapter: string; page?: number; signal: AbortSignal; abort: () => void; promise: Promise<void> }>());
  const stoppingReaders = useRef(new Set<string>());
  const downloadIntents = useRef(new Map<string, number>());
  const lastQueueSave = useRef({ at: 0, state: "" });
  const [queue] = useState(() => new DownloadQueue(restoredDownloads(loadDownloads()), async (job, signal, progress, plan, handoff) => {
    try {
      const item = (await loadCatalogAsync(signal)).find(item => item.slug === job.series.slug) || job.series;
      const current = transferStates(item.slug)[item.slug];
      const access = networkGuard("Save these chapters for offline reading?", job.automatic, Boolean(backgroundTransfers));
      let lastStorageCheck = -Infinity;
      const guard = async () => {
        if (backgroundTransfers && transferStates(item.slug)[item.slug]?.state === "paused") throw new DownloadPaused("Paused from notification");
        if (job.autoBookmark) {
          const network = await NetInfo.fetch();
          if (network.type !== "wifi" || network.details?.isConnectionExpensive || !network.isConnected) throw new NetworkPaused("Automatic downloads wait for unmetered Wi-Fi.");
          if (freeBytes() < 64 * 1024 ** 2) throw new NetworkPaused("Automatic download storage limit reached.");
          if (Date.now() - lastStorageCheck >= 10000) {
            if (await libraryBytesAsync(signal, true) >= loadPreferences().autoDownloadLimitMB * 1024 ** 2) throw new NetworkPaused("Automatic download storage limit reached.");
            lastStorageCheck = Date.now();
          }
        }
        await access();
      };
      await access();
      backgroundTransfers?.setNetworkPolicy(loadPreferences().mobileData === "never");
      if (backgroundTransfers && AppState.currentState === "active") await requestReleasePermission(false);
      throwIfAborted(signal);
      if (backgroundTransfers && current?.hasPlan) {
        if (job.autoBookmark) { const network = await NetInfo.fetch(); if (network.type !== "wifi" || network.details?.isConnectionExpensive) throw new NetworkPaused("Automatic downloads wait for unmetered Wi-Fi."); }
        throwIfAborted(signal);
        if (!current.active) await backgroundTransfers.resume(item.slug);
        return "native" as const;
      }
      if (backgroundTransfers) await backgroundTransfers.begin(item.slug, item.title);
      await downloadChapters(item, job.selection, progress, guard, signal, job.chapters, plan, () => void refreshCatalog(), job.autoBookmark, Boolean(backgroundTransfers), true, handoff);
      if (backgroundTransfers) return "native" as const;
    } finally { if (signal.aborted) await stopTransfer(job.series.slug); await backgroundTransfers?.endPreparation(job.series.slug).catch(() => {}); void refreshCatalog(); setPreferences(loadPreferences()); }
  }, jobs => {
    const state = jobs.map(job => `${job.series.slug}:${job.status}:${Boolean(job.native)}:${Boolean(job.nativePending)}:${Boolean(job.readerHeld)}:${job.chapters?.join(",")}`).join("|");
    if (state !== lastQueueSave.current.state || Date.now() - lastQueueSave.current.at >= 1000) {
      saveDownloads(jobs); backgroundTransfers?.syncQueue(JSON.stringify(jobs.map(job => ({ id: job.series.slug, native: Boolean(job.native), progress: job.progress }))));
      lastQueueSave.current = { at: Date.now(), state };
    }
  }, slug => deleteChapters(slug, [], true), () => AppState.currentState === "active" || Boolean(backgroundTransfers?.serviceRunning()), loadDownloads, {
    load: loadDownloadStops,
    save: (slug, stopped) => { try { saveDownloadStop(slug, stopped); } catch (error) { showFailure(error); } },
    pauseNative: async slug => { try { await backgroundTransfers?.pause(slug); } catch (error) { showFailure(error); } },
  }));
  const queuedDownloadBusy = useCallback((slug?: string) => queue.isBusy(slug) || queue.jobs.some(job => job.readerHeld && (!slug || job.series.slug === slug)) || Object.entries(transferStates(slug)).some(([id, value]) => (value.active || (value.hasPlan && ["queued", "waiting", "running", "preparing"].includes(value.state))) && (!slug || id === slug)), [queue]);
  const downloadBusy = useCallback((slug?: string) => (slug ? readerFetches.current.has(slug) : readerFetches.current.size > 0) || queuedDownloadBusy(slug), [queuedDownloadBusy]);
  const pauseDownload = useCallback((slug: string) => { downloadIntents.current.set(slug, (downloadIntents.current.get(slug) || 0) + 1); queue.pause(slug); readerFetches.current.get(slug)?.abort(); cancelReaderTransfer(slug); const origin = noticeScope.current; void backgroundTransfers?.pause(slug).catch(error => showFailure(error, origin)); }, [queue, showFailure]);
  const moveDownload = useCallback((slug: string, direction: -1 | 1) => queue.move(slug, direction), [queue]);
  const resumeDownload = useCallback((slug: string) => {
    if (deleteLock.current || stoppingReaders.current.has(slug) || readerFetches.current.has(slug)) { setNotice("Wait for the reader download or deletion to finish before resuming downloads."); return; }
    const origin = noticeScope.current, intent = (downloadIntents.current.get(slug) || 0) + 1;
    downloadIntents.current.set(slug, intent);
    void stopTransfer(slug).then(() => { if (downloadIntents.current.get(slug) === intent && !stoppingReaders.current.has(slug)) queue.resume(slug); }).catch(error => { if (downloadIntents.current.get(slug) === intent) showFailure(error, origin); });
  }, [queue, showFailure]);
  const cancelDownload = useCallback(async (slug: string, deleteFiles = false) => {
    if (stoppingReaders.current.has(slug)) return;
    downloadIntents.current.set(slug, (downloadIntents.current.get(slug) || 0) + 1);
    stoppingReaders.current.add(slug); queue.stopReaderPrefetch(slug);
    const origin = noticeScope.current;
    const pending = readerFetches.current.get(slug);
    pending?.abort(); cancelReaderTransfer(slug);
    try {
      if (queue.jobs.find(job => job.series.slug === slug)?.autoBookmark) {
        try { updateStoryOptions(slug, { autoDownload: false }); setSaved(savedStories()); }
        catch (error) { showFailure(error, origin); } // A metadata failure must not prevent stopping the writer.
      }
      const closeWriters = async () => { await pending?.promise.catch(() => {}); await stopTransfer(slug); await backgroundTransfers?.discard(slug); };
      if (queue.jobs.some(job => job.series.slug === slug)) await queue.cancel(slug, deleteFiles, closeWriters);
      else { await closeWriters(); if (deleteFiles) deleteChapters(slug, [], true); }
    } catch (error) { showFailure(error, origin); }
    finally { stoppingReaders.current.delete(slug); void refreshCatalog(); }
  }, [queue, refreshCatalog, showFailure]);

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
    const reader = readerFetches.current.get(item.slug);
    const native = transferStates(item.slug)[item.slug];
    const job = queue.jobs.find(job => job.series.slug === item.slug);
    if ((reader && (all || chapters.includes(reader.chapter))) || (native?.active && (!job || downloadConflicts({...job,native:true}, chapters, all))) || (job && downloadConflicts(job, chapters, all))) { setNotice("These chapters are part of a pending download. Cancel that download before deleting them."); return false; }
    deleteLock.current = true;
    setDeleting(true);
    await new Promise(resolve => setTimeout(resolve, 30));
    try { deleteChapters(item.slug, chapters, all); void refreshCatalog(); return true; }
    catch (error) { void refreshCatalog(); Alert.alert("Could not delete chapters", error instanceof Error ? error.message : String(error)); return false; }
    finally { deleteLock.current = false; setDeleting(false); }
  }, [queue, refreshCatalog]);
  const completeChapter = useCallback((slug: string, chapter: string) => { markChapterRead(slug, chapter); setRead(readChapters()); }, []);
  const setReadStatus = useCallback((slug: string, chapters: string[], value: boolean) => { setChaptersRead(slug, chapters, value); setRead(readChapters()); }, []);
  const leaveChapter = useCallback((slug: string, chapter: string) => {
    const pending = readerFetches.current.get(slug);
    if (pending?.chapter === chapter) return;
    if (!loadPreferences().deleteAfterReading || !readDeletionDue(readChapters()[slug]?.[chapter]) || !localChapters(slug).includes(chapter) || queue.jobs.some(job => job.series.slug === slug)) return;
    try { deleteChapters(slug, [chapter]); void refreshCatalog(); }
    catch { setNotice("The read chapter could not be deleted. You can remove it in Manage downloads."); }
  }, [queue, refreshCatalog]);
  const autoDownload = useCallback(async () => {
    const network = await NetInfo.fetch();
    if (deleteLock.current || AppState.currentState !== "active" || network.type !== "wifi" || !network.isConnected || network.isInternetReachable === false || network.details?.isConnectionExpensive) return;
    const items = await loadCatalogAsync();
    if (deleteLock.current || AppState.currentState !== "active") return;
    const options = savedStories(), ledger = readChapters(), releases = releaseUpdates();
    for (const item of items) if (!readerFetches.current.has(item.slug) && options[item.slug]?.bookmarked && options[item.slug]?.autoDownload && item.detailsCached) {
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
    const controller = new AbortController();
    detailLocks.current.set(slug, controller); setDetailsLoading(current => [...current, slug]);
    setDetailsErrors(current => { const next = { ...current }; delete next[slug]; return next; });
    try {
      const fresh = await withForeground(() => withAbort(() => refreshSeries(item, networkGuard("Refresh this story’s details?", !force), controller.signal, force || !cached), controller.signal));
      throwIfAborted(controller.signal);
      mergeCatalog([fresh]);
      await refreshCatalog();
      await notifyReleases([fresh]).catch(error => showFailure(error, origin)); setUpdates(releaseUpdates());
      await autoDownload().catch(error => showFailure(error, origin));
    } catch (error) {
      if (!controller.signal.aborted) setDetailsErrors(current => ({ ...current, [slug]: error instanceof Error ? error.message : String(error) }));
    }
    finally { if (detailLocks.current.get(slug) === controller) { detailLocks.current.delete(slug); setDetailsLoading(current => current.filter(value => value !== slug)); } }
  }, [autoDownload, showFailure, refreshCatalog]);

  const fetchReaderChapter = useCallback(function fetchChapter(slug: string, chapter: string, automatic: boolean, signal: AbortSignal, progress: (message: string, fraction: number) => void, repairPage?: number): Promise<void> {
    const item = catalogMetadata().find(item => item.slug === slug);
    if (!item || !item.chapterIds?.includes(chapter)) return Promise.reject(new Error("This public chapter is unavailable. Refresh the story’s chapters first."));
    if (stoppingReaders.current.has(slug)) return Promise.reject(new Error("Wait for cancellation to finish."));
    const checkPrefetch = () => { if (automatic && !queue.canPrefetchReader(slug)) throw new NetworkPaused("Download paused or cancelled. Resume it explicitly to continue."); };
    if (deleteLock.current) return Promise.reject(new Error("Wait for deletion to finish."));
    const pending = readerFetches.current.get(slug);
    if (pending?.signal.aborted) return withAbort(async () => {
      await pending.promise.catch(() => {});
      throwIfAborted(signal);
      return fetchChapter(slug, chapter, automatic, signal, progress, repairPage);
    }, signal);
    if (pending) return pending.chapter === chapter && pending.page === repairPage ? withAbort(() => pending.promise, signal) : Promise.reject(new Error("Another chapter is downloading in this reader."));
    const callerSignal = signal, controller = new AbortController();
    const abort = () => controller.abort(); callerSignal.addEventListener("abort", abort, {once:true});
    if (callerSignal.aborted) controller.abort(); signal = controller.signal;
    let transfer: ReturnType<typeof beginReaderTransfer> | undefined;
    const report = progress; progress = (message, fraction) => { report(message, fraction); transfer?.progress(message, fraction); };
    const access = networkGuard(`Download chapter ${chapter} of ${item.title} using this connection?`, false);
    let lastStorageCheck = 0;
    const guard = async () => {
      throwIfAborted(signal);
      checkPrefetch();
      if (automatic) {
        if (AppState.currentState !== "active") throw new NetworkPaused("Reader download paused.");
        const network = await NetInfo.fetch();
        if (network.type !== "wifi" || !network.isConnected || network.isInternetReachable === false || network.details?.isConnectionExpensive) throw new NetworkPaused("Next chapter waits for unmetered Wi-Fi.");
        if (Date.now() - lastStorageCheck > 10000) {
          if (await libraryBytesAsync(signal, true) >= loadPreferences().autoDownloadLimitMB * 1024 ** 2) throw new NetworkPaused("Automatic download storage limit reached.");
          lastStorageCheck = Date.now();
        }
      }
      if (freeBytes() < 32 * 1024 ** 2) throw new NetworkPaused("Phone storage is almost full.");
      if (!automatic) await access();
      throwIfAborted(signal);
    };
    const run = async () => {
      if (repairPage !== undefined) {
        if (queuedDownloadBusy(slug)) throw new Error("Pause this story’s queued download before repairing a panel.");
        progress("Repairing panel…",0);
        await repairSavedPanel(item,chapter,repairPage,guard,signal);
        await refreshCatalog(); return;
      }
      if (chapterIntact(slug, chapter)) return;
      const ownsChapter = () => {
        const job = queue.jobs.find(value => value.series.slug === slug);
        return job && (job.chapters || selectChapters(item.chapterIds!.map(id => ({id,url:""})), job.selection).map(value => value.id)).includes(chapter) && (["queued", "downloading", "waiting", "cancelling"].includes(job.status) || transferStates(slug)[slug]?.active) ? job : undefined;
      };
      let job = ownsChapter();
      while (job && !chapterIntact(slug, chapter)) {
        checkPrefetch();
        throwIfAborted(signal); progress("Waiting for the queued chapter…", job.progress);
        await withAbort(() => new Promise(resolve => setTimeout(resolve, 500)), signal);
        job = ownsChapter();
      }
      throwIfAborted(signal);
      checkPrefetch();
      if (!chapterIntact(slug, chapter)) await downloadChapters(item, chapter, progress, guard, signal, [chapter], undefined, () => void refreshCatalog(), false, false, false);
      await refreshCatalog();
    };
    const readNow = async () => {
      await guard();
      await requestReleasePermission(false).catch(() => false);
      throwIfAborted(signal);
      transfer = beginReaderTransfer(item, chapter, () => controller.abort());
      progress("Prioritizing chapter…", 0);
      const release = await queue.holdForReader(stopTransfer);
      try { throwIfAborted(signal); await run(); }
      finally { release(); }
    };
    const promise = Promise.resolve().then(() => automatic ? run() : withForeground(repairPage === undefined ? readNow : run)).finally(() => { transfer?.finish(); callerSignal.removeEventListener("abort", abort); readerFetches.current.delete(slug); void refreshCatalog(); });
    readerFetches.current.set(slug, { chapter, page:repairPage, signal, abort, promise });
    return promise;
  }, [queue, refreshCatalog, queuedDownloadBusy]);

  const toggleStory = useCallback((slug: string, field: "liked" | "bookmarked") => {
    if (field === "bookmarked") invalidateNotificationIntents([slug]);
    try {
      setSaved(updateStoryOptions(slug, { [field]: !savedStories()[slug]?.[field] }));
      if (field === "bookmarked") setUpdates(releaseUpdates());
    } catch (error) { showFailure(error); }
  }, [invalidateNotificationIntents, showFailure]);

  const providerViews = useRef<Partial<Record<string, Partial<Preferences>>>>({});
  const updatePreferences = useCallback((change: Partial<Preferences>) => {
    const previous = loadPreferences();
    if (change.source && change.source !== previous.source) {
      const { sort, period, contentMode, hideDownloaded, hideLiked, hideBookmarked } = previous;
      providerViews.current[previous.source || "asura"] = { sort, period, contentMode, hideDownloaded, hideLiked, hideBookmarked };
    }
    const value = { ...previous, ...(change.source && change.source !== previous.source ? providerViews.current[change.source] : {}), ...change };
    if ((["source", "webtoonLanguage", "webtoonCollection"] as const).some(key => value[key] !== previous[key])) {
      cancelDetails(); providerRequests.current.abort(); providerRequests.current = new AbortController(); lastAttempt.current = 0;
    }
    savePreferences(value);
    if (previous.mobileData !== value.mobileData) backgroundTransfers?.setNetworkPolicy(value.mobileData === "never");
    setPreferences(value);
  }, [cancelDetails]);

  const rememberSearch = useCallback((provider: string, query: string | null) => {
    const history = loadPreferences().searchHistory || {};
    const term = query?.trim().slice(0, 100);
    if (term && (term.length < 2 || history[provider]?.[0] === term)) return;
    if (!term && !history[provider]?.length) return;
    updatePreferences({searchHistory: {...history, [provider]: term ? [term, ...(history[provider] || []).filter(value => value.toLowerCase() !== term.toLowerCase())].slice(0,8) : []}});
  }, [updatePreferences]);

  const setStoryOptions = useCallback((slug: string, change: Partial<SavedStory>) => {
    if (change.bookmarked === false || change.notifyReleases === false) invalidateNotificationIntents([slug]);
    try {
      setSaved(updateStoryOptions(slug, change));
      if (change.autoDownload === true) queue.allowReaderPrefetch(slug);
      if (change.bookmarked !== undefined || change.autoDownload === true || change.notifyReleases === true) setUpdates(releaseUpdates());
      return true;
    } catch (error) { showFailure(error); return false; }
  }, [invalidateNotificationIntents, showFailure, queue]);
  const setStoriesOptions = useCallback((slugs: string[], change: Partial<SavedStory>) => {
    if (change.bookmarked === false || change.notifyReleases === false) invalidateNotificationIntents(slugs);
    try {
      setSaved(updateStoriesOptions(slugs, change));
      if (change.bookmarked !== undefined || change.autoDownload === true || change.notifyReleases === true) setUpdates(releaseUpdates());
    } catch (error) { showFailure(error); }
  }, [invalidateNotificationIntents, showFailure]);
  const toggleAutoDownload = useCallback((slug: string) => {
    const story = savedStories()[slug];
    const enabled = !Boolean(story?.bookmarked && story.autoDownload);
    return setStoryOptions(slug, { autoDownload: enabled }) ? enabled : false;
  }, [setStoryOptions]);
  const reloadLocal = useCallback(() => { void refreshCatalog(); setRead(readChapters()); setSaved(savedStories()); setPreferences(loadPreferences()); }, [refreshCatalog]);

  const automaticStories = useMemo(() => Object.entries(saved).filter(([, story]) => story.bookmarked && story.autoDownload).map(([slug]) => slug).sort().join("\n"), [saved]);
  const backgroundNeeded = preferences.deleteAfterReading || Object.values(saved).some(story => story.bookmarked && (story.autoDownload || (preferences.releaseNotifications && story.notifyReleases !== false)));
  useEffect(() => { void autoDownload().catch(showFailure); }, [autoDownload, automaticStories, showFailure]);
  useEffect(() => {
    const origin = noticeScope.current;
    void configureReleaseChecks().catch(() => { if (origin === noticeScope.current) setNotice("Background checks are unavailable. Releases will still be checked while the app is open."); });
  }, [backgroundNeeded, preferences.releaseCheckInterval, preferences.releaseNotifications]);

  const setReleaseNotifications = useCallback(async function enableReleaseNotifications(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      globalNotificationIntent.current++;
      invalidateNotificationIntents([...notificationTargets.current.keys()]);
      try { updatePreferences({ releaseNotifications: false }); return true; }
      catch (error) { showFailure(error); return false; }
    }
    if ((loadPreferences().releaseNotifications && permissionKnown.current !== false) || permissionKnown.current === true) {
      try { if (!loadPreferences().releaseNotifications) updatePreferences({ releaseNotifications: true }); return true; }
      catch (error) { showFailure(error); return false; }
    }
    const pending = notificationRequest.current;
    if (pending) return pending.version === globalNotificationIntent.current ? pending.promise : pending.promise.then(() => enableReleaseNotifications(true));
    const version = ++globalNotificationIntent.current;
    const origin = noticeScope.current;
    permissionRevision.current++;
    notificationLock.current = true; setNotificationBusy(true);
    const promise = (async () => {
      try {
        const allowed = await requestReleasePermission();
        permissionKnown.current = allowed;
        if (version !== globalNotificationIntent.current) return false;
        if (!allowed) { updatePreferences({ releaseNotifications: false }); Alert.alert("Notifications are disabled", "Allow NightShelf notifications in Android Settings to receive release alerts."); return false; }
        updatePreferences({ releaseNotifications: true });
        return true;
      } catch (error) { if (version === globalNotificationIntent.current && origin === noticeScope.current) setNotice(error instanceof Error ? error.message : String(error)); return false; }
      finally { permissionRevision.current++; notificationLock.current = false; notificationRequest.current = null; setNotificationBusy(false); }
    })();
    notificationRequest.current = { version, promise };
    return promise;
  }, [updatePreferences, invalidateNotificationIntents, showFailure]);

  const setStoryNotifications = useCallback(async (slug: string, enabled: boolean) => {
    const version = (notificationIntents.current.get(slug) || 0) + 1;
    notificationIntents.current.set(slug,version);
    if (!enabled || (loadPreferences().releaseNotifications && permissionKnown.current !== false)) {
      clearPendingNotifications([slug]);
      setStoryOptions(slug, { notifyReleases: enabled });
      return;
    }
    notificationTargets.current.set(slug, true);
    setPendingNotifications(Object.fromEntries(notificationTargets.current));
    try {
      if (!await setReleaseNotifications(true) || notificationIntents.current.get(slug) !== version) return;
      setStoryOptions(slug, { notifyReleases: true });
    } finally { if (notificationIntents.current.get(slug) === version) clearPendingNotifications([slug]); }
  }, [setReleaseNotifications, setStoryOptions, clearPendingNotifications]);
  const toggleStoryNotifications = useCallback((slug: string) => {
    const story = savedStories()[slug];
    const enabled = notificationTargets.current.get(slug) ?? Boolean(story?.bookmarked && loadPreferences().releaseNotifications && story.notifyReleases !== false);
    return setStoryNotifications(slug, !enabled);
  }, [setStoryNotifications]);

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
      await notifyReleases(fresh).catch(error => warnings.push(error instanceof Error ? error.message : String(error)));
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
    if (deleteLock.current || stoppingReaders.current.has(item.slug) || readerFetches.current.has(item.slug)) { setNotice("Wait for the reader’s download or deletion to finish before adding another download for this story."); return false; }
    setNetworkNotice("");
    const added = queue.enqueue(item, selection);
    if (added) downloadIntents.current.set(item.slug, (downloadIntents.current.get(item.slug) || 0) + 1);
    return added;
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
      const before = queue.jobs.filter(job => job.native).map(job => `${job.series.slug}:${job.completedChapters ?? job.currentChapter ?? ""}:${job.status}`).join("|");
      queue.reconcileNative(transferStates());
      const after = queue.jobs.filter(job => job.native).map(job => `${job.series.slug}:${job.completedChapters ?? job.currentChapter ?? ""}:${job.status}`).join("|");
      if (before !== after) void refreshCatalog();
    };
    poll(); const timer = setInterval(() => { poll(); queue.pump(); }, 1000);
    return () => clearInterval(timer);
  }, [queue, refreshCatalog]);

  useEffect(() => {
    const states = transferStates();
    const recovery = setTimeout(() => { for (const job of [...queue.jobs]) if (job.status === "cancelling") void cancelDownload(job.series.slug, Boolean(job.cancelDeleteFiles)).catch(showFailure); }, 0);
    queue.reconcileNative(states);
    queue.resumeWaiting();
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

  const cleanupPath = useRef(pathname), cleanupRunning = useRef(false);
  useEffect(() => { cleanupPath.current = pathname; }, [pathname]);
  const cleanupExpired = useCallback(async () => {
    if (cleanupRunning.current || AppState.currentState !== "active" || !loadPreferences().deleteAfterReading) return;
    cleanupRunning.current = true;
    try {
      const removed = await cleanupReadDownloads(slug => AppState.currentState !== "active" || deleteLock.current || cleanupPath.current.startsWith(`/reader/${slug}/`) || readerFetches.current.has(slug) || queue.jobs.some(job => job.series.slug === slug) || Boolean(transferStates(slug)[slug]?.active || transferStates(slug)[slug]?.hasPlan));
      if (removed) void refreshCatalog();
    } finally { cleanupRunning.current = false; }
  }, [queue, refreshCatalog]);
  useEffect(() => {
    void cleanupExpired();
    const timer = setInterval(() => { void cleanupExpired(); }, 5 * 60_000);
    const listener = AppState.addEventListener("change", state => { if (state === "active") void cleanupExpired(); });
    return () => { clearInterval(timer); listener.remove(); };
  }, [cleanupExpired, preferences.deleteAfterReading]);
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const version = ++permissionRevision.current;
      try {
        const allowed = await releasePermissionGranted();
        if (mounted && version === permissionRevision.current && !notificationLock.current) {
          permissionKnown.current = allowed;
          if (!allowed && loadPreferences().releaseNotifications) updatePreferences({releaseNotifications:false});
        }
      } catch { /* A failed permission query must not change the user's settings. */ }
    };
    void check();
    const listener = AppState.addEventListener("change", state => { if (state === "active") void check(); });
    return () => { mounted = false; listener.remove(); };
  }, [updatePreferences]);

  return { rememberSearch, fetchReaderChapter, catalogReady, connection, setStoryNotifications, toggleStoryNotifications, toggleAutoDownload, pendingNotifications, setStoryOptions, setStoriesOptions, reloadLocal, sourceSessionRevision, sourceSessionChanged, catalog, saved, read, updates, completeChapter, setReadStatus, leaveChapter, detailsLoading, detailsErrors, notificationBusy, deleting, setReleaseNotifications, toggleStory, loadDetails, cancelDetails, removeDownloads, search, browse, preferences, updatePreferences, syncing, refreshing, downloadQueue: queue, downloadBusy, moveDownload, pauseDownload, resumeDownload, cancelDownload, notice: networkNotice || notice, dismissNotice: () => { setNotice(""); setNetworkNotice(""); }, sync, startDownload };
}
const AppContext = createContext<ReturnType<typeof useAppState> | null>(null);
export function AppProvider({ children }: { children: ReactNode }) { return <AppContext.Provider value={useAppState()}>{children}</AppContext.Provider>; }
export function useShelf() { const value = useContext(AppContext); if (!value) throw new Error("AppProvider is missing"); return value; }
export function useDownloads(statusOnly = false) {
  const { downloadQueue } = useShelf(); const snapshot = statusOnly ? downloadQueue.getStatusSnapshot : downloadQueue.getSnapshot;
  const queued = useSyncExternalStore(downloadQueue.subscribe, snapshot, snapshot);
  const readerSnapshot = statusOnly ? readerTransfers.getStatusSnapshot : readerTransfers.getSnapshot;
  const reader = useSyncExternalStore(readerTransfers.subscribe, readerSnapshot, readerSnapshot);
  return useMemo(() => reader.length ? [...reader, ...queued.filter(job => !reader.some(value => value.series.slug === job.series.slug))] : queued, [queued, reader]);
}
