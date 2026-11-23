import { Pressable } from "../../components/pressable";
import { LinearGradient } from "expo-linear-gradient";
import { openSeries } from "../../components/series-card";
import { networkGuard } from "../../lib/network";
import type { BrowseCursor } from "../../lib/scraper";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useShelf } from "../../lib/app-state";
import { readingHistory } from "../../lib/storage";
import { filterDiscovery, kindOf, resumeTarget, type Series } from "../../lib/parser";
import { color, Cover, PageHeading, ui } from "../../components/ui";
import { RefreshBar } from "../../components/refresh-bar";
import { DiscoveryControls, PopularPeriods } from "../../components/discovery-controls";
import { AppUpdateNotice } from "../../components/app-update-notice";
import { ReadingShortcut } from "../../components/reading-shortcut";
import { ReleaseFeed } from "../../components/release-feed";
import { StoryRow } from "../../components/story-row";
import { FIRST_PAGE } from "../../lib/scraper";
import { providerInfo } from "../../lib/provider-info";

export default function Home() {
  const { catalog, preferences, saved, read, browse, browseFeatured, sourceSessionRevision, sync, refreshing } = useShelf();
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const alternate = providerInfo(preferences.source).rankOrder === "source";
  useEffect(() => {
    if (!alternate) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSourceLoading(true); setSourceError("");
      void browse({ source: preferences.source, language: preferences.webtoonLanguage, collection: preferences.webtoonCollection, mode: "comics", sort: "smart", period: "week", query: "", refresh: sourceSessionRevision > 0 }, { ...FIRST_PAGE }, controller.signal).catch(error => { if (!controller.signal.aborted && !(error instanceof Error && error.name === "AbortError")) setSourceError(error instanceof Error ? error.message : "Could not refresh this source."); }).finally(() => { if (!controller.signal.aborted) setSourceLoading(false); });
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [alternate, preferences.source, preferences.webtoonLanguage, preferences.webtoonCollection, browse, sourceSessionRevision]);
  const latestOptions = useMemo(() => ({
    source: preferences.source, language: preferences.webtoonLanguage, collection: preferences.webtoonCollection,
    mode: preferences.contentMode, sort: "updated" as const, period: "week" as const, query: "",
  }), [preferences.source, preferences.webtoonLanguage, preferences.webtoonCollection, preferences.contentMode]);
  const cursor = useRef<BrowseCursor>(FIRST_PAGE);
  const request = useRef<AbortController | null>(null);
  const featuredRequest = useRef<AbortController | null>(null);
  const featuredReady = useRef(false);
  const refreshRequest = useRef<AbortController | null>(null);
  const canPage = useRef(true);
  const latestFocus = useRef(false);
  const latestScope = useRef("");
  const firstPageReady = useRef(false);
  const endRequestSize = useRef<number | null>(null);
  const [latestIds, setLatestIds] = useState<string[]>([]);
  const [latestLoading, setLatestLoading] = useState(false);
  const [pullProgress, setPullProgress] = useState<number | null>(null);
  const [latestError, setLatestError] = useState<"first" | "next" | null>(null);
  const [moreLatest, setMoreLatest] = useState(true);

  const loadLatest = useCallback(async (manual = false, restart = false, access?: () => Promise<void>) => {
    if (!restart && (request.current || (!manual && !canPage.current))) return;
    if (restart) {
      request.current?.abort();
      endRequestSize.current = null;
    }
    const controller = new AbortController();
    request.current = controller;
    setLatestLoading(true);
    setLatestError(null);
    try {
      const page = await browse({ ...latestOptions, refresh: restart && manual }, restart ? FIRST_PAGE : cursor.current, controller.signal, manual, access);
      if (controller.signal.aborted) return;
      firstPageReady.current = true;
      cursor.current = page.cursor;
      canPage.current = page.hasMore;
      setMoreLatest(page.hasMore);
      setLatestIds(current => [...new Set(restart ? page.ids : [...current, ...page.ids])]);
    } catch {
      if (!controller.signal.aborted) { canPage.current = false; setLatestError(restart ? "first" : "next"); }
    } finally {
      if (request.current === controller) { request.current = null; if (latestFocus.current) setLatestLoading(false); }
    }
  }, [browse, latestOptions]);

  const loadFeatured = useCallback(async (access?: () => Promise<void>) => {
    if (preferences.source !== "asura") return;
    featuredRequest.current?.abort();
    const controller = new AbortController();
    featuredRequest.current = controller;
    try {
      await browseFeatured(controller.signal, access);
      if (!controller.signal.aborted) featuredReady.current = true;
    } catch {
      // Existing featured stories remain available while the source is unavailable.
    }
  }, [browseFeatured, preferences.source]);

  useFocusEffect(useCallback(() => {
    latestFocus.current = true;
    const scope = JSON.stringify([latestOptions, sourceSessionRevision]);
    if (latestScope.current !== scope) {
      latestScope.current = scope;
      firstPageReady.current = false;
      featuredReady.current = false;
      cursor.current = FIRST_PAGE;
      canPage.current = true;
      setLatestIds([]);
      setMoreLatest(true);
    }
    if (!firstPageReady.current) void loadLatest(false, true);
    if (!featuredReady.current) void loadFeatured();
    return () => {
      latestFocus.current = false;
      request.current?.abort();
      if (featuredRequest.current) {
        featuredRequest.current.abort();
        featuredRequest.current = null;
      }
      refreshRequest.current?.abort();
      refreshRequest.current = null;
      request.current = null;
      endRequestSize.current = null;
      setLatestLoading(false);
      setPullProgress(null);
    };
  }, [latestOptions, loadLatest, loadFeatured, sourceSessionRevision]));

  async function refresh() {
    if (refreshRequest.current) return;
    const controller = new AbortController();
    refreshRequest.current = controller;
    setPullProgress(0);
    const access = networkGuard("Refresh Home and check for new chapters?");
    const rankingOptions = alternate
      ? { ...latestOptions, mode: "comics" as const, sort: "smart" as const }
      : { ...latestOptions, mode: "all" as const, sort: "trending" as const, period: preferences.period };
    const rankings = browse({ ...rankingOptions, refresh: true }, FIRST_PAGE, controller.signal, true, access);
    const tasks = [loadLatest(true, true, access), loadFeatured(access), rankings, sync(false, true, access)];
    let completed = 0;
    await Promise.allSettled(tasks.map(task => task.finally(() => {
      completed += 1;
      if (refreshRequest.current === controller) setPullProgress(Math.round(completed / tasks.length * 100));
    })));
    if (refreshRequest.current === controller) {
      refreshRequest.current = null;
      setPullProgress(null);
    }
  }
  useFocusEffect(useCallback(() => {
    if (alternate) return;
    const controller = new AbortController();
    void browse({ source: "asura", mode: "all", sort: "trending", period: preferences.period, query: "" }, FIRST_PAGE, controller.signal).catch(() => {});
    return () => controller.abort();
  }, [alternate, browse, preferences.period]));
  const [history, setHistory] = useState(readingHistory);
  useFocusEffect(useCallback(() => { setHistory(readingHistory()); }, []));
  const visible = useMemo(() => filterDiscovery(catalog, preferences, saved), [catalog, preferences, saved]);
  const recent = useMemo(() => {
    let latest: { item: typeof catalog[number]; chapter: string; at: string } | undefined;
    for (const item of catalog) {
      const position = history[item.slug];
      const at = position?.readAt || "";
      if (latest && at <= latest.at) continue;
      const chapter = resumeTarget(item, position, read[item.slug]);
      if (chapter) latest = { item, chapter, at };
    }
    return latest;
  }, [catalog, history, read]);
  const latest = useMemo(() => {
    if (!latestIds.length) return visible.filter(item => item.updatedAt).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).slice(0, 12);
    const byId = new Map(visible.map(item => [item.slug, item]));
    return latestIds.flatMap(id => byId.get(id) ?? []);
  }, [latestIds, visible]);
  const catalogIds = useMemo(() => new Set(catalog.map(item => item.slug)), [catalog]);
  const waitingForLatest = useMemo(() => latestIds.some(id => !catalogIds.has(id)), [latestIds, catalogIds]);
  const loadAtEnd = useCallback(() => {
    if (!latestFocus.current || request.current || !canPage.current) return;
    endRequestSize.current = latest.length;
    if (!waitingForLatest) void loadLatest();
  }, [latest.length, loadLatest, waitingForLatest]);
  useEffect(() => {
    if (latestLoading || waitingForLatest || endRequestSize.current === null) return;
    const previousSize = endRequestSize.current;
    endRequestSize.current = null;
    // A page whose rows are filtered out does not change the list's end position.
    if (previousSize === latest.length) loadAtEnd();
  }, [latest.length, latestLoading, loadAtEnd, waitingForLatest]);
  const featured = useMemo(() => preferences.source === "asura"
    ? catalog.filter(item => item.featuredRank).sort((a, b) => a.featuredRank! - b.featuredRank!)
    : [], [catalog, preferences.source]);
  const ranked = useMemo(() => ({
    alternate: visible.filter(item => item.sourceRank).sort((a, b) => a.sourceRank! - b.sourceRank!).slice(0, 20),
    comic: visible.filter(item => kindOf(item) === "comic" && item.popularRanks?.[preferences.period]).sort((a, b) => a.popularRanks![preferences.period]! - b.popularRanks![preferences.period]!),
    novel: visible.filter(item => kindOf(item) === "novel" && item.popularRanks?.[preferences.period]).sort((a, b) => a.popularRanks![preferences.period]! - b.popularRanks![preferences.period]!),
  }), [visible, preferences.period]);
  const lead = featured[0];
  const header = <>
    <PageHeading title="NightShelf" subtitle="COMICS & NOVELS" />
    <AppUpdateNotice />
    <DiscoveryControls />
    {recent && <ReadingShortcut key={recent.item.slug} item={recent.item} chapter={recent.chapter}/>}
    <ReleaseFeed />
    {lead && <View style={ui.section}>
      <Pressable accessibilityLabel={`Hot today: ${lead.title}`} onPress={() => openSeries(lead)}
        style={{ backgroundColor: "#24183e", borderColor: "#b99cff40", borderWidth: 1, borderRadius: 20, overflow: "hidden" }}>
        <LinearGradient colors={["#201533", "#3a2466", "#6441a5"]} locations={[0, 0.55, 1]}
          start={{ x: 0, y: 0.85 }} end={{ x: 1, y: 0.1 }}
          style={{ padding: 18, gap: 15, flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Text style={[ui.eyebrow, { color: "#d9c2ff" }]}>Hot today</Text>
            <Text numberOfLines={3} style={{ color: color.text, fontSize: 25, fontWeight: "900" }}>{lead.title}</Text>
            <Text style={{ color: "#e6d5ff", marginTop: 12, fontSize: 13, fontWeight: "700" }}>View story</Text>
          </View>
          <Cover item={lead} style={{ width: 98, height: 136, borderRadius: 12 }} />
        </LinearGradient>
      </Pressable>
      <FlatList horizontal data={featured.slice(1)} keyExtractor={item => item.slug} showsHorizontalScrollIndicator={false}
        initialNumToRender={5} contentContainerStyle={{ gap: 12, paddingVertical: 12 }}
        renderItem={({item}) => <Pressable accessibilityLabel={item.title} onPress={() => openSeries(item)} style={{ width: 112 }}>
          <Cover item={item} style={{ width: 112, height: 148, borderRadius: 12 }} />
          <Text numberOfLines={2} style={[ui.text, { fontWeight: "700", marginTop: 6 }]}>{item.title}</Text>
        </Pressable>} />
    </View>}
    <View style={ui.section}><Text style={ui.title}>{alternate ? "Trending" : "Trending by period"}</Text>{alternate ? <>{sourceError ? <Text style={ui.empty}>{sourceError}</Text> : null}{ranked.alternate.map(item => <StoryRow key={item.slug} item={item} rank={item.sourceRank} />)}{!sourceLoading && !sourceError && !ranked.alternate.length && <Text style={ui.empty}>No matches. Adjust filters or open Explore for more stories.</Text>}</> : <><PopularPeriods />
      {(["comic", "novel"] as const).filter(kind => preferences.contentMode === "all" || kind === (preferences.contentMode === "novels" ? "novel" : "comic")).map(kind => {
        const stories = ranked[kind];
        return <View key={kind}><Text style={[ui.title, { fontSize: 18, marginTop: 16 }]}>{kind === "novel" ? "Trending novels" : "Trending comics"}</Text>{stories.map(item => <StoryRow key={item.slug} item={item} rank={item.popularRanks![preferences.period]} />)}{!stories.length && <Text style={ui.empty}>No matching {kind === "novel" ? "novels" : "comics"} for this period. Adjust your filters or pull down to refresh.</Text>}</View>;
      })}</>}
    </View>
    <Text style={[ui.section, ui.title]}>Latest updates</Text>
  </>;
  const footer = latestError || moreLatest
    ? <Pressable disabled={latestLoading} onPress={() => void loadLatest(true, latestError === "first")} style={{paddingVertical: 14}}>
      <Text style={{color: latestLoading ? color.muted : color.lilac}}>{latestError ? "Retry latest updates" : "Load more stories"}</Text>
    </Pressable>
    : !latestLoading && !latest.length ? <Text style={ui.empty}>No updates match these filters.</Text> : null;
  return <SafeAreaView style={ui.safe} edges={["top"]}><View style={{flex:1}}>
    <FlatList
      data={latest}
      keyExtractor={item => item.slug}
      renderItem={renderLatestStory}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListFooterComponentStyle={{paddingHorizontal: 20}}
      contentContainerStyle={ui.page}
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      windowSize={5}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      onEndReached={loadAtEnd}
      onEndReachedThreshold={0.75}
      scrollEventThrottle={120}
      onScroll={({nativeEvent: {contentOffset, contentSize, layoutMeasurement}}) => {
        if (contentSize.height - contentOffset.y - layoutMeasurement.height > layoutMeasurement.height) endRequestSize.current = null;
      }}
      refreshControl={<RefreshControl refreshing={pullProgress !== null || refreshing} onRefresh={() => void refresh()} tintColor="transparent" colors={["transparent"]} progressBackgroundColor="transparent" />}
    />
    <RefreshBar loading={latestLoading || waitingForLatest || sourceLoading} batchProgress={pullProgress ?? undefined} />
  </View></SafeAreaView>;
}

function renderLatestStory({ item }: { item: Series }) {
  return <View style={{paddingHorizontal: 20}}><StoryRow item={item} /></View>;
}
