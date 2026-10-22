import { Pressable } from "../../../components/pressable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, AppState, ScrollView, Text, View } from "react-native";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { chapterDirectory, chapterFiles, chapterIntact, localChapters, novelChapter, readingHistory, savePosition } from "../../../lib/storage";
import { chapterList, chapterListCached, chapterProgress, releaseLabel } from "../../../lib/parser";
import { readerChapterHtml, readerHtml } from "../../../lib/reader-html";
import { readerControls } from "../../../lib/reader-controls";
import { color, Icon, ui } from "../../../components/ui";
import { useShelf } from "../../../lib/app-state";
import { useActionSheet } from "../../../components/action-sheet";
import { useReaderNavigation } from "../../../components/use-reader-navigation";
import { ReaderOptions, useReaderConveniences } from "../../../components/reader-options";

function ReaderChrome({ hidden, edge, children }: { hidden: boolean; edge: "top" | "bottom"; children: React.ReactNode }) {
  const [value] = useState(() => new Animated.Value(hidden ? 0 : 1));
  useEffect(() => {
    const animation = Animated.timing(value, { toValue: hidden ? 0 : 1, duration: 180, useNativeDriver: true });
    animation.start(); return () => animation.stop();
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
  const files = useMemo(() => chapterFiles(slug, chapter, true), [slug, chapter]);
  const novel = useMemo(() => novelChapter(slug, chapter), [slug, chapter]);
  const { preferences, updatePreferences, read, completeChapter, setReadStatus, catalog, loadDetails, cancelDetails, fetchReaderChapter, leaveChapter, saved, toggleStory, setStoryOptions, setStoryNotifications, detailsLoading, detailsErrors } = useShelf();
  const showSheet = useActionSheet();
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [position] = useState(() => entry === "end" ? 1 : entry === "start" ? 0 : chapterProgress(readingHistory()[slug], chapter));
  const [html] = useState(() => readerHtml(files, position, novel, preferences.novelFontSize, preferences.novelTheme, initialChapter));
  const baseUrl = `${chapterDirectory(slug, initialChapter).uri.replace(/\/$/, "")}/`;
  const web = useRef<WebView>(null);
  const scrubberBottom = useRef(96);
  const lastProgressWrite = useRef(0);
  const pendingProgress = useRef<{ chapter: string; fraction: number } | null>(null);
  useEffect(() => () => {
    const pending = pendingProgress.current;
    if (pending && !manualUnread.current.has(pending.chapter)) savePosition(slug, pending.chapter, pending.fraction);
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
  const pendingOpen = useRef<{ chapter: string; end: boolean } | null>(null);
  const neighbors = useRef({ previous, next });
  useEffect(() => { neighbors.current = { previous, next }; }, [previous, next]);
  const attach = useCallback((id: string) => {
    if (!chapterIntact(slug, id)) return;
    const content = readerChapterHtml(chapterFiles(slug, id, true), novelChapter(slug, id));
    web.current?.injectJavaScript(`window.readerAttachChapter?.(${JSON.stringify(id)},${JSON.stringify(content)});true;`);
  }, [slug]);
  const navigation = useReaderNavigation(slug, title, next, transition, false, (id, end) => {
    if (!preferences.readerContinuous) {
      router.replace({ pathname: "/reader/[slug]/[chapter]", params: { slug, chapter: id, title, entry: end ? "end" : "start", transition: id } });
      return;
    }
    pendingOpen.current = { chapter: id, end };
    web.current?.injectJavaScript(`window.readerOpenChapter?.(${JSON.stringify(id)},${end});true;`);
    attach(id);
  }, chapters[index + 2]);
  const syncNeighbors = () => {
    web.current?.injectJavaScript(`window.readerSetNeighbors?.(${JSON.stringify(preferences.readerContinuous ? [previous, next] : [])},${preferences.readerContinuous});true;`);
    if (preferences.readerContinuous) {
      if (previous) attach(previous);
      if (next) attach(next);
    }
  };
  useEffect(syncNeighbors, [attach, previous, next, preferences.readerContinuous, item?.localChapters]);
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
  }, [preferences.novelFontSize, preferences.novelTheme]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    web.current?.injectJavaScript(`window.readerActive=${AppState.currentState === "active"};window.readerUpdateControls?.();true;`);
    const listener = AppState.addEventListener("change", state => { if(state!=="active")repair.current?.abort(); web.current?.injectJavaScript(`window.readerActive=${state === "active"};window.readerUpdateControls?.();true;`); });
    return () => { repair.current?.abort(); focused.current = false; web.current?.injectJavaScript("window.readerActive=false;window.readerUpdateControls?.();true;"); listener.remove(); };
  }, []));

  useEffect(() => {
    if (chapterFiles(slug, initialChapter).length || novelChapter(slug, initialChapter)) savePosition(slug, initialChapter, position);
  }, [initialChapter, position, slug]);

  useEffect(() => { web.current?.injectJavaScript(`window.readerChromeVisible=${!hidden};window.readerUpdateControls?.();true;`); }, [hidden]);

  const chaptersSaved = (id: string) => (item?.localChapters || []).includes(id);
  return <View nativeID={`nightshelf-reader:${baseUrl}`} collapsable={false} style={ui.safe}>
    {files.length > 0 || novel ? <WebView ref={web} source={{ html, baseUrl }} style={{ flex: 1, backgroundColor: "#08080b" }} originWhitelist={["*"]}
      allowFileAccess allowFileAccessFromFileURLs allowUniversalAccessFromFileURLs={false}
      javaScriptEnabled domStorageEnabled={false} setBuiltInZoomControls setDisplayZoomControls={false} scalesPageToFit
      textZoom={100} overScrollMode="never" setSupportMultipleWindows={false} mixedContentMode="never"
      onShouldStartLoadWithRequest={request => request.url === baseUrl || request.url === "about:blank" || request.url.startsWith("data:text/html")}
      startInLoadingState renderLoading={() => <ActivityIndicator color={color.lilac} style={{ position: "absolute", top: "45%", alignSelf: "center" }} />}
      onLoadEnd={() => { syncNeighbors(); web.current?.injectJavaScript(`window.readerActive=${focused.current && AppState.currentState === "active"};window.readerChromeVisible=${!hidden};window.readerContinuous=${preferences.readerContinuous};window.readerScrubberBottom=${scrubberBottom.current};window.readerUpdateControls?.();${endingScript}window.readerSetAppearance?.(${preferences.novelFontSize},${JSON.stringify(preferences.novelTheme)});true;`); }}
      onError={() => setError("Could not open the saved chapter. Try reopening it.")}
      onMessage={event => {
        try {
          const data = JSON.parse(event.nativeEvent.data);
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
            currentChapter.current = id; visited.current.add(id); pendingOpen.current = null;
            setChapter(id); setPage(1); setIntact(chapterIntact(slug, id)); setError("");
            return;
          }
          if (typeof data.attachedChapter === "string") {
            const pending = pendingOpen.current;
            if (pending && pending.chapter === data.attachedChapter && focused.current) web.current?.injectJavaScript(`window.readerOpenChapter?.(${JSON.stringify(pending.chapter)},${pending.end});true;`);
            return;
          }
          // An adjacent section can finish loading or report progress before React rerenders.
          const sourceChapter = typeof data.chapter === "string" && data.chapter ? data.chapter : currentChapter.current;
          const sourceFiles = sourceChapter === chapter ? files : chapterFiles(slug, sourceChapter, true);
          const sourceIntact = sourceChapter === chapter ? intact : chapterIntact(slug, sourceChapter);
          if (Number.isFinite(data.zoom) && data.zoom >= 1 / 6 && data.zoom <= 2) {
            if (!readerControls) { setError("Zoom requires the updated Android app."); return; }
            if (focused.current && AppState.currentState === "active" && readerControls) {
              void readerControls.zoomReader(baseUrl, data.zoom).then(ok => {
                if (!ok && focused.current) setError("Could not zoom this chapter. Tap to reload and retry.");
              }).catch(() => { if (focused.current) setError("Double-tap zoom needs the latest Android build."); });
            }
            return;
          }
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
          if (Number.isFinite(data.fraction) && !manualUnread.current.has(sourceChapter)) pendingProgress.current = {chapter:sourceChapter,fraction:Math.max(0,Math.min(1,data.fraction))};
          if (Number.isFinite(data.fraction) && !manualUnread.current.has(sourceChapter) && (data.complete || data.fraction === 0 || event.timeStamp - lastProgressWrite.current >= 1500)) { savePosition(slug, sourceChapter, Math.max(0, Math.min(1, data.fraction))); lastProgressWrite.current = event.timeStamp; }
          if (Number.isInteger(data.page) && sourceChapter === currentChapter.current) setPage(Math.max(1, Math.min(sourceFiles.length, data.page)));
        } catch { /* ignore malformed messages */ }
      }} /> : <Pressable accessibilityLabel="No saved pages found. Show reader controls" onPress={() => setHidden(false)} style={{ flex: 1, padding: 25 }}><Text style={ui.empty}>No saved pages found.</Text></Pressable>}
    <ReaderChrome hidden={hidden} edge="top"><SafeAreaView edges={["top", "left", "right"]} style={{ backgroundColor: color.surface }}>
    <View style={[ui.row, { paddingHorizontal: 10, height: 60, borderBottomWidth: 1, borderColor: color.line }]}>
      <Pressable accessibilityLabel="Back" onPress={() => router.back()} style={{ padding: 12 }}><Icon name="arrow-back" /></Pressable>
      <View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: color.text, fontWeight: "800" }}>{title || "NightShelf"}</Text><Text style={{ color: color.muted, fontSize: 11, marginTop: 3 }}>{catalog.find(item => item.slug === slug)?.chapterTitles?.[chapter] || `Chapter ${chapter}`} · {novel ? "Novel" : `${page}/${files.length}`} · offline</Text></View>
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

