import { Pressable } from "../../components/pressable";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useShelf } from "../../lib/app-state";
import { readingHistory } from "../../lib/storage";
import { filterDiscovery, kindOf, resumeTarget } from "../../lib/parser";
import { color, Icon, Page, ui } from "../../components/ui";
import { DiscoveryControls, PopularPeriods } from "../../components/discovery-controls";
import { ReadingShortcut } from "../../components/reading-shortcut";
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
  const recent = [...catalog].filter(item => resumeTarget(item,history[item.slug],read[item.slug])).sort((a,b)=>(Date.parse(history[b.slug]?.readAt || "")||0)-(Date.parse(history[a.slug]?.readAt || "")||0))[0];
  const latest = [...visible].filter(item => item.updatedAt).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).slice(0, 8);
  return <Page title="NightShelf" subtitle="COMICS & NOVELS" action={<Pressable accessibilityLabel="Search stories" onPress={() => router.navigate("/explore")} style={{ padding: 12 }}><Icon name="search-outline" /></Pressable>}>
    <DiscoveryControls />
    {recent && <ReadingShortcut key={recent.slug} item={recent} chapter={resumeTarget(recent,history[recent.slug],read[recent.slug])!}/>}
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


