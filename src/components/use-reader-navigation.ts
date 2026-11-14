import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useDownloads, useShelf } from "../lib/app-state";
import { chapterIntact, chapterReadState } from "../lib/storage";
import { queuedChapters } from "../lib/download-display";
import { useSourceRetry } from "./use-source-retry";
import { useActionSheet } from "./action-sheet";
import { needsVerification } from "../lib/provider-errors";
import { sourceOf } from "../lib/parser";

export function useReaderNavigation(slug: string, title: string | undefined, next: string | undefined, transition?: string, push = false, onOpen?: (chapter: string, previous: boolean) => void, afterNext?: string) {
  const { preferences, fetchReaderChapter, connection, read, catalog } = useShelf();
  const downloads = useDownloads(true);
  const canRead = (target: string) => chapterIntact(slug, target) || chapterReadState(slug, target).files.length > 0 || downloads.some(job => job.series.slug === slug && ["queued", "downloading", "waiting"].includes(job.status) && queuedChapters(job).includes(target));
  const showSheet = useActionSheet();
  const [status, setStatus] = useState(transition ? `Chapter ${transition}` : "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [verification, setVerification] = useState<{ target: string; automatic: boolean; previous: boolean } | null>(null);
  const active = useRef(false), navigating = useRef(false);
  const generation = useRef(0);
  const request = useRef<{ chapter: string; automatic: boolean; controller: AbortController; promise: Promise<void> } | null>(null);
  const attempted = useRef("");
  const retryPrefetchAt = useRef(0);
  useEffect(() => {
    if (retryPrefetchAt.current) { attempted.current = ""; retryPrefetchAt.current = 0; }
  }, [connection?.label]);
  const ahead = useRef([next, afterNext]);
  useEffect(() => { ahead.current = [next, afterNext]; }, [next, afterNext]);
  useEffect(() => {
    if (!transition) return;
    const timer = setTimeout(() => setStatus(current => current === `Chapter ${transition}` ? "" : current), 1600);
    return () => clearTimeout(timer);
  }, [transition]);
  useFocusEffect(useCallback(() => {
    active.current = true;
    generation.current++;
    if (!navigating.current) setBusy(false);
    if (retryPrefetchAt.current) { attempted.current = ""; retryPrefetchAt.current = 0; }
    const subscription = AppState.addEventListener("change", state => {
      if (state !== "active") {
        generation.current++;
        if (navigating.current) setStatus("Download paused · tap the chapter to retry.");
        navigating.current = false; setBusy(false); request.current?.controller.abort();
      }
      else if (retryPrefetchAt.current) { attempted.current = ""; retryPrefetchAt.current = 0; }
    });
    return () => { generation.current++; active.current = false; navigating.current = false; setBusy(false); request.current?.controller.abort(); subscription.remove(); };
  }, []));

  function fetchChapter(target: string, automatic: boolean) {
    if (request.current?.chapter === target && !request.current.controller.signal.aborted && (automatic || !request.current.automatic)) return request.current.promise;
    const previous = request.current;
    previous?.controller.abort();
    const controller = new AbortController();
    const version = generation.current;
    const promise = Promise.resolve(previous?.promise).catch(() => {}).then(() => {
      if (controller.signal.aborted) throw new Error("Cancelled");
      return fetchReaderChapter(slug, target, automatic, controller.signal, (message, fraction) => {
        if (active.current && version === generation.current && navigating.current) { setProgress(Math.max(0,Math.min(1,fraction))); setStatus(`${message}${fraction > 0 ? ` · ${Math.round(fraction * 100)}%` : ""}`); }
      });
    }).finally(() => { if (request.current?.controller === controller) request.current = null; });
    request.current = { chapter: target, automatic, controller, promise };
    return promise;
  }

  async function open(target: string, automatic: boolean, previous: boolean) {
    if (!active.current || navigating.current || AppState.currentState !== "active") return;
    navigating.current = true;
    const version = generation.current;
    setVerification(null);
    setBusy(true);
    setProgress(0);
    try {
      if (!canRead(target)) {
        setStatus(`Preparing chapter ${target}…`);
        await fetchChapter(target, automatic);
      }
      if (!active.current || version !== generation.current || AppState.currentState !== "active") return;
      if (!canRead(target)) throw new Error(`Chapter download is incomplete. ${push ? "Choose Read now to retry." : "Tap next or previous to retry."}`);
      setStatus("");
      if (onOpen) { onOpen(target, previous); return; }
      const route = { pathname: "/reader/[slug]/[chapter]" as const, params: { slug, chapter: target, title, entry: push ? read?.[slug]?.[target] ? "start" : undefined : previous ? "end" : "start", transition: push ? undefined : target } };
      if (push) router.push(route); else router.replace(route);
    } catch (error) {
      if (active.current && version === generation.current && needsVerification(error)) setVerification({ target, automatic, previous });
      if (active.current && version === generation.current) setStatus(error instanceof Error && error.name !== "AbortError" ? error.message : `Download paused. ${push ? "Choose Read now to retry." : "Tap next or previous to retry."}`);
    } finally {
      if (version === generation.current) { navigating.current = false; if (active.current) setBusy(false); }
    }
  }
  function go(target?: string, automatic = false, previous = false) {
    if (!target || navigating.current) return;
    if (automatic && !preferences.readerContinuous) return;
    if (automatic || canRead(target)) { void open(target, automatic, previous); return; }
    if (["Offline","No internet"].includes(connection?.label)) { showSheet("Internet required","This chapter is not saved. Connect to download it; your saved chapters remain readable."); return; }
    // The connection guard supplies the cellular confirmation; avoid a second dialog.
    if (connection?.label !== "Wi-Fi" && connection?.label !== "Online") { void open(target, false, previous); return; }
    showSheet(`Download chapter ${target}?`, "Save this chapter on your phone and open it when ready. Mobile-data preferences still apply.", [
      { text: "Cancel", style: "cancel" },
      { text: "Download and read", onPress: () => { void open(target, false, previous); } },
    ]);
  }
  function prefetch(fraction: number, prepared?: (chapter: string) => void) {
    const key = `${next || ""}/${afterNext || ""}`;
    if (!preferences.readerPrefetch || fraction < 0.65 || !next || (attempted.current === key && (!retryPrefetchAt.current || Date.now() < retryPrefetchAt.current)) || request.current || navigating.current || !active.current || AppState.currentState !== "active") return;
    attempted.current = key; retryPrefetchAt.current = 0;
    const version = generation.current;
    return (async () => {
      for (const target of [next, afterNext]) {
        if (!target || !ahead.current.includes(target) || !active.current || version !== generation.current || navigating.current || AppState.currentState !== "active") break;
        if (!chapterIntact(slug, target)) await fetchChapter(target, true);
        if (active.current && version === generation.current) prepared?.(target);
      }
      return next;
    })().catch(() => { if (attempted.current === key) retryPrefetchAt.current = Date.now() + 30000; return undefined; });
  }
  async function cancel() { const pending = request.current; pending?.controller.abort(); await pending?.promise.catch(()=>{}); }
  const story = catalog?.find(item => item.slug === slug);
  const verify = useSourceRetry(() => { if (verification) void open(verification.target, verification.automatic, verification.previous); }, story ? sourceOf(story) : undefined);
  return { go, prefetch, status, busy, progress, cancel, verify, needsVerification: Boolean(verification), clearStatus: () => setStatus("") };
}
