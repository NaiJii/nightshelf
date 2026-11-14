import { Pressable } from "../../../components/pressable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, AppState, ScrollView, Text, View } from "react-native";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { chapterDirectory, chapterFiles, chapterIntact, chapterReadState, localChapters, novelChapter, readingHistory, savePosition } from "../../../lib/storage";
import type { PanelPosition } from "../../../lib/storage";
import { chapterList, chapterListCached, chapterProgress, releaseLabel } from "../../../lib/parser";
import { readerChapterHtml, readerHtml } from "../../../lib/reader-html";
import { color, Icon, ui } from "../../../components/ui";
import { useDownloads, useShelf } from "../../../lib/app-state";
import { useDownloadDrawer } from "../../../components/download-drawer-context";
import { chapterDownloadStatus, queuedChapters } from "../../../lib/download-display";
import { useActionSheet } from "../../../components/action-sheet";
import { useReaderNavigation } from "../../../components/use-reader-navigation";
import { ReaderOptions, useReaderConveniences } from "../../../components/reader-options";

function persistPosition(slug: string, chapter: string, fraction: number, panel?: PanelPosition) {
  if (panel) savePosition(slug, chapter, fraction, panel); else savePosition(slug, chapter, fraction);
}

function ReaderChrome({ hidden, edge, children }: { hidden: boolean; edge: "top" | "bottom"; children: React.ReactNode }) {
  const [value] = useState(() => new Animated.Value(hidden ? 0 : 1));
  useEffect(() => {
    const animation = Animated.timing(value, { toValue: hidden ? 0 : 1, duration: 180, useNativeDriver: true });
    const listener = AppState.addEventListener("change", state => { if (state === "active") { animation.stop(); value.setValue(hidden ? 0 : 1); } });
    animation.start(); return () => { animation.stop(); listener.remove(); };
  }, [hidden, value]);
  return <Animated.View pointerEvents={hidden ? "none" : "auto"} accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? "no-hide-descendants" : "auto"} style={{position:"absolute",left:0,right:0,[edge]:0,opacity:value,transform:[{translateY:value.interpolate({inputRange:[0,1],outputRange:[edge === "top" ? -18 : 18,0]})}]}}>{children}</Animated.View>;
}

