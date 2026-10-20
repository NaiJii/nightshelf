import { Pressable } from "../../components/pressable";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useShelf } from "../../lib/app-state";
import { readingHistory } from "../../lib/storage";
import { filterDiscovery, kindOf, nextUnread } from "../../lib/parser";
import { color, Cover, Icon, Page, ui } from "../../components/ui";
import { DiscoveryControls, PopularPeriods } from "../../components/discovery-controls";
import { ReleaseFeed } from "../../components/release-feed";
import { StoryRow } from "../../components/story-row";
import { FIRST_PAGE } from "../../lib/scraper";

export default function Home() {
  const { catalog, preferences, saved, read, browse, sourceSessionRevision } = useShelf();
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const alternate = Boolean(preferences.source && preferences.source !== "asura");
  useEffect(() => {
    if (!alternate) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSourceLoading(true); setSourceError("");
      void browse({ source: preferences.source, language: preferences.webtoonLanguage, collection: preferences.webtoonCollection, mode: "comics", sort: "smart", period: "week", query: "", refresh: sourceSessionRevision > 0 }, { ...FIRST_PAGE }, controller.signal).catch(error => { if (!controller.signal.aborted && !(error instanceof Error && error.name === "AbortError")) setSourceError(error instanceof Error ? error.message : "Could not refresh this source."); }).finally(() => { if (!controller.signal.aborted) setSourceLoading(false); });
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [alternate, preferences.source, preferences.webtoonLanguage, preferences.webtoonCollection, browse, sourceSessionRevision]);
  const [history, setHistory] = useState(readingHistory);
  useFocusEffect(useCallback(() => { setHistory(readingHistory()); }, []));
  const visible = filterDiscovery(catalog, preferences, saved);
  const resume = (slug: string, chapters: string[] = []) => nextUnread(chapters, history[slug], read[slug]);
  const activity = useMemo(() => new Map(catalog.map(item => [item.slug, Object.values(read[item.slug] || {}).reduce((latest, date) => Math.max(latest, Date.parse(date) || 0), Date.parse(history[item.slug]?.readAt || "") || 0)])), [catalog, history, read]);
  const recent = catalog.filter(item => activity.get(item.slug) && resume(item.slug, item.localChapters)).sort((a, b) => activity.get(b.slug)! - activity.get(a.slug)!).slice(0, 2);
  const latest = [...visible].filter(item => item.updatedAt).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).slice(0, 8);
  return <Page title="NightShelf" subtitle="COMICS & NOVELS" action={<Pressable accessibilityLabel="Search stories" onPress={() => router.navigate("/explore")} style={{ padding: 12 }}><Icon name="search-outline" /></Pressable>}>
    <DiscoveryControls />
    {recent.length > 0 && <View style={ui.section}><Text style={ui.title}>Continue reading</Text>{recent.map(item => <Pressable key={item.slug} style={[ui.row, { marginTop: 16, paddingBottom: 16, borderBottomWidth: 1, borderColor: color.line }]} onPress={() => router.push({ pathname: "/reader/[slug]/[chapter]", params: { slug: item.slug, chapter: resume(item.slug, item.localChapters)!, title: item.title } })}><Cover item={item} style={{ width: 65, height: 92, borderRadius: 10 }} /><View style={{ flex: 1 }}><Text numberOfLines={2} style={{ color: color.text, fontWeight: "700" }}>{item.title}</Text><Text style={ui.muted}>Chapter {resume(item.slug, item.localChapters)}</Text></View><Icon name="play-circle-outline" tint={color.lilac} size={28} /></Pressable>)}</View>}
    <ReleaseFeed />
    <View style={ui.section}><Text style={ui.title}>Popular</Text>{alternate ? <>{sourceLoading && <View style={[ui.row, { paddingVertical: 15 }]}><ActivityIndicator color={color.lilac} /><Text style={ui.muted}>Loading stories…</Text></View>}{sourceError ? <Text style={ui.empty}>{sourceError}</Text> : null}{visible.filter(item => item.sourceRank).sort((a, b) => a.sourceRank! - b.sourceRank!).slice(0, 20).map(item => <StoryRow key={item.slug} item={item} rank={item.sourceRank} />)}{!sourceLoading && !sourceError && !visible.some(item => item.sourceRank) && <Text style={ui.empty}>No matches. Adjust filters or open Explore for more stories.</Text>}</> : <><PopularPeriods />
      {(["comic", "novel"] as const).filter(kind => preferences.contentMode === "all" || kind === (preferences.contentMode === "novels" ? "novel" : "comic")).map(kind => {
        const ranked = visible.filter(item => kindOf(item) === kind && item.popularRanks?.[preferences.period]).sort((a, b) => a.popularRanks![preferences.period]! - b.popularRanks![preferences.period]!);
        return <View key={kind}>{preferences.contentMode === "all" && <Text style={[ui.eyebrow, { marginTop: 22 }]}>{kind === "novel" ? "NOVELS" : "COMICS"}</Text>}{ranked.map(item => <StoryRow key={item.slug} item={item} rank={item.popularRanks![preferences.period]} />)}{!ranked.length && <Text style={ui.empty}>No matching {kind === "novel" ? "novels" : "comics"} for this period. Adjust your filters or pull down to refresh.</Text>}</View>;
      })}</>}
    </View>
    <View style={ui.section}><Text style={ui.title}>Latest updates</Text>{latest.map(item => <StoryRow key={item.slug} item={item} />)}{!latest.length && <Text style={ui.empty}>Pull down to load the latest releases.</Text>}</View>
  </Page>;
}


