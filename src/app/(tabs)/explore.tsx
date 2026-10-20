import { Pressable } from "../../components/pressable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useShelf } from "../../lib/app-state";
import { filterDiscovery, SortOrder, sortExplore } from "../../lib/parser";
import { exploreQuery, rememberExploreQuery, exploreSession, rememberExplore } from "../../lib/explore-session";
import { FIRST_PAGE } from "../../lib/scraper";
import type { BrowseOptions } from "../../lib/scraper";
import { Chip, color, Icon, PageHeading, ui } from "../../components/ui";
import { SeriesCard } from "../../components/series-card";
import { DiscoveryControls, PopularPeriods } from "../../components/discovery-controls";

const SORTS: [SortOrder, string][] = [["smart", "For you"], ["trending", "Popular"], ["rating", "Top rated"], ["updated", "Latest updates"], ["chapters", "Long reads"], ["title", "A–Z"]];
export default function Explore() {
  const { preferences } = useShelf();
  const provider = `${preferences.source}:${preferences.webtoonLanguage}:${preferences.webtoonCollection}`;
  return <ExploreResults key={provider} provider={provider} />;
}
export function ExploreResults({ provider }: { provider: string }) {
  const { catalog, preferences, saved, browse, updatePreferences, sourceSessionRevision } = useShelf();
  const [query, setQuery] = useState(() => exploreQuery(provider));
  const [debounced, setDebounced] = useState(() => exploreQuery(provider).trim());
  const [reload, setReload] = useState(0);
  const [ids, setIds] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");
  const list = useRef<FlatList>(null);
  const restoreOffset = useRef<number | null>(null);
  const refreshingFirst = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const cursor = useRef({ ...FIRST_PAGE });
  const loadedIds = useRef<string[]>([]);
  const more = useRef(true);
  const failed = useRef(false);
  const viewport = useRef({ height: 0, content: 0, offset: 0 });
  useEffect(() => { const timer = setTimeout(() => setDebounced(query.trim()), 450); return () => clearTimeout(timer); }, [query]);
  const webtoon = preferences.source === "webtoon";
  const readerSite = preferences.source === "vortex" || preferences.source === "mangakakalot";
  const alternate = webtoon || readerSite;
  const effectiveSort = readerSite && !["updated", "title"].includes(preferences.sort) ? "smart" : webtoon && (preferences.sort !== "title" && (preferences.sort !== "trending" || preferences.webtoonCollection === "canvas")) ? "smart" : preferences.sort;
  const options: BrowseOptions = useMemo(() => ({ source: preferences.source, language: preferences.webtoonLanguage, collection: preferences.webtoonCollection, mode: preferences.contentMode, sort: effectiveSort, period: preferences.period, query: debounced.length >= 2 ? debounced : "", refresh: reload > 0 || sourceSessionRevision > 0 }), [preferences.source, preferences.webtoonLanguage, preferences.webtoonCollection, preferences.contentMode, effectiveSort, preferences.period, debounced, reload, sourceSessionRevision]);
  const sessionKey = JSON.stringify([provider, preferences.contentMode, effectiveSort, preferences.period, debounced]);
  const shortQuery = debounced.length === 1;
  const catalogIds = useMemo(() => new Set(catalog.map(item => item.slug)), [catalog]);
  const saveSession = useCallback(() => {
    if (loadedIds.current.length) rememberExplore(sessionKey, { ids: loadedIds.current, cursor: { ...cursor.current }, hasMore: more.current, offset: viewport.current.offset });
  }, [sessionKey]);
  const loadMore = useCallback(async (manual = false) => {
    if (busy.current || !more.current) return;
    const version = generation.current;
    const abort = new AbortController(); controller.current = abort;
    busy.current = true; failed.current = false; setLoading(true); setError("");
    try {
      const page = await browse(options, cursor.current, abort.signal, manual);
      if (version !== generation.current) return;
      cursor.current = page.cursor; more.current = page.hasMore;
      loadedIds.current = [...new Set(refreshingFirst.current ? page.hasMore ? [...page.ids, ...loadedIds.current] : page.ids : [...loadedIds.current, ...page.ids])];
      refreshingFirst.current = false;
      saveSession();
      setIds(loadedIds.current); setHasMore(page.hasMore);
    } catch (failure) {
      if (!abort.signal.aborted && version === generation.current && !(failure instanceof Error && failure.name === "AbortError")) {
        failed.current = true;
        setError(failure instanceof Error ? failure.message : "Couldn’t load more titles. Cached stories remain available offline.");
      }
    } finally { if (version === generation.current) { busy.current = false; setLoading(false); setRefreshing(false); } }
  }, [browse, options, saveSession]);
  const prefetch = useCallback(() => {
    const { height, content, offset } = viewport.current;
    if (!failed.current && !loadedIds.current.some(id => !catalogIds.has(id)) && height > 0 && content > 0 && content - offset - height <= height) void loadMore();
  }, [loadMore, catalogIds]);
  useEffect(() => {
    const version = ++generation.current; controller.current?.abort(); busy.current = true;
    const cached = exploreSession(sessionKey);
    const refresh = reload > 0 || sourceSessionRevision > 0;
    cursor.current = cached && !refresh ? { ...cached.cursor } : { ...FIRST_PAGE };
    loadedIds.current = cached?.ids || []; more.current = refresh || (cached?.hasMore ?? true); failed.current = false;
    refreshingFirst.current = refresh && Boolean(cached);
    const offset = cached?.offset || 0;
    viewport.current = { height: viewport.current.height, content: 0, offset };
    restoreOffset.current = offset;
    // Paint cached results before starting a source request.
    const timer = setTimeout(() => {
      if (version !== generation.current) return;
      busy.current = false; setIds(cached?.ids || null); setHasMore(more.current); setError("");
      if (shortQuery) { more.current = false; setHasMore(false); setRefreshing(false); }
      else if (!cached || refresh) void loadMore(refresh);
    }, 0);
    return () => { clearTimeout(timer); saveSession(); generation.current = version + 1; controller.current?.abort(); };
  }, [loadMore, reload, sourceSessionRevision, sessionKey, saveSession, shortQuery]);
  // A filtered page may add no rows, so FlatList won't emit another end-reached event.
  useEffect(() => { if (!loading && ids !== null) prefetch(); }, [loading, ids, prefetch]);
  const allowed = ids === null ? null : new Set(ids);
  const filtered = filterDiscovery(catalog, preferences, saved).filter(item => (!allowed || allowed.has(item.slug)) && (!debounced || item.title.toLowerCase().includes(debounced.toLowerCase())));
  const sourceOrder = new Map((ids || []).map((id, index) => [id, index]));
  const visible = alternate && preferences.sort !== "title"
    ? filtered.sort((a, b) => (sourceOrder.get(a.slug) ?? a.sourceRank ?? 9999) - (sourceOrder.get(b.slug) ?? b.sourceRank ?? 9999))
    : preferences.sort === "trending" && !debounced
    ? filtered.filter(item => item.popularRanks?.[preferences.period]).sort((a, b) => a.popularRanks![preferences.period]! - b.popularRanks![preferences.period]!)
    : sortExplore(filtered, preferences.sort, preferences.weights);
  const waitingForCatalog = Boolean(ids?.length && ids.some(id => !catalogIds.has(id)));
  return <SafeAreaView style={ui.safe} edges={["top"]}><FlatList ref={list}
    data={visible} numColumns={2} keyExtractor={item => item.slug} renderItem={({ item }) => <SeriesCard item={item} grid />}
    columnWrapperStyle={{ paddingHorizontal: 22, justifyContent: "space-between" }} contentContainerStyle={{ paddingBottom: 26 }}
    initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5} keyboardShouldPersistTaps="handled"
    onLayout={event => { viewport.current.height = event.nativeEvent.layout.height; prefetch(); }}
    onContentSizeChange={(_, height) => {
      viewport.current.content = height;
      if (restoreOffset.current !== null && (restoreOffset.current === 0 || height >= restoreOffset.current + viewport.current.height || (!loading && ids !== null))) {
        const offset = Math.min(restoreOffset.current, Math.max(0, height - viewport.current.height));
        viewport.current.offset = offset; list.current?.scrollToOffset({ offset, animated: false }); restoreOffset.current = null;
      }
      prefetch();
    }}
    onScroll={event => { if (restoreOffset.current === null) { viewport.current.offset = event.nativeEvent.contentOffset.y; saveSession(); } prefetch(); }} scrollEventThrottle={100}
    onEndReached={prefetch} onEndReachedThreshold={1}
    refreshing={refreshing} onRefresh={() => { saveSession(); setRefreshing(true); setReload(value => value + 1); }}
    ListHeaderComponent={<><PageHeading title="Explore" subtitle="FIND SOMETHING TO READ" />
      <View style={[ui.row, { marginHorizontal: 22, paddingHorizontal: 15, backgroundColor: color.surface, borderRadius: 13, marginBottom: 12 }]}><Icon name="search-outline" tint={color.muted} /><TextInput accessibilityLabel="Search selected source" placeholder={alternate ? "Search this source" : "Search comics and novels"} returnKeyType="search" onSubmitEditing={() => { setDebounced(query.trim()); setReload(value => value + 1); }} placeholderTextColor={color.muted} value={query} onChangeText={value => { setQuery(value); rememberExploreQuery(provider, value); }} style={{ flex: 1, height: 50, color: color.text }} />{(loading || query.trim() !== debounced) && <ActivityIndicator accessibilityLabel="Loading titles" size="small" color={color.lilac} />}</View>
      {shortQuery && <Text style={[ui.muted, {marginHorizontal:22, marginBottom:8}]}>Type at least 2 characters to search this source.</Text>}
      <DiscoveryControls /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ui.chips}>{(readerSite ? ([["smart", "Popular"], ["updated", "Latest updates"], ["title", "A–Z"]] as [SortOrder, string][]) : webtoon ? ([["smart", "Popular"], ...(preferences.webtoonCollection === "canvas" ? [] : [["trending", "Trending"]]), ["title", "A–Z"]] as [SortOrder, string][]) : SORTS).map(([value, label]) => <Chip key={value} text={label} active={effectiveSort === value} onPress={() => updatePreferences({ sort: value })} />)}</ScrollView>
      {!alternate && preferences.sort === "trending" && <View style={{ marginHorizontal: 22, marginBottom: 18 }}><PopularPeriods /></View>}
      {webtoon && <Text style={[ui.muted, { fontSize: 11, marginHorizontal: 22, marginBottom: 14 }]}>Search {preferences.webtoonCollection === "canvas" ? "Canvas" : "Originals"} in the selected language. Rankings use WEBTOON’s current lists; A–Z sorts loaded titles.</Text>}
      {!alternate && (preferences.sort === "smart" || preferences.sort === "chapters") && <Text style={[ui.muted, { fontSize: 11, marginHorizontal: 22, marginBottom: 14 }]}>Sorting applies to loaded titles. Scroll to discover more.</Text>}
    </>}
    ListEmptyComponent={loading || waitingForCatalog ? <View accessibilityLabel="Loading story previews" style={{ padding: 22, gap: 18 }}>{[0, 1, 2].map(index => <View key={index} style={{ height: 160, backgroundColor: color.surface, borderRadius: 16 }} />)}</View> : !hasMore ? <Text style={[ui.empty, { paddingHorizontal: 22 }]}>Nothing matches these filters. Try adjusting them.</Text> : null}
    ListFooterComponent={<View style={{ paddingHorizontal: 22, paddingVertical: 20, alignItems: "center", gap: 10 }}>
      {loading ? <View accessibilityLiveRegion="polite" style={ui.row}><ActivityIndicator color={color.lilac} /><Text style={ui.muted}>{ids === null ? "Finding stories…" : "Loading more stories…"}</Text></View> : <>
        {error ? <Text style={[ui.muted, { textAlign: "center" }]}>{error}</Text> : null}
        {preferences.source === "mangakakalot" && /verification/i.test(error) && <Pressable onPress={() => router.push("/verify-source")} style={[ui.primary, { minWidth: 160 }]}><Text style={ui.primaryText}>Verify source</Text></Pressable>}
        {error && hasMore ? <Pressable accessibilityLabel="Retry loading titles" onPress={() => void loadMore(true)} style={[ui.chip, { minWidth: 160, alignItems: "center" }]}><Text style={{ color: color.lilac }}>Retry</Text></Pressable> : !hasMore ? <Text style={ui.muted}>{preferences.sort === "trending" && !debounced ? "End of this ranking" : "You’ve reached the end"}</Text> : null}
      </>}
    </View>}
  /></SafeAreaView>;
}



