import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useShelf } from "../../lib/app-state";
import { filterDiscovery, SortOrder, sortExplore } from "../../lib/parser";
import { FIRST_PAGE } from "../../lib/scraper";
import type { BrowseOptions } from "../../lib/scraper";
import { Chip, color, Icon, PageHeading, ui } from "../../components/ui";
import { SeriesCard } from "../../components/series-card";
import { DiscoveryControls, PopularPeriods } from "../../components/discovery-controls";

const SORTS: [SortOrder, string][] = [["smart", "For you"], ["trending", "Popular"], ["rating", "Top rated"], ["updated", "Latest updates"], ["chapters", "Long reads"], ["title", "A–Z"]];
export default function Explore() {
  const { catalog, preferences, saved, browse, updatePreferences, sync, refreshing, sourceSessionRevision } = useShelf();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [reload, setReload] = useState(0);
  const [ids, setIds] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const cursor = useRef({ ...FIRST_PAGE });
  const loadedIds = useRef<string[]>([]);
  const more = useRef(true);
  useEffect(() => { const timer = setTimeout(() => setDebounced(query.trim()), 450); return () => clearTimeout(timer); }, [query]);
  const webtoon = preferences.source === "webtoon";
  const readerSite = preferences.source === "vortex" || preferences.source === "mangakakalot";
  const alternate = webtoon || readerSite;
  const effectiveSort = readerSite && !["updated", "title"].includes(preferences.sort) ? "smart" : webtoon && (preferences.sort !== "title" && (preferences.sort !== "trending" || preferences.webtoonCollection === "canvas")) ? "smart" : preferences.sort;
  const options: BrowseOptions = useMemo(() => ({ source: preferences.source, language: preferences.webtoonLanguage, collection: preferences.webtoonCollection, mode: preferences.contentMode, sort: effectiveSort, period: preferences.period, query: debounced.length >= 2 ? debounced : "", refresh: reload > 0 || sourceSessionRevision > 0 }), [preferences.source, preferences.webtoonLanguage, preferences.webtoonCollection, preferences.contentMode, effectiveSort, preferences.period, debounced, reload, sourceSessionRevision]);
  const loadMore = useCallback(async (manual = false) => {
    if (busy.current || !more.current) return;
    const version = generation.current;
    const abort = new AbortController(); controller.current = abort;
    busy.current = true; setLoading(true); setError("");
    try {
      const page = await browse(options, cursor.current, abort.signal, manual);
      if (version !== generation.current) return;
      cursor.current = page.cursor; more.current = page.hasMore;
      loadedIds.current = [...new Set([...loadedIds.current, ...page.ids])];
      setIds(loadedIds.current); setHasMore(page.hasMore);
    } catch (failure) {
      if (!abort.signal.aborted && version === generation.current && !(failure instanceof Error && failure.name === "AbortError")) setError(failure instanceof Error ? failure.message : "Couldn’t load more titles. Cached stories remain available offline.");
    } finally { if (version === generation.current) { busy.current = false; setLoading(false); } }
  }, [browse, options]);
  useEffect(() => {
    const version = ++generation.current; controller.current?.abort(); busy.current = true;
    cursor.current = { ...FIRST_PAGE }; loadedIds.current = []; more.current = true;
    // Let changed filters paint before starting a new network page.
    const timer = setTimeout(() => { if (version !== generation.current) return; busy.current = false; setIds(null); setHasMore(true); setError(""); void loadMore(); }, 0);
    return () => { clearTimeout(timer); generation.current = version + 1; controller.current?.abort(); };
  }, [loadMore]);
  const allowed = ids === null ? null : new Set(ids);
  const filtered = filterDiscovery(catalog, preferences, saved).filter(item => (!allowed || allowed.has(item.slug)) && (!debounced || item.title.toLowerCase().includes(debounced.toLowerCase())));
  const sourceOrder = new Map((ids || []).map((id, index) => [id, index]));
  const visible = alternate && preferences.sort !== "title"
    ? filtered.sort((a, b) => (sourceOrder.get(a.slug) ?? a.sourceRank ?? 9999) - (sourceOrder.get(b.slug) ?? b.sourceRank ?? 9999))
    : preferences.sort === "trending" && !debounced
    ? filtered.filter(item => item.popularRanks?.[preferences.period]).sort((a, b) => a.popularRanks![preferences.period]! - b.popularRanks![preferences.period]!)
    : sortExplore(filtered, preferences.sort, preferences.weights);
  return <SafeAreaView style={ui.safe} edges={["top"]}><FlatList
    data={visible} numColumns={2} keyExtractor={item => item.slug} renderItem={({ item }) => <SeriesCard item={item} grid />}
    columnWrapperStyle={{ paddingHorizontal: 22, justifyContent: "space-between" }} contentContainerStyle={{ paddingBottom: 26 }}
    initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5} keyboardShouldPersistTaps="handled"
    onEndReached={() => { if (!error) void loadMore(); }} onEndReachedThreshold={0.6}
    refreshing={refreshing} onRefresh={() => { setReload(value => value + 1); void sync(); }}
    ListHeaderComponent={<><PageHeading title="Explore" subtitle="FIND SOMETHING TO READ" />
      <View style={[ui.row, { marginHorizontal: 22, paddingHorizontal: 15, backgroundColor: color.surface, borderRadius: 13, marginBottom: 12 }]}><Icon name="search-outline" tint={color.muted} /><TextInput accessibilityLabel="Search selected source" placeholder={alternate ? "Search this source" : "Search comics and novels"} returnKeyType="search" onSubmitEditing={() => { setDebounced(query.trim()); setReload(value => value + 1); }} placeholderTextColor={color.muted} value={query} onChangeText={setQuery} style={{ flex: 1, height: 50, color: color.text }} />{(loading || query.trim() !== debounced) && <ActivityIndicator accessibilityLabel="Loading titles" size="small" color={color.lilac} />}</View>
      <DiscoveryControls /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ui.chips}>{(readerSite ? ([["smart", "Popular"], ["updated", "Latest updates"], ["title", "A–Z"]] as [SortOrder, string][]) : webtoon ? ([["smart", "Popular"], ...(preferences.webtoonCollection === "canvas" ? [] : [["trending", "Trending"]]), ["title", "A–Z"]] as [SortOrder, string][]) : SORTS).map(([value, label]) => <Chip key={value} text={label} active={effectiveSort === value} onPress={() => updatePreferences({ sort: value })} />)}</ScrollView>
      {!alternate && preferences.sort === "trending" && <View style={{ marginHorizontal: 22, marginBottom: 18 }}><PopularPeriods /></View>}
      {webtoon && <Text style={[ui.muted, { fontSize: 11, marginHorizontal: 22, marginBottom: 14 }]}>Search {preferences.webtoonCollection === "canvas" ? "Canvas" : "Originals"} in the selected language. Rankings use WEBTOON’s current lists; A–Z sorts loaded titles.</Text>}
      {!alternate && (preferences.sort === "smart" || preferences.sort === "chapters") && <Text style={[ui.muted, { fontSize: 11, marginHorizontal: 22, marginBottom: 14 }]}>Sorting applies to loaded titles. Scroll to discover more.</Text>}
    </>}
    ListEmptyComponent={!loading ? <Text style={[ui.empty, { paddingHorizontal: 22 }]}>Nothing matches these filters yet. Load more titles or adjust your filters.</Text> : null}
    ListFooterComponent={<View style={{ paddingHorizontal: 22, paddingVertical: 20, alignItems: "center", gap: 10 }}>
      {loading ? <View accessibilityLiveRegion="polite" style={ui.row}><ActivityIndicator color={color.lilac} /><Text style={ui.muted}>{ids === null ? "Finding stories…" : "Loading more stories…"}</Text></View> : <>
        {error ? <Text style={[ui.muted, { textAlign: "center" }]}>{error}</Text> : null}
        {preferences.source === "mangakakalot" && /verification/i.test(error) && <Pressable onPress={() => router.push("/verify-source")} style={[ui.primary, { minWidth: 160 }]}><Text style={ui.primaryText}>Verify source</Text></Pressable>}
        {hasMore ? <Pressable accessibilityLabel={error ? "Retry loading titles" : "Load more titles"} onPress={() => void loadMore(true)} style={[ui.chip, { minWidth: 160, alignItems: "center" }]}><Text style={{ color: color.lilac }}>{error ? "Retry" : "Load more"}</Text></Pressable> : <Text style={ui.muted}>{preferences.sort === "trending" && !debounced ? "End of this ranking" : "You’ve reached the end"}</Text>}
      </>}
    </View>}
  /></SafeAreaView>;
}



