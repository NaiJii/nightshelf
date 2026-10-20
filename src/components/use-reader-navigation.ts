import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useShelf } from "../lib/app-state";
import { chapterIntact } from "../lib/storage";
import { useActionSheet } from "./action-sheet";

export function useReaderNavigation(slug: string, title: string | undefined, next: string | undefined, transition?: string) {
  const { preferences, fetchReaderChapter } = useShelf();
  const showSheet = useActionSheet();
  const [status, setStatus] = useState(transition ? `Chapter ${transition}` : "");
  const [busy, setBusy] = useState(false);
  const active = useRef(false), navigating = useRef(false);
  const request = useRef<{ chapter: string; controller: AbortController; promise: Promise<void> } | null>(null);
  const attempted = useRef("");
  useEffect(() => {
    if (!transition) return;
    const timer = setTimeout(() => setStatus(current => current === `Chapter ${transition}` ? "" : current), 1600);
    return () => clearTimeout(timer);
  }, [transition]);
  useFocusEffect(useCallback(() => {
    active.current = true;
    const subscription = AppState.addEventListener("change", state => {
      if (state !== "active") request.current?.controller.abort();
    });
    return () => { active.current = false; request.current?.controller.abort(); subscription.remove(); };
  }, []));

  function fetchChapter(target: string, automatic: boolean) {
    if (request.current?.chapter === target) return request.current.promise;
    const previous = request.current;
    previous?.controller.abort();
    const controller = new AbortController();
    const promise = Promise.resolve(previous?.promise).catch(() => {}).then(() => {
      if (controller.signal.aborted) throw new Error("Cancelled");
      return fetchReaderChapter(slug, target, automatic, controller.signal, (message, fraction) => {
        if (active.current && navigating.current) setStatus(`${message}${fraction > 0 ? ` · ${Math.round(fraction * 100)}%` : ""}`);
      });
    }).finally(() => { if (request.current?.controller === controller) request.current = null; });
    request.current = { chapter: target, controller, promise };
    return promise;
  }

  async function open(target: string, automatic: boolean, previous: boolean) {
    if (!active.current || navigating.current || AppState.currentState !== "active") return;
    navigating.current = true;
    setBusy(true);
    try {
      if (!chapterIntact(slug, target)) {
        setStatus(`Preparing chapter ${target}…`);
        await fetchChapter(target, automatic);
      }
      if (!active.current || AppState.currentState !== "active") return;
      if (!chapterIntact(slug, target)) throw new Error("Chapter download is incomplete. Tap next or previous to retry.");
      router.replace({ pathname: "/reader/[slug]/[chapter]", params: { slug, chapter: target, title, entry: previous && automatic ? "end" : "start", transition: target } });
    } catch (error) {
      if (active.current) setStatus(error instanceof Error && error.name !== "AbortError" ? error.message : "Download paused. Tap next or previous to retry.");
    } finally {
      navigating.current = false;
      if (active.current) setBusy(false);
    }
  }
  function go(target?: string, automatic = false, previous = false) {
    if (!target || navigating.current) return;
    if (automatic && !preferences.readerContinuous) return;
    if (automatic || chapterIntact(slug, target)) { void open(target, automatic, previous); return; }
    showSheet(`Download chapter ${target}?`, "Save this chapter on your phone and open it when ready. Mobile-data preferences still apply.", [
      { text: "Cancel", style: "cancel" },
      { text: "Download and read", onPress: () => { void open(target, false, previous); } },
    ]);
  }
  function prefetch(fraction: number) {
    if (!preferences.readerPrefetch || fraction < 0.65 || !next || attempted.current === next || request.current || navigating.current || !active.current || AppState.currentState !== "active" || chapterIntact(slug, next)) return;
    attempted.current = next;
    void fetchChapter(next, true).catch(() => { /* Navigation offers a visible retry; speculative prefetch stays quiet. */ });
  }
  function cancel() { request.current?.controller.abort(); }
  return { go, prefetch, status, busy, cancel };
}
