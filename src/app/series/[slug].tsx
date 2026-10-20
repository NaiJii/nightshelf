import { ExpandableSummary } from "../../components/expandable-summary";
import { useActionSheet } from "../../components/action-sheet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useShelf } from "../../lib/app-state";
import { Chip, color, Cover, Icon, ui } from "../../components/ui";
import { PublicationStatus, SaveActions } from "../../components/story-row";
import { DownloadList } from "../../components/download-list";
import { chapterProgress, chapterList, chapterListCached, kindOf, nextUnread, sourceOf, formatRating } from "../../lib/parser";
import { readingHistory } from "../../lib/storage";
import { estimateDownload, formatBytes, freeBytes } from "../../lib/library-tools";
import { ReadingListAction, ReleaseActions } from "../../components/story-options";

function useDownloadEstimate(slug: string, count: number, novel: boolean, sampleIds: string) {
  return useMemo(() => estimateDownload(slug, count, novel, sampleIds ? sampleIds.split(",") : []), [slug, count, novel, sampleIds]);
}

export default function SeriesDetails() {
  const showSheet = useActionSheet();
  const { slug, filter: initialFilter } = useLocalSearchParams<{ slug: string; filter?: string }>();
  const { catalog, startDownload, downloads, loadDetails, detailsLoading, detailsErrors, notice, dismissNotice, read, setReadStatus, removeDownloads, deleting, downloadBusy, sourceSessionRevision } = useShelf();
  const [filter, setFilter] = useState(initialFilter === "downloaded" ? "saved" : initialFilter === "unread" ? "unread" : "all");
  const [query, setQuery] = useState("");
  const [newest, setNewest] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [history, setHistory] = useState(readingHistory);
  const listRef = useRef<FlatList<string>>(null);
  useFocusEffect(useCallback(() => { setHistory(readingHistory()); }, []));
  useEffect(() => { void loadDetails(slug); }, [loadDetails, slug, sourceSessionRevision]);
  const item = catalog.find(value => value.slug === slug);
  const owned = item?.localChapters || [];
  const ownedSet = new Set(owned);
  const all = chapterList(item?.chapterIds, owned);
  const available = new Set(all);
  const chosen = selected.filter(id => available.has(id));
  const missing = chosen.filter(id => !ownedSet.has(id));
  const sampleIds = owned.slice(-5).join(",");
  const novel = Boolean(item && kindOf(item) === "novel");
  const missingCount = missing.length;
  const estimate = useDownloadEstimate(slug, missingCount, novel, sampleIds);
  if (!item) return <SafeAreaView style={ui.safe}><Pressable onPress={() => router.back()}><Text style={ui.empty}>Back · story unavailable</Text></Pressable></SafeAreaView>;
  const rating = formatRating(item.rating);
  const ledger = read[slug] || {};
  const fullList = chapterListCached(item);
  const loadingChapters = detailsLoading.includes(slug);
  const chapterError = detailsErrors?.[slug];
  const visible = chapterList(item.chapterIds, owned, ledger, filter, query, newest, item.chapterTitles);
  const unread = chapterList(item.chapterIds, owned, ledger, "unread", "", false);
  const savedSelection = chosen.filter(id => ownedSet.has(id));
  const chosenSet = new Set(chosen);
  const job = downloads.find(value => value.series.slug === slug);
  const blocked = deleting || downloadBusy(slug) || Boolean(job && ["queued", "downloading", "waiting", "cancelling"].includes(job.status));
  const ascendingSaved = chapterList([], owned, {}, "all", "", false);
  const continuation = nextUnread(ascendingSaved, history[slug], ledger);
  const firstSaved = continuation || ascendingSaved[0];
  function open(chapter: string) { router.push({ pathname: "/reader/[slug]/[chapter]", params: { slug, chapter, title: item?.title } }); }
  function toggle(chapter: string) { setSelected(current => current.includes(chapter) ? current.filter(id => id !== chapter) : [...current, chapter]); }
  function mark(ids: string[]) {
    if (!ids.length) return;
    showSheet("Reading status", `${ids.length} chapter${ids.length === 1 ? "" : "s"}`, [
      { text: "Cancel", style: "cancel" },
      { text: "Mark read", onPress: () => { setReadStatus(slug, ids, true); setHistory(readingHistory()); setSelected([]); } },
      { text: "Mark unread", onPress: () => { setReadStatus(slug, ids, false); setHistory(readingHistory()); setSelected([]); } },
    ]);
  }
  function erase(ids: string[], everything = false) {
    if (!item) return;
    showSheet(everything ? "Delete all saved chapters?" : `Delete ${ids.length} saved chapters?`, "Reading history and bookmarks will stay. You can download the chapters again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => { void removeDownloads(item, ids, everything).then(ok => { if (ok) setSelected([]); }); } },
    ]);
  }
  function download() {
    if (!item || !missing.length) return;
    if (job) { showSheet("Download already listed", "Resume or cancel this story’s existing download using the controls above the chapter list before starting another selection."); return; }
    const run = () => { if (startDownload(item, missing.join(","))) setSelected([]); };
    if (missing.length > 20) showSheet(`Download ${missing.length} chapters?`, `Estimated ${formatBytes(estimate.bytes)} · ${formatBytes(freeBytes())} free. Downloads continue in the background.`, [{ text: "Cancel", style: "cancel" }, { text: "Download", onPress: run }]); else run();
  }
  return <SafeAreaView style={ui.safe} edges={["top", "bottom"]}>
    <View style={[ui.row, { paddingHorizontal: 10, borderBottomWidth: 1, borderColor: color.line }]}><Pressable accessibilityLabel="Back" onPress={() => router.back()} style={{ padding: 12 }}><Icon name="arrow-back" /></Pressable><Text numberOfLines={1} style={[ui.text, { flex: 1, fontWeight: "700" }]}>{item.title}</Text></View>
    <FlatList ref={listRef} data={visible} keyExtractor={id => id} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }} refreshControl={<RefreshControl refreshing={detailsLoading.includes(slug)} onRefresh={() => void loadDetails(slug, true)} tintColor={color.lilac} colors={[color.purple]} />}
      ListHeaderComponent={<>
        <View style={[ui.row, { marginTop: 24, alignItems: "flex-start" }]}><Cover item={item} style={{ width: 115, height: 165, borderRadius: 17 }} /><View style={{ flex: 1 }}><Text style={[ui.title, { fontSize: 25 }]}>{item.title}</Text><Text style={[ui.muted, { marginTop: 12 }]}>{item.type} · {item.chapterCount} chapters</Text><Text style={{ color: color.lilac, marginTop: 12, fontWeight: "800" }}>{rating ? `★ ${rating} · ` : ""}{item.bookmarks ? `${item.bookmarks} ${sourceOf(item) === "webtoon" ? "subscribers" : "saves"}` : ""}</Text></View></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingVertical: 10 }}>{item.genres?.map(tag => <View key={tag} style={[ui.chip, { minHeight: 30, paddingHorizontal: 10 }]}><Text style={{ color: color.muted, fontSize: 11 }}>{tag}</Text></View>)}</ScrollView>
        <PublicationStatus item={item} /><View style={[ui.row, { gap: 0, marginTop: 6, borderBottomWidth: 1, borderColor: color.line }]}><SaveActions item={item} labels iconsOnly /><ReadingListAction item={item} iconsOnly /><ReleaseActions item={item} /></View>
        {notice ? <Pressable onPress={dismissNotice} style={{ paddingVertical: 12 }}><Text style={ui.muted}>{notice} · Dismiss</Text></Pressable> : null}
        {sourceOf(item) === "mangakakalot" && /verification/i.test(chapterError || notice) && <Pressable onPress={() => router.push({ pathname: "/verify-source", params: { source: sourceOf(item) } })} style={{ paddingVertical: 12 }}><Text style={{ color: color.lilac }}>Verify source</Text></Pressable>}
        <ExpandableSummary key={`${slug}/${item.summary}`} text={item.summary || (detailsLoading.includes(slug) ? "Loading summary…" : "No summary available.")} />
        {firstSaved && <Pressable onPress={() => open(firstSaved)} style={[ui.primary, { marginTop: 18 }]}><Text style={ui.primaryText}>{continuation ? `Continue reading · ${item.chapterTitles?.[firstSaved] || `Chapter ${firstSaved}`}` : `Read again · ${item.chapterTitles?.[firstSaved] || `Chapter ${firstSaved}`}`}</Text></Pressable>}
        <DownloadList slug={slug} />
        <View style={[ui.row, { marginTop: 18, justifyContent: "space-between" }]}><Text style={ui.title}>Chapters</Text><Pressable accessibilityLabel="Chapter actions" onPress={() => showSheet("Chapter actions", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Mark all read / unread", onPress: () => mark(all) }, ...(item.hasLocalFiles ? [{ text: "Delete all saved files", style: "destructive" as const, onPress: () => { if (blocked) showSheet("Download in progress", "Pause or cancel this story’s download first."); else erase([], true); } }] : [])])} style={{ padding: 12 }}><Icon name="ellipsis-horizontal" /></Pressable></View>
        <Text style={[ui.muted, { fontSize: 12 }]}>{owned.length} saved · {all.filter(id => ledger[id]).length} read · {all.length} {fullList ? "available" : "loaded"}</Text>
        {loadingChapters && <View accessibilityLiveRegion="polite" style={[ui.row, { paddingVertical: 12 }]}><ActivityIndicator size="small" color={color.lilac} /><Text style={ui.muted}>{fullList ? "Refreshing chapters…" : "Loading chapters…"}</Text></View>}
        {chapterError && !loadingChapters && <View accessibilityLiveRegion="polite" style={{ paddingVertical: 12 }}><Text style={{ color: "#f08080", fontSize: 12 }}>{chapterError}</Text><Pressable accessibilityLabel="Retry loading chapters" onPress={() => void loadDetails(slug, true)} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}><Text style={{ color: color.lilac, fontWeight: "700" }}>Retry chapters</Text></Pressable></View>}
        <TextInput accessibilityLabel="Search chapters" placeholder="Find a chapter…" placeholderTextColor={color.muted} value={query} onChangeText={setQuery} style={{ color: color.text, padding: 14, borderRadius: 12, backgroundColor: color.surface, marginTop: 14 }} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginVertical: 12 }}>{[["all", "All"], ["unread", "Unread"], ["saved", "Saved"]].map(([key, label]) => <Chip key={key} text={label} active={filter === key} onPress={() => setFilter(key)} />)}<Pressable accessibilityLabel={`Chapter order: ${newest ? "newest first" : "oldest first"}. Tap to reverse.`} onPress={() => setNewest(value => !value)} style={[ui.chip, ui.row]}><Icon name="swap-vertical-outline" size={16} tint={color.lilac} /><Text style={{ color: color.lilac, fontSize: 12, fontWeight: "700" }}>{newest ? "Newest" : "Oldest"}</Text></Pressable></View>
        <View style={[ui.row, { flexWrap: "wrap", paddingBottom: 12 }]}><Pressable disabled={deleting || !visible.length || (loadingChapters && !fullList)} onPress={() => setSelected(current => [...new Set([...current, ...visible])])} style={{ paddingVertical: 10 }}><Text style={{ color: color.lilac }}>Select visible ({visible.length})</Text></Pressable><Pressable accessibilityLabel={`Select all ${unread.length} unread chapters`} disabled={deleting || !fullList || !unread.length} onPress={() => { setSelected(unread); setFilter("unread"); setQuery(""); }} style={{ minHeight: 44, justifyContent: "center", opacity: deleting || !fullList || !unread.length ? 0.4 : 1 }}><Text style={{ color: color.lilac }}>Select all unread ({unread.length})</Text></Pressable></View>
        <Text style={[ui.muted, { fontSize: 11, paddingBottom: 12 }]}>Select all unread includes saved chapters. Download saves only missing chapters.</Text>
      </>}
      ListEmptyComponent={<View style={{ paddingVertical: 28 }}>{detailsLoading.includes(slug) ? <ActivityIndicator color={color.lilac} /> : <Text style={ui.muted}>{all.length ? "No chapters match these filters." : (sourceOf(item) === "webtoon" && item.detailsCached ? "No public episodes. Restricted episodes require WEBTOON." : "No chapters loaded. Pull to refresh.")}</Text>}</View>}
      renderItem={({ item: chapter }) => {
        const isSaved = ownedSet.has(chapter), isRead = Boolean(ledger[chapter]), checked = chosenSet.has(chapter);
        const progress = isRead ? 1 : Math.min(0.99, chapterProgress(history[slug], chapter));
        const chapterTitle = item.chapterTitles?.[chapter] || `Chapter ${chapter}`;
        return <View style={[ui.row, { position: "relative", overflow: "hidden", gap: 3, borderBottomWidth: 1, borderColor: color.line, backgroundColor: checked ? "#8b5cf626" : isSaved ? "#65cba10d" : "transparent", borderLeftWidth: 3, borderLeftColor: isSaved ? "#65cba180" : "transparent" }]}>
          <View pointerEvents="none" accessibilityRole="progressbar" accessibilityLabel={`Chapter ${chapter} reading progress`} accessibilityValue={{ min: 0, max: 100, now: Math.floor(progress * 100) }} style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${progress * 100}%`, backgroundColor: isRead ? "#65cba118" : "#8b5cf61c" }} />
          <Pressable disabled={deleting} accessibilityRole="checkbox" accessibilityLabel={`Select chapter ${chapter}`} accessibilityState={{ checked }} onPress={() => toggle(chapter)} style={{ padding: 12 }}><Icon name={checked ? "checkbox" : "square-outline"} tint={checked ? color.lilac : color.muted} /></Pressable>
          <Pressable disabled={deleting} accessibilityLabel={`${chapterTitle}, ${isSaved ? "downloaded" : "not downloaded"}`} accessibilityHint={isSaved ? "Read chapter" : "Select for download"} onPress={() => isSaved ? open(chapter) : toggle(chapter)} style={{ flex: 1, paddingVertical: 16 }}><View style={[ui.row, { gap: 7 }]}>{isSaved && <Icon name="download-outline" size={16} tint="#9de1bf" />}<Text style={[ui.text, { flex: 1, fontWeight: "600", color: isSaved ? "#9de1bf" : color.text }]}>{chapterTitle}</Text></View></Pressable>
          <Pressable accessibilityRole="checkbox" accessibilityLabel={`Chapter ${chapter} read`} accessibilityState={{ checked: isRead }} onPress={() => { setReadStatus(slug, [chapter], !isRead); setHistory(readingHistory()); }} style={{ padding: 14 }}><Icon name={isRead ? "checkmark-circle" : "checkmark-circle-outline"} tint={isRead ? "#65cba1" : color.muted} /></Pressable>
        </View>;
      }} />
    {job && <Pressable accessibilityLabel="Show download controls" onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })} style={[ui.row, { padding: 14, borderTopWidth: 1, borderColor: color.line }]}><Icon name="download-outline" tint={color.lilac} size={18} /><Text numberOfLines={1} style={[ui.muted, { flex: 1 }]}>{job.message} · {Math.round(job.progress * 100)}%</Text><Text style={{ color: color.lilac }}>Controls ↑</Text></Pressable>}
    {chosen.length > 0 && <View style={{ paddingHorizontal: 20, paddingVertical: 10, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.surface }}>
      <View style={[ui.row, { justifyContent: "space-between" }]}><Text accessibilityLiveRegion="polite" style={ui.text}>{chosen.length} selected</Text><Pressable disabled={deleting} onPress={() => setSelected([])} style={{ padding: 10 }}><Text style={{ color: color.lilac }}>Clear</Text></Pressable></View>
      {missing.length > 0 && <Text style={[ui.muted, { fontSize: 11, marginBottom: 8 }]}>About {formatBytes(estimate.bytes)} · {formatBytes(freeBytes())} free</Text>}
      <View style={[ui.row, { flexWrap: "wrap", gap: 8 }]}>{missing.length > 0 && <Pressable disabled={deleting} onPress={download} style={[ui.primary, { flexGrow: 1 }]}><Text style={ui.primaryText}>Download ({missing.length})</Text></Pressable>}<Pressable disabled={deleting} onPress={() => mark(chosen)} style={{ padding: 12 }}><Text style={{ color: color.lilac }}>Read status</Text></Pressable>{savedSelection.length > 0 && <Pressable disabled={blocked} accessibilityState={{ disabled: blocked }} onPress={() => erase(savedSelection)} style={{ padding: 12, opacity: blocked ? 0.4 : 1 }}>{deleting ? <ActivityIndicator color={color.lilac} /> : <Text style={{ color: "#f08080" }}>Delete ({savedSelection.length})</Text>}</Pressable>}</View>
      {blocked && savedSelection.length > 0 && !deleting && <Text style={[ui.muted, { fontSize: 11 }]}>Pause the download before deleting saved chapters.</Text>}
    </View>}
  </SafeAreaView>;
}





