import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useShelf } from "../../lib/app-state";
import { Chip, color, Cover, Icon, ui } from "../../components/ui";
import { PublicationStatus, SaveActions } from "../../components/story-row";
import { DownloadList } from "../../components/download-list";
import { chapterList, chapterListCached, kindOf, nextUnread, sourceOf, formatRating } from "../../lib/parser";
import { readingHistory } from "../../lib/storage";
import { estimateDownload, formatBytes, freeBytes } from "../../lib/library-tools";
import { StoryOptions } from "../../components/story-options";

export default function SeriesDetails() {
  const { slug, filter: initialFilter } = useLocalSearchParams<{ slug: string; filter?: string }>();
  const { catalog, startDownload, downloads, loadDetails, detailsLoading, saved, preferences, notificationBusy, setReleaseNotifications, notice, dismissNotice, read, setReadStatus, removeDownloads, deleting, downloadBusy, sourceSessionRevision } = useShelf();
  const [filter, setFilter] = useState(initialFilter === "downloaded" ? "saved" : "all");
  const [query, setQuery] = useState("");
  const [newest, setNewest] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [history, setHistory] = useState(readingHistory);
  const listRef = useRef<FlatList<string>>(null);
  useFocusEffect(useCallback(() => { setHistory(readingHistory()); }, []));
  useEffect(() => { void loadDetails(slug); }, [loadDetails, slug, sourceSessionRevision]);
  const item = catalog.find(value => value.slug === slug);
  if (!item) return <SafeAreaView style={ui.safe}><Pressable onPress={() => router.back()}><Text style={ui.empty}>Back · story unavailable</Text></Pressable></SafeAreaView>;
  const owned = item.localChapters || [];
  const rating = formatRating(item.rating);
  const ledger = read[slug] || {};
  const all = chapterList(item.chapterIds, owned);
  const fullList = chapterListCached(item);
  const loadingChapters = detailsLoading.includes(slug);
  const visible = chapterList(item.chapterIds, owned, ledger, filter, query, newest, item.chapterTitles);
  const chosen = selected.filter(id => all.includes(id));
  const missing = chosen.filter(id => !owned.includes(id));
  const savedSelection = chosen.filter(id => owned.includes(id));
  const job = downloads.find(value => value.series.slug === slug);
  const blocked = deleting || downloadBusy(slug) || Boolean(job && ["queued", "downloading", "waiting", "cancelling"].includes(job.status));
  const ascendingSaved = chapterList([], owned, {}, "all", "", false);
  const continuation = nextUnread(ascendingSaved, history[slug], ledger);
  const firstSaved = continuation || ascendingSaved[0];
  function open(chapter: string) { router.push({ pathname: "/reader/[slug]/[chapter]", params: { slug, chapter, title: item?.title } }); }
  function toggle(chapter: string) { setSelected(current => current.includes(chapter) ? current.filter(id => id !== chapter) : [...current, chapter]); }
  function mark(ids: string[]) {
    if (!ids.length) return;
    Alert.alert("Reading status", `${ids.length} chapter${ids.length === 1 ? "" : "s"}`, [
      { text: "Cancel", style: "cancel" },
      { text: "Mark read", onPress: () => { setReadStatus(slug, ids, true); setSelected([]); } },
      { text: "Mark unread", onPress: () => { setReadStatus(slug, ids, false); setSelected([]); } },
    ]);
  }
  function erase(ids: string[], everything = false) {
    if (!item) return;
    Alert.alert(everything ? "Delete all saved chapters?" : `Delete ${ids.length} saved chapters?`, "Reading history and bookmarks will stay. You can download the chapters again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => { void removeDownloads(item, ids, everything).then(ok => { if (ok) setSelected([]); }); } },
    ]);
  }
  function download() {
    if (!item || !missing.length) return;
    if (job) { Alert.alert("Download already listed", "Resume or cancel this story’s existing download using the controls above the chapter list before starting another selection."); return; }
    const run = () => { if (startDownload(item, missing.join(","))) setSelected([]); };
    const estimate = estimateDownload(item.slug, missing.length, kindOf(item) === "novel");
    if (missing.length > 20) Alert.alert(`Download ${missing.length} chapters?`, `Approximately ${formatBytes(estimate.bytes)}; ${formatBytes(freeBytes())} free. Actual size varies. Transfers continue with an Android notification.`, [{ text: "Cancel", style: "cancel" }, { text: "Download", onPress: run }]); else run();
  }
  return <SafeAreaView style={ui.safe} edges={["top", "bottom"]}>
    <View style={[ui.row, { paddingHorizontal: 10, borderBottomWidth: 1, borderColor: color.line }]}><Pressable accessibilityLabel="Back" onPress={() => router.back()} style={{ padding: 12 }}><Icon name="arrow-back" /></Pressable><Text numberOfLines={1} style={[ui.text, { flex: 1, fontWeight: "700" }]}>{item.title}</Text></View>
    <FlatList ref={listRef} data={visible} keyExtractor={id => id} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }} refreshControl={<RefreshControl refreshing={detailsLoading.includes(slug)} onRefresh={() => void loadDetails(slug, true)} tintColor={color.lilac} colors={[color.purple]} />}
      ListHeaderComponent={<>
        <View style={[ui.row, { marginTop: 24, alignItems: "flex-start" }]}><Cover item={item} style={{ width: 115, height: 165, borderRadius: 17 }} /><View style={{ flex: 1 }}><Text style={[ui.title, { fontSize: 25 }]}>{item.title}</Text><Text style={[ui.muted, { marginTop: 12 }]}>{item.type} · {item.chapterCount} chapters</Text><Text style={{ color: color.lilac, marginTop: 12, fontWeight: "800" }}>{rating ? `★ ${rating} · ` : ""}{item.bookmarks ? `${item.bookmarks} ${sourceOf(item) === "webtoon" ? "subscribers" : "saves"}` : ""}</Text></View></View>
        <PublicationStatus item={item} /><SaveActions item={item} labels /><StoryOptions item={item} />
        {saved[slug]?.bookmarked && !preferences.releaseNotifications && <Pressable disabled={notificationBusy} onPress={() => void setReleaseNotifications(true)} style={[ui.row, { paddingVertical: 10 }]}>{notificationBusy ? <ActivityIndicator color={color.lilac} /> : <Icon name="notifications-outline" tint={color.lilac} />}<Text style={{ color: color.lilac }}>Notify me about new chapters</Text></Pressable>}
        {notice ? <Pressable onPress={dismissNotice} style={{ paddingVertical: 12 }}><Text style={ui.muted}>{notice} · Dismiss</Text></Pressable> : null}
        {sourceOf(item) === "mangakakalot" && /verification/i.test(notice) && <Pressable onPress={() => router.push({ pathname: "/verify-source", params: { source: sourceOf(item) } })} style={{ paddingVertical: 12 }}><Text style={{ color: color.lilac }}>Verify source</Text></Pressable>}
        <Text numberOfLines={expanded ? undefined : 4} style={{ color: "#d8d2e2", lineHeight: 23, marginTop: 16 }}>{item.summary || (detailsLoading.includes(slug) ? "Loading summary…" : "No summary available. Pull down to refresh.")}</Text>
        {item.summary.length > 180 && <Pressable onPress={() => setExpanded(value => !value)} style={{ paddingVertical: 12 }}><Text style={{ color: color.lilac }}>{expanded ? "Show less" : "Read summary"}</Text></Pressable>}
        {firstSaved && <Pressable onPress={() => open(firstSaved)} style={[ui.primary, { marginTop: 18 }]}><Text style={ui.primaryText}>{continuation ? `Continue reading · ${item.chapterTitles?.[firstSaved] || `Chapter ${firstSaved}`}` : `Read again · ${item.chapterTitles?.[firstSaved] || `Chapter ${firstSaved}`}`}</Text></Pressable>}
        <DownloadList slug={slug} />
        <View style={[ui.row, { marginTop: 18, justifyContent: "space-between" }]}><Text style={ui.title}>Chapters</Text><Pressable accessibilityLabel="Chapter actions" onPress={() => Alert.alert("Chapter actions", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Mark all read / unread", onPress: () => mark(all) }, ...(item.hasLocalFiles ? [{ text: "Delete all saved files", style: "destructive" as const, onPress: () => { if (blocked) Alert.alert("Download in progress", "Pause or cancel this story’s download first."); else erase([], true); } }] : [])])} style={{ padding: 12 }}><Icon name="ellipsis-horizontal" /></Pressable></View>
        <Text style={[ui.muted, { fontSize: 12 }]}>{owned.length} saved · {all.filter(id => ledger[id]).length} read · {all.length} available</Text>
        {loadingChapters && <View accessibilityLiveRegion="polite" style={[ui.row, { paddingVertical: 12 }]}><ActivityIndicator size="small" color={color.lilac} /><Text style={ui.muted}>{fullList ? "Refreshing chapters…" : "Loading the full chapter list…"}</Text></View>}
        <Text style={[ui.muted, { fontSize: 11 }]}>{kindOf(item) === "novel" ? "Public chapters only. " : ""}Tap saved to read; use checkboxes to select.</Text>
        <TextInput accessibilityLabel="Search chapters" placeholder="Find a chapter…" placeholderTextColor={color.muted} value={query} onChangeText={setQuery} style={{ color: color.text, padding: 14, borderRadius: 12, backgroundColor: color.surface, marginTop: 14 }} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginVertical: 12 }}>{[["all", "All chapters"], ["unread", "Unread"], ["saved", "Saved only"]].map(([key, label]) => <Chip key={key} text={label} active={filter === key} onPress={() => setFilter(key)} />)}<Chip text="Newest first" active={newest} onPress={() => setNewest(true)} /><Chip text="Oldest first" active={!newest} onPress={() => setNewest(false)} /></View>
        <View style={[ui.row, { flexWrap: "wrap", paddingBottom: 12 }]}><Pressable disabled={deleting || !visible.length || (loadingChapters && !fullList)} onPress={() => setSelected(current => [...new Set([...current, ...visible])])} style={{ paddingVertical: 10 }}><Text style={{ color: color.lilac }}>Select filtered ({visible.length})</Text></Pressable><Pressable disabled={deleting || !fullList} accessibilityState={{ disabled: deleting || !fullList }} onPress={() => setSelected(chapterList(item.chapterIds, owned, ledger, "unread", "", false).filter(id => !owned.includes(id)).slice(0, 5))} style={{ paddingVertical: 10 }}><Text style={{ color: color.lilac }}>Next 5 unread</Text></Pressable></View>
      </>}
      ListEmptyComponent={<View style={{ paddingVertical: 28 }}>{detailsLoading.includes(slug) ? <ActivityIndicator color={color.lilac} /> : <Text style={ui.muted}>{all.length ? "No chapters match these filters." : (sourceOf(item) === "webtoon" && item.detailsCached ? "No public episodes are listed on WEBTOON for this story. App-only and restricted episodes are unavailable here." : "No chapters cached yet. Pull down while online to load them.")}</Text>}</View>}
      renderItem={({ item: chapter }) => {
        const isSaved = owned.includes(chapter), isRead = Boolean(ledger[chapter]), checked = chosen.includes(chapter);
        return <View style={[ui.row, { gap: 3, borderBottomWidth: 1, borderColor: color.line, backgroundColor: checked ? "#8b5cf626" : isSaved ? "#65cba10d" : "transparent", borderLeftWidth: 3, borderLeftColor: isSaved ? "#65cba180" : "transparent" }]}>
          <Pressable disabled={deleting} accessibilityRole="checkbox" accessibilityLabel={`Select chapter ${chapter}`} accessibilityState={{ checked }} onPress={() => toggle(chapter)} style={{ padding: 12 }}><Icon name={checked ? "checkbox" : "square-outline"} tint={checked ? color.lilac : color.muted} /></Pressable>
          <Pressable disabled={deleting} onPress={() => isSaved ? open(chapter) : toggle(chapter)} style={{ flex: 1, paddingVertical: 16 }}><Text style={[ui.text, { fontWeight: "600", color: isSaved ? "#9de1bf" : color.text }]}>{isSaved ? "↓  " : ""}{item.chapterTitles?.[chapter] || `Chapter ${chapter}`}</Text><Text style={[ui.muted, { fontSize: 11 }]}>{isSaved ? "Saved on phone" : "Not downloaded"} · {isRead ? "Read" : "Unread"}</Text></Pressable>
          <Pressable accessibilityRole="checkbox" accessibilityLabel={`Chapter ${chapter} read`} accessibilityState={{ checked: isRead }} onPress={() => setReadStatus(slug, [chapter], !isRead)} style={{ padding: 14 }}><Icon name={isRead ? "checkmark-circle" : "checkmark-circle-outline"} tint={isRead ? "#65cba1" : color.muted} /></Pressable>
        </View>;
      }} />
    {job && <Pressable accessibilityLabel="Show download controls" onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })} style={[ui.row, { padding: 14, borderTopWidth: 1, borderColor: color.line }]}><Icon name="download-outline" tint={color.lilac} size={18} /><Text numberOfLines={1} style={[ui.muted, { flex: 1 }]}>{job.message} · {Math.round(job.progress * 100)}%</Text><Text style={{ color: color.lilac }}>Controls ↑</Text></Pressable>}
    {chosen.length > 0 && <View style={{ paddingHorizontal: 20, paddingVertical: 10, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.surface }}>
      <View style={[ui.row, { justifyContent: "space-between" }]}><Text accessibilityLiveRegion="polite" style={ui.text}>{chosen.length} selected</Text><Pressable disabled={deleting} onPress={() => setSelected([])} style={{ padding: 10 }}><Text style={{ color: color.lilac }}>Clear</Text></Pressable></View>
      {missing.length > 0 && <Text style={[ui.muted, { fontSize: 11, marginBottom: 8 }]}>About {formatBytes(estimateDownload(slug, missing.length, kindOf(item) === "novel").bytes)} · {formatBytes(freeBytes())} free on phone · estimate varies by chapter</Text>}
      <View style={[ui.row, { flexWrap: "wrap", gap: 8 }]}>{missing.length > 0 && <Pressable disabled={deleting} onPress={download} style={[ui.primary, { flexGrow: 1 }]}><Text style={ui.primaryText}>Download ({missing.length})</Text></Pressable>}<Pressable disabled={deleting} onPress={() => mark(chosen)} style={{ padding: 12 }}><Text style={{ color: color.lilac }}>Read status</Text></Pressable>{savedSelection.length > 0 && <Pressable disabled={blocked} accessibilityState={{ disabled: blocked }} onPress={() => erase(savedSelection)} style={{ padding: 12, opacity: blocked ? 0.4 : 1 }}>{deleting ? <ActivityIndicator color={color.lilac} /> : <Text style={{ color: "#f08080" }}>Delete ({savedSelection.length})</Text>}</Pressable>}</View>
      {blocked && savedSelection.length > 0 && !deleting && <Text style={[ui.muted, { fontSize: 11 }]}>Pause the download before deleting saved chapters.</Text>}
    </View>}
  </SafeAreaView>;
}





