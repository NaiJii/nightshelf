import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, View } from "react-native";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { chapterDirectory, chapterFiles, chapterIntact, localChapters, novelChapter, readingHistory, savePosition } from "../../../lib/storage";
import { chapterProgress } from "../../../lib/parser";
import { readerHtml } from "../../../lib/reader-html";
import { readerControls } from "../../../lib/reader-controls";
import { color, Icon, ui } from "../../../components/ui";
import { useShelf } from "../../../lib/app-state";
import { ReaderOptions, useReaderConveniences } from "../../../components/reader-options";

export default function ReaderScreen() {
  const params = useLocalSearchParams<{ slug: string; chapter: string; title?: string }>();
  return <ReaderSession key={`${params.slug}/${params.chapter}`} {...params} />;
}
function ReaderSession(params: { slug: string; chapter: string; title?: string }) {
  const { preferences, leaveChapter } = useShelf();
  const manualUnreadRef = useRef(false);
  const [hidden, setHidden] = useState(true);
  const [optionsOpen, setOptionsOpen] = useState(false);
  useFocusEffect(useCallback(() => {
    manualUnreadRef.current = false;
    return () => { leaveChapter(params.slug, params.chapter); manualUnreadRef.current = false; };
  }, [params.slug, params.chapter, leaveChapter]));
  return <><Stack.Screen options={{ statusBarHidden: hidden, navigationBarHidden: hidden }} /><ChapterReader hidden={hidden} setHidden={setHidden} optionsOpen={optionsOpen} setOptionsOpen={setOptionsOpen} key={`${params.slug}/${params.chapter}/${preferences.novelFontSize}/${preferences.novelTheme}`} {...params} manualUnreadRef={manualUnreadRef} /></>;
}
function ChapterReader({ slug, chapter, title, manualUnreadRef, hidden, setHidden, optionsOpen, setOptionsOpen }: { hidden: boolean; setHidden: (value: boolean) => void; optionsOpen: boolean; setOptionsOpen: (value: boolean) => void; slug: string; chapter: string; title?: string; manualUnreadRef: { current: boolean } }) {
  const [files] = useState(() => chapterFiles(slug, chapter));
  const [novel] = useState(() => novelChapter(slug, chapter));
  const { preferences, updatePreferences, read, completeChapter, setReadStatus, catalog } = useShelf();
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [position] = useState(() => chapterProgress(readingHistory()[slug], chapter));
  const [html] = useState(() => readerHtml(files, position, novel, preferences.novelFontSize, preferences.novelTheme));
  const baseUrl = `${chapterDirectory(slug, chapter).uri.replace(/\/$/, "")}/`;
  const web = useRef<WebView>(null);
  const controlsError = useReaderConveniences(web, Boolean(files.length || novel));
  const focused = useRef(false);
  const [intact] = useState(() => chapterIntact(slug, chapter));
  const chapters = catalog.find(item => item.slug === slug)?.localChapters || localChapters(slug);
  const index = chapters.indexOf(chapter);
  const previous = chapters[index - 1];
  const next = chapters[index + 1];

  useFocusEffect(useCallback(() => {
    focused.current = true;
    web.current?.injectJavaScript(`window.readerActive=${AppState.currentState === "active"};true;`);
    const listener = AppState.addEventListener("change", state => web.current?.injectJavaScript(`window.readerActive=${state === "active"};true;`));
    return () => { focused.current = false; web.current?.injectJavaScript("window.readerActive=false;true;"); listener.remove(); };
  }, []));

  useEffect(() => {
    if (files.length || novel) savePosition(slug, chapter, position);
  }, [chapter, files, novel, position, slug]);

  useEffect(() => { web.current?.injectJavaScript(`window.readerChromeVisible=${!hidden};true;`); }, [hidden]);

  function go(target?: string) { if (target) router.replace({ pathname: "/reader/[slug]/[chapter]", params: { slug, chapter: target, title } }); }
  return <View style={ui.safe}>
    {files.length > 0 || novel ? <WebView ref={web} source={{ html, baseUrl }} style={{ flex: 1, backgroundColor: "#08080b" }} originWhitelist={["*"]}
      allowFileAccess allowFileAccessFromFileURLs allowUniversalAccessFromFileURLs={false}
      javaScriptEnabled domStorageEnabled={false} setBuiltInZoomControls setDisplayZoomControls={false} scalesPageToFit
      textZoom={100} overScrollMode="never" setSupportMultipleWindows={false} mixedContentMode="never"
      onShouldStartLoadWithRequest={request => request.url === baseUrl || request.url === "about:blank" || request.url.startsWith("data:text/html")}
      startInLoadingState renderLoading={() => <ActivityIndicator color={color.lilac} style={{ position: "absolute", top: "45%", alignSelf: "center" }} />}
      onLoadEnd={() => web.current?.injectJavaScript(`window.readerActive=${focused.current && AppState.currentState === "active"};window.readerChromeVisible=${!hidden};true;`)}
      onError={() => setError("Could not open the saved chapter. Try reopening it.")}
      onMessage={event => {
        try {
          const data = JSON.parse(event.nativeEvent.data);
          if (Number.isFinite(data.zoom) && data.zoom >= 1 / 6 && data.zoom <= 2) {
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
          if (data.error) { setError("A saved image could not be opened. Re-download this chapter to repair it."); return; }
          if (data.complete === true && !manualUnreadRef.current && intact && !error && focused.current && AppState.currentState === "active") completeChapter(slug, chapter);
          if (Number.isFinite(data.fraction) && !manualUnreadRef.current) savePosition(slug, chapter, Math.max(0, Math.min(1, data.fraction)));
          if (Number.isInteger(data.page)) setPage(Math.max(1, Math.min(files.length, data.page)));
        } catch { /* ignore malformed messages */ }
      }} /> : <Pressable accessibilityLabel="No saved pages found. Show reader controls" onPress={() => setHidden(false)} style={{ flex: 1, padding: 25 }}><Text style={ui.empty}>No saved pages found.</Text></Pressable>}
    {!hidden && <SafeAreaView edges={["top", "left", "right"]} style={{ position: "absolute", top: 0, left: 0, right: 0, backgroundColor: color.surface }}>
    <View style={[ui.row, { paddingHorizontal: 10, height: 60, borderBottomWidth: 1, borderColor: color.line }]}>
      <Pressable accessibilityLabel="Back" onPress={() => router.back()} style={{ padding: 12 }}><Icon name="arrow-back" /></Pressable>
      <View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: color.text, fontWeight: "800" }}>{title || "NightShelf"}</Text><Text style={{ color: color.muted, fontSize: 11, marginTop: 3 }}>{catalog.find(item => item.slug === slug)?.chapterTitles?.[chapter] || `Chapter ${chapter}`} · {novel ? "Novel" : `${page}/${files.length}`} · offline</Text></View>
      <Pressable accessibilityLabel="Reader settings" accessibilityState={{ expanded: optionsOpen }} onPress={() => setOptionsOpen(!optionsOpen)} style={{ padding: 12 }}><Icon name="options-outline" tint={optionsOpen ? color.lilac : color.text} size={20} /></Pressable>
    </View>
    {optionsOpen && <ScrollView style={{ maxHeight: 340 }}><ReaderOptions error={controlsError} /></ScrollView>}
    {novel && <View style={[ui.row, { justifyContent: "center", paddingVertical: 3, borderBottomWidth: 1, borderColor: color.line }]}><Pressable accessibilityLabel="Smaller novel text" onPress={() => updatePreferences({ novelFontSize: Math.max(14, preferences.novelFontSize - 1) })} style={{ padding: 12 }}><Text style={ui.text}>A−</Text></Pressable><Text style={ui.muted}>{preferences.novelFontSize}</Text><Pressable accessibilityLabel="Larger novel text" onPress={() => updatePreferences({ novelFontSize: Math.min(30, preferences.novelFontSize + 1) })} style={{ padding: 12 }}><Text style={ui.text}>A+</Text></Pressable><Pressable accessibilityLabel="Toggle sepia reading theme" onPress={() => updatePreferences({ novelTheme: preferences.novelTheme === "dark" ? "sepia" : "dark" })} style={{ padding: 12 }}><Icon name={preferences.novelTheme === "dark" ? "sunny-outline" : "moon-outline"} size={18} /></Pressable></View>}
    </SafeAreaView>}
    {error ? <Pressable onPress={() => { setError(""); web.current?.reload(); }} style={{ position: "absolute", bottom: hidden ? 20 : 100, left: 10, right: 10, padding: 14, backgroundColor: color.surface, borderRadius: 12 }}><Text style={ui.muted}>{error} Tap to retry.</Text></Pressable> : null}
    {!hidden && <SafeAreaView edges={["bottom", "left", "right"]} style={{ position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: color.surface }}>
    <View style={[ui.row, { paddingHorizontal: 18, paddingVertical: 10, justifyContent: "space-between" }]}>
      <Pressable accessibilityLabel="Previous chapter" disabled={!previous} onPress={() => go(previous)} style={{ padding: 12, opacity: previous ? 1 : 0.25 }}><Icon name="play-skip-back" size={20} /></Pressable>
      <Pressable accessibilityRole="checkbox" accessibilityLabel="Chapter read" accessibilityState={{ checked: Boolean(read[slug]?.[chapter]) }} onPress={() => { const value = !read[slug]?.[chapter]; manualUnreadRef.current = !value; setReadStatus(slug, [chapter], value); }} style={[ui.row, { paddingVertical: 12, gap: 6 }]}><Icon name={read[slug]?.[chapter] ? "checkmark-circle" : "checkmark-circle-outline"} size={19} tint={read[slug]?.[chapter] ? "#65cba1" : color.muted} /><Text style={{ color: color.muted, fontSize: 12 }}>{read[slug]?.[chapter] ? "Read · mark unread" : "Mark as read"}</Text></Pressable>
      <Pressable accessibilityLabel="Next chapter" disabled={!next} onPress={() => go(next)} style={{ padding: 12, opacity: next ? 1 : 0.25 }}><Icon name="play-skip-forward" size={20} /></Pressable>
    </View></SafeAreaView>}
  </View>;
}