export default function ReaderScreen() {
  const params = useLocalSearchParams<{ slug: string; chapter: string; title?: string; entry?: string; transition?: string }>();
  return <ReaderSession key={`${params.slug}/${params.chapter}`} {...params} />;
}
function ReaderSession(params: { slug: string; chapter: string; title?: string; entry?: string; transition?: string }) {
  const [hidden, setHidden] = useState(true);
  const [optionsOpen, setOptionsOpen] = useState(false);
  return <><Stack.Screen options={{ statusBarHidden: hidden, navigationBarHidden: hidden }} /><ChapterReader hidden={hidden} setHidden={setHidden} optionsOpen={optionsOpen} setOptionsOpen={setOptionsOpen} key={`${params.slug}/${params.chapter}`} {...params} /></>;
}
function ChapterReader({ slug, chapter: initialChapter, title, entry, transition, hidden, setHidden, optionsOpen, setOptionsOpen }: { hidden: boolean; setHidden: (value: boolean) => void; optionsOpen: boolean; setOptionsOpen: (value: boolean) => void; slug: string; chapter: string; title?: string; entry?: string; transition?: string }) {
  const [chapter, setChapter] = useState(initialChapter);
  const currentChapter = useRef(initialChapter);
  const visited = useRef(new Set([initialChapter]));
  const manualUnread = useRef(new Set<string>());
  const [chapterState, setChapterState] = useState(() => ({ chapter, ...chapterReadState(slug, chapter) }));
  const local = chapterState.chapter === chapter ? chapterState : chapterReadState(slug, chapter);
  const files = local.files;
  const novel = useMemo(() => local.complete ? novelChapter(slug, chapter) : null, [slug, chapter, local.complete]);
  const { preferences, updatePreferences, read, completeChapter, setReadStatus, catalog, loadDetails, cancelDetails, fetchReaderChapter, leaveChapter, saved, toggleStory, setStoryOptions, setStoryNotifications, detailsLoading, detailsErrors, startDownload } = useShelf();
  const showSheet = useActionSheet();
  const downloads = useDownloads(true);
  const showDownloads = useDownloadDrawer();
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [position] = useState(() => entry === "end" ? 1 : entry === "start" ? 0 : chapterProgress(readingHistory()[slug], chapter));
  const [html] = useState(() => readerHtml(files, position, novel, preferences.novelFontSize, preferences.novelTheme, initialChapter, local.complete));
  const baseUrl = `${chapterDirectory(slug, initialChapter).uri.replace(/\/$/, "")}/`;
  const web = useRef<WebView>(null);
  const loading = useRef(true);
  const published = useRef(new Map<string, string>());
  const scrubberBottom = useRef(96);
  const lastProgressWrite = useRef(0);
  const pendingProgress = useRef<{ chapter: string; fraction: number; panel?: PanelPosition } | null>(null);
  const flushProgress = useCallback(() => {
    const pending = pendingProgress.current;
    if (pending && !manualUnread.current.has(pending.chapter)) persistPosition(slug, pending.chapter, pending.fraction, pending.panel);
    pendingProgress.current = null;
  }, [slug]);
  useEffect(() => flushProgress, [flushProgress]);
  const recordProgress = useCallback((id: string, fraction: number, complete: boolean, panel?: PanelPosition) => {
    if (!Number.isFinite(fraction) || manualUnread.current.has(id)) return;
    const value = Math.max(0, Math.min(1, fraction)), now = Date.now();
    pendingProgress.current = {chapter:id,fraction:value,panel};
    if (complete || fraction === 0 || now - lastProgressWrite.current >= 1500) {
      persistPosition(slug, id, value, panel); lastProgressWrite.current = now;
    }
  }, [slug]);
  const repair = useRef<AbortController | null>(null);
  const controlsError = useReaderConveniences(web, Boolean(files.length || novel));
  const focused = useRef(false);
  const [intact, setIntact] = useState(() => chapterIntact(slug, chapter));
  const item = catalog.find(item => item.slug === slug);
  const chapters = chapterList(item?.chapterIds, item?.localChapters || localChapters(slug), {}, "all", "", false);
  const index = chapters.indexOf(chapter);
  const previous = chapters[index - 1];
  const next = chapters[index + 1];
  const pendingOpen = useRef<{ chapter: string; end: boolean; fraction?: number } | null>(null);
  const neighbors = useRef({ previous, next });
  useEffect(() => { neighbors.current = { previous, next }; }, [previous, next]);
  const attach = useCallback((id: string) => {
    const state = chapterReadState(slug, id), text = novelChapter(slug, id);
    if (!state.files.length && !text && !downloads.some(job => job.series.slug === slug && queuedChapters(job).includes(id))) return;
    if (loading.current) return;
    const content = readerChapterHtml(state.files, text);
    web.current?.injectJavaScript(`window.readerAttachChapter?.(${JSON.stringify(id)},${JSON.stringify(content)},${state.complete},${state.total});true;`);
  }, [slug, downloads]);
  const navigation = useReaderNavigation(slug, title, next, transition, false, (id, end) => {
    if (!preferences.readerContinuous) {
      router.replace({ pathname: "/reader/[slug]/[chapter]", params: { slug, chapter: id, title, entry: end ? "end" : "start", transition: id } });
      return;
    }
    pendingOpen.current = { chapter: id, end };
    web.current?.injectJavaScript(`window.readerOpenChapter?.(${JSON.stringify(id)},${end});true;`);
    attach(id);
  }, chapters[index + 2], chapter);
  const syncNeighbors = () => {
    web.current?.injectJavaScript(`window.readerSetNeighbors?.(${JSON.stringify(preferences.readerContinuous ? [previous, next] : [])},${preferences.readerContinuous});true;`);
    if (preferences.readerContinuous) {
      if (previous) attach(previous);
      if (next) attach(next);
    }
  };
  useEffect(syncNeighbors, [attach, previous, next, preferences.readerContinuous, item?.localChapters]);
  const downloadStatusScript = [...new Set([chapter, previous, next].filter((id): id is string => Boolean(id)))].map(id => `window.readerSetDownloadStatus?.(${JSON.stringify(id)},${JSON.stringify(chapterDownloadStatus(downloads, slug, id))});`).join("") + "true;";
  useEffect(() => { web.current?.injectJavaScript(downloadStatusScript); }, [downloadStatusScript]);
  // Watch the current chapter only while incomplete or while this story is queued.
  // Existing panels stay mounted; new committed panels are appended in place.
  useEffect(() => {
    const refresh = () => {
      if (!focused.current || AppState.currentState !== "active") return;
      const next = { chapter, ...chapterReadState(slug, chapter) };
      setChapterState(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
      setIntact(chapterIntact(slug, chapter));
      if (!loading.current) {
        const text = novelChapter(slug, chapter), signature = JSON.stringify([{ files: next.files, total: next.total, complete: next.complete }, text]);
        if (published.current.get(chapter) !== signature) {
          published.current.set(chapter, signature);
          web.current?.injectJavaScript(`window.readerUpdateChapter?.(${JSON.stringify(chapter)},${JSON.stringify(readerChapterHtml(next.files, text))},${next.complete},${next.total});true;`);
        }
        if (preferences.readerContinuous) { if (neighbors.current.previous) attach(neighbors.current.previous); if (neighbors.current.next) attach(neighbors.current.next); }
        web.current?.injectJavaScript(downloadStatusScript);
      }
    };
    refresh();
    if (local.complete && !downloads.some(job => job.series.slug === slug)) return;
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [slug, chapter, local.complete, downloads, attach, preferences.readerContinuous, downloadStatusScript]);
  const latest = chapters.at(-1);
  const ending = item && latest ? {
    chapter: latest,
    title: !chapterListCached(item) ? "More chapters may be available" : item.lockedChapterIds?.some(id => Number(id) > Number(latest)) ? "Latest public chapter" : "You’re caught up",
    detail: !chapterListCached(item) ? "Refresh the chapter list to check for more." : [item.updatedAt ? releaseLabel(item) : "No newer public chapters found.", item.lockedChapterIds?.some(id => Number(id) > Number(latest)) ? "Additional chapters require provider access." : ""].filter(Boolean).join(" · "),
    refreshing: detailsLoading.includes(slug),
    error: detailsErrors[slug],
    bookmarked: Boolean(saved[slug]?.bookmarked),
    automatic: Boolean(saved[slug]?.bookmarked && saved[slug]?.autoDownload),
  } : null;
  const endingScript = `window.readerSetEnding?.(${JSON.stringify(ending)});true;`;
  useEffect(() => { web.current?.injectJavaScript(endingScript); }, [endingScript]);
  useFocusEffect(useCallback(() => () => {
    // Keep mounted adjacent chapters on disk until the scrolling session ends.
    for (const id of visited.current) leaveChapter(slug, id);
  }, [slug, leaveChapter]));
  useFocusEffect(useCallback(() => { void loadDetails(slug); return () => cancelDetails(slug); }, [slug, loadDetails, cancelDetails]));
  useEffect(() => {
    web.current?.injectJavaScript(`window.readerSetAppearance?.(${preferences.novelFontSize},${JSON.stringify(preferences.novelTheme)});true;`);
  }, [preferences.novelFontSize, preferences.novelTheme, novel]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    web.current?.injectJavaScript(`window.readerActive=${AppState.currentState === "active"};window.readerUpdateControls?.();true;`);
    const listener = AppState.addEventListener("change", state => {
      if (state !== "active") { repair.current?.abort(); flushProgress(); }
      else setHidden(false);
      web.current?.injectJavaScript(`window.readerSetActive?.(${state === "active"});true;`);
    });
    return () => { repair.current?.abort(); flushProgress(); focused.current = false; web.current?.injectJavaScript("window.readerSetActive?.(false);true;"); listener.remove(); };
  }, [flushProgress, setHidden]));

  useEffect(() => {
    const history = readingHistory()[slug];
    const panel = !entry ? history?.chapters?.[initialChapter]?.panel || (history?.chapter === initialChapter ? history.panel : undefined) : undefined;
    if (chapterFiles(slug, initialChapter).length || novelChapter(slug, initialChapter)) persistPosition(slug, initialChapter, position, panel);
  }, [initialChapter, position, slug, entry]);

  useEffect(() => { web.current?.injectJavaScript(`window.readerChromeVisible=${!hidden};window.readerUpdateControls?.();true;`); }, [hidden]);

  const chaptersSaved = (id: string) => (item?.localChapters || []).includes(id);
  return <View style={ui.safe}>
    {<WebView ref={web} source={{ html, baseUrl }} style={{ flex: 1, backgroundColor: "#08080b" }} originWhitelist={["*"]}
      allowFileAccess allowFileAccessFromFileURLs allowUniversalAccessFromFileURLs={false}
      javaScriptEnabled domStorageEnabled={false} setBuiltInZoomControls setDisplayZoomControls={false} scalesPageToFit
      textZoom={100} overScrollMode="never" setSupportMultipleWindows={false} mixedContentMode="never"
      onShouldStartLoadWithRequest={request => request.url === baseUrl || request.url === "about:blank" || request.url.startsWith("data:text/html")}
      startInLoadingState renderLoading={() => <ActivityIndicator color={color.lilac} style={{ position: "absolute", top: "45%", alignSelf: "center" }} />}
      onLoadStart={() => { loading.current = true; published.current.clear(); }}
      onLoadEnd={() => {
        const id = currentChapter.current;
        const fraction = pendingProgress.current?.chapter === id ? pendingProgress.current.fraction : chapterProgress(readingHistory()[slug], id);
        loading.current = false;
        const local = chapterReadState(slug, id);
        web.current?.injectJavaScript(`window.readerUpdateChapter?.(${JSON.stringify(id)},${JSON.stringify(readerChapterHtml(local.files, novelChapter(slug, id)))},${local.complete},${local.total});${downloadStatusScript}`);
        syncNeighbors();
        if (id !== initialChapter) pendingOpen.current = {chapter:id,end:false,fraction};
        web.current?.injectJavaScript(`window.readerActive=${focused.current && AppState.currentState === "active"};window.readerChromeVisible=${!hidden};window.readerContinuous=${preferences.readerContinuous};window.readerScrubberBottom=${scrubberBottom.current};window.readerUpdateControls?.();${endingScript}window.readerSetAppearance?.(${preferences.novelFontSize},${JSON.stringify(preferences.novelTheme)});window.readerRestorePosition?.(${JSON.stringify(id)},${fraction});true;`);
        if (id !== initialChapter) attach(id);
        const savedPanel = pendingProgress.current?.chapter === id ? pendingProgress.current.panel : readingHistory()[slug]?.chapters?.[id]?.panel;
        if (savedPanel && (id !== initialChapter || !entry)) web.current?.injectJavaScript(`window.readerRestorePanel?.(${JSON.stringify(id)},${JSON.stringify(savedPanel)});true;`);
      }}
      onError={() => setError("Could not open the saved chapter. Try reopening it.")}
      onMessage={event => {
        try {
          const data = JSON.parse(event.nativeEvent.data);
          if (data.downloadPending && focused.current) {
            const id = typeof data.chapter === "string" ? data.chapter : currentChapter.current;
            if (downloads.some(job => job.series.slug === slug)) showDownloads();
            else if (item?.chapterIds?.includes(id)) showSheet("Continue downloading?", "Saved panels stay readable. Download the remaining panels using your current connection settings.", [
              { text: "Cancel", style: "cancel" }, { text: "Continue download", onPress: () => startDownload(item, id) },
            ]);
            return;
          }
          if (loading.current && (Number.isFinite(data.fraction) || data.activeChapter)) return;
          if (data.ending && focused.current && AppState.currentState === "active") {
            if (data.ending === "refresh") void loadDetails(slug, true);
            if (data.ending === "bookmark") toggleStory(slug, "bookmarked");
            if (data.ending === "auto") {
              const enabled = !saved[slug]?.bookmarked || !saved[slug]?.autoDownload;
              setStoryOptions(slug, { autoDownload: enabled });
              if (enabled && (!preferences.releaseNotifications || saved[slug]?.notifyReleases === false)) showSheet("Release alerts?", "One notification per story, grouping new chapters.", [{ text: "Not now", style: "cancel" }, { text: "Notify me", onPress: () => void setStoryNotifications(slug, true) }]);
            }
            return;
          }
          if (typeof data.activeChapter === "string" && chapters.includes(data.activeChapter) && focused.current && AppState.currentState === "active") {
            const id = data.activeChapter;
            void navigation.cancel();
            flushProgress();
            currentChapter.current = id; visited.current.add(id); pendingOpen.current = null;
            setChapter(id); setPage(1); setIntact(chapterIntact(slug, id)); setError("");
            return;
          }
          if (typeof data.attachedChapter === "string") {
            published.current.delete(data.attachedChapter);
            const pending = pendingOpen.current;
            if (pending && pending.chapter === data.attachedChapter && focused.current) web.current?.injectJavaScript(pending.fraction === undefined ? `window.readerOpenChapter?.(${JSON.stringify(pending.chapter)},${pending.end});true;` : `window.readerRestorePosition?.(${JSON.stringify(pending.chapter)},${pending.fraction});true;`);
            return;
          }
          // An adjacent section can finish loading or report progress before React rerenders.
          const sourceChapter = typeof data.chapter === "string" && data.chapter ? data.chapter : currentChapter.current;
          const sourceFiles = sourceChapter === chapter ? files : chapterReadState(slug, sourceChapter).files;
          const sourceIntact = sourceChapter === chapter ? intact : chapterIntact(slug, sourceChapter);
          if (data.controls === "show" || data.controls === "hide") {
            if (focused.current && AppState.currentState === "active") { setHidden(data.controls === "hide"); if (data.controls === "hide") setOptionsOpen(false); }
            return;
          }
          if (Number.isInteger(data.repair) && data.repair >= 0 && data.repair < sourceFiles.length && focused.current && AppState.currentState === "active") {
            if (repair.current) return;
            const page = data.repair, controller = new AbortController(); repair.current = controller;
            const state = (busy: boolean, message: string) => { if (focused.current) web.current?.injectJavaScript(`window.readerPanelRepairState?.(${page},${busy},${JSON.stringify(message)},${JSON.stringify(sourceChapter)});true;`); };
            state(true,"Preparing repair…");
            void navigation.cancel().then(async()=>{
              if (!focused.current || controller.signal.aborted) return;
              await fetchReaderChapter(slug,sourceChapter,false,controller.signal,message=>state(true,message),page);
              if (focused.current && !controller.signal.aborted) web.current?.injectJavaScript(`window.readerReloadPanel?.(${page},${JSON.stringify(sourceChapter)});true;`);
            }).catch(failure=>state(false,`${failure instanceof Error?failure.message:"Repair failed"} · Tap to retry`)).finally(()=>{if(repair.current===controller)repair.current=null;});
            return;
          }
          if (Number.isInteger(data.repaired)) { if(focused.current && sourceChapter === currentChapter.current)setIntact(chapterIntact(slug,sourceChapter)); return; }
          if (data.error && Number.isInteger(data.page)) { if (sourceChapter === currentChapter.current) setIntact(false); web.current?.injectJavaScript(`window.readerPanelRepairState?.(${data.page},false,"",${JSON.stringify(sourceChapter)});true;`); return; }
          if (data.error) { setError("A saved image could not be opened. Re-download this chapter to repair it."); return; }
          if (!sourceFiles.length && !novelChapter(slug, sourceChapter)) return;
          if (data.snapshot === true && focused.current && visited.current.has(sourceChapter) && Number.isFinite(data.fraction) && !manualUnread.current.has(sourceChapter)) {
            if (data.complete === true && chapterIntact(slug, sourceChapter)) completeChapter(slug, sourceChapter);
            persistPosition(slug, sourceChapter, Math.max(0, Math.min(1, data.fraction)), data.panel);
            pendingProgress.current = null;
            return;
          }
          if (!focused.current || AppState.currentState !== "active") return;
          if (data.boundary === "next" || data.boundary === "previous") {
            if (sourceChapter === chapter && sourceChapter === currentChapter.current && sourceIntact && !error) navigation.go(data.boundary === "next" ? next : previous, true, data.boundary === "previous");
            return;
          }
          if ((data.prefetch || Number.isFinite(data.fraction)) && sourceChapter === chapter && sourceIntact && !error) {
            void navigation.prefetch(data.prefetch ? 0.65 : data.fraction, id => {
              if (focused.current && neighbors.current.next === id) attach(id);
            });
          }
          if (data.complete === true && !manualUnread.current.has(sourceChapter) && (sourceIntact || chapterIntact(slug,sourceChapter)) && !error && focused.current && AppState.currentState === "active") completeChapter(slug, sourceChapter);
          recordProgress(sourceChapter, data.fraction, data.complete === true, data.panel);
          if (Number.isInteger(data.page) && sourceChapter === currentChapter.current) setPage(Math.max(1, Math.min(sourceFiles.length, data.page)));
        } catch { /* ignore malformed messages */ }
      }} />}
    <ReaderChrome hidden={hidden} edge="top"><SafeAreaView edges={["top", "left", "right"]} style={{ backgroundColor: color.surface }}>
    <View style={[ui.row, { paddingHorizontal: 10, height: 60, borderBottomWidth: 1, borderColor: color.line }]}>
      <Pressable accessibilityLabel="Back" onPress={() => router.back()} style={{ padding: 12 }}><Icon name="arrow-back" /></Pressable>
      <View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: color.text, fontWeight: "800" }}>{title || "NightShelf"}</Text><Text style={{ color: color.muted, fontSize: 11, marginTop: 3 }}>{catalog.find(item => item.slug === slug)?.chapterTitles?.[chapter] || `Chapter ${chapter}`} · {novel ? "Novel" : `${page}/${local.total || files.length}`} · {local.complete ? "offline" : `${files.length} panels saved`}</Text></View>
      <Pressable accessibilityLabel="Reader settings" accessibilityState={{ expanded: optionsOpen }} onPress={() => setOptionsOpen(!optionsOpen)} style={{ padding: 12 }}><Icon name="options-outline" tint={optionsOpen ? color.lilac : color.text} size={20} /></Pressable>
    </View>
    {optionsOpen && <ScrollView style={{ maxHeight: 340 }}><ReaderOptions error={controlsError} /></ScrollView>}
    {novel && <View style={[ui.row, { justifyContent: "center", paddingVertical: 3, borderBottomWidth: 1, borderColor: color.line }]}><Pressable accessibilityLabel="Smaller novel text" onPress={() => updatePreferences({ novelFontSize: Math.max(14, preferences.novelFontSize - 1) })} style={{ padding: 12 }}><Text style={ui.text}>A−</Text></Pressable><Text style={ui.muted}>{preferences.novelFontSize}</Text><Pressable accessibilityLabel="Larger novel text" onPress={() => updatePreferences({ novelFontSize: Math.min(30, preferences.novelFontSize + 1) })} style={{ padding: 12 }}><Text style={ui.text}>A+</Text></Pressable><Pressable accessibilityLabel="Toggle sepia reading theme" onPress={() => updatePreferences({ novelTheme: preferences.novelTheme === "dark" ? "sepia" : "dark" })} style={{ padding: 12 }}><Icon name={preferences.novelTheme === "dark" ? "sunny-outline" : "moon-outline"} size={18} /></Pressable></View>}
    </SafeAreaView></ReaderChrome>
    {navigation.needsVerification && <Pressable onPress={navigation.verify} style={{position:"absolute",bottom:hidden?65:145,alignSelf:"center",padding:12,borderRadius:12,backgroundColor:color.surface}}><Text style={{color:color.lilac}}>Verify and retry</Text></Pressable>}
    {navigation.status && !error ? <Pressable accessibilityLabel={navigation.busy ? "Cancel reader download" : "Show reader controls"} onPress={navigation.busy ? navigation.cancel : () => setHidden(false)} style={[ui.row, {position:"absolute",bottom:hidden?22:100,alignSelf:"center",maxWidth:"90%",paddingHorizontal:12,paddingVertical:8,gap:8,borderRadius:14,backgroundColor:color.surface}]}>{navigation.busy && <ActivityIndicator size="small" color={color.lilac}/>}<Text accessibilityLiveRegion="polite" numberOfLines={2} style={{color:color.muted,fontSize:11,flexShrink:1}}>{navigation.status}</Text>{navigation.busy && <Icon name="close" size={14} tint={color.muted}/>}</Pressable> : null}
    {error ? <Pressable onPress={() => { setError("");
      if (chapter === initialChapter) web.current?.reload();
      else router.replace({ pathname: "/reader/[slug]/[chapter]", params: { slug, chapter, title } }); }} style={{ position: "absolute", bottom: hidden ? 20 : 100, left: 10, right: 10, padding: 14, backgroundColor: color.surface, borderRadius: 12 }}><Text style={ui.muted}>{error} Tap to retry.</Text></Pressable> : null}
    <ReaderChrome hidden={hidden} edge="bottom"><SafeAreaView edges={["bottom", "left", "right"]} onLayout={event => { scrubberBottom.current = event.nativeEvent.layout.height + 8; web.current?.injectJavaScript(`window.readerScrubberBottom=${scrubberBottom.current};window.readerUpdateControls?.();true;`); }} style={{ backgroundColor: color.surface }}>
    <View style={[ui.row, { paddingHorizontal: 18, paddingVertical: 10, justifyContent: "space-between" }]}>
      <Pressable accessibilityLabel="Previous chapter" disabled={!previous || navigation.busy} onPress={() => navigation.go(previous, false, true)} style={{ padding: 12, opacity: previous ? 1 : 0.25 }}><Icon name="play-skip-back" size={20} />{previous && !chaptersSaved(previous) && <Icon name="download-outline" size={12} tint={color.lilac} />}</Pressable>
      <Pressable accessibilityRole="checkbox" accessibilityLabel="Chapter read" accessibilityState={{ checked: Boolean(read[slug]?.[chapter]) }} onPress={() => { const value = !read[slug]?.[chapter]; if (value) manualUnread.current.delete(chapter); else manualUnread.current.add(chapter); setReadStatus(slug, [chapter], value); }} style={[ui.row, { paddingVertical: 12, gap: 6 }]}><Icon name={read[slug]?.[chapter] ? "checkmark-circle" : "checkmark-circle-outline"} size={19} tint={read[slug]?.[chapter] ? "#65cba1" : color.muted} /><Text style={{ color: color.muted, fontSize: 12 }}>{read[slug]?.[chapter] ? "Read · mark unread" : "Mark as read"}</Text></Pressable>
      <Pressable accessibilityLabel="Next chapter" disabled={!next || navigation.busy} onPress={() => navigation.go(next)} style={{ padding: 12, opacity: next ? 1 : 0.25 }}><Icon name="play-skip-forward" size={20} />{next && !chaptersSaved(next) && <Icon name="download-outline" size={12} tint={color.lilac} />}</Pressable>
    </View></SafeAreaView></ReaderChrome>
  </View>;
}

