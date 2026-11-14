import { Pressable } from "../../components/pressable";
import { useActionSheet } from "../../components/action-sheet";
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useDownloads, useShelf } from "../../lib/app-state";
import { readingHistory } from "../../lib/storage";
import { color, Cover, DownloadBadge, Icon, PageHeading, ui } from "../../components/ui";
import { openSeries } from "../../components/series-card";
import { PublicationStatus } from "../../components/story-row";
import { unreadReleases } from "../../lib/release-policy";
import { chapterList, chapterProgress, nextUnread, resumeTarget, ReadingList, type Series } from "../../lib/parser";
import { inLibraryScope, libraryScopeCounts, matchesStoryQuery, type LibraryScope } from "../../lib/reading-ux";
import { ReadingAction } from "../../components/reading-action";
import { READING_LISTS } from "../../components/story-options";

export default function Library() {
  const showSheet = useActionSheet();
  const params = useLocalSearchParams<{ scope?: string; updates?: string }>();
  const { catalogReady, catalog, saved, read, updates, removeDownloads, deleting, downloadBusy, refreshing, sync, setStoriesOptions, pauseDownload } = useShelf();
  const downloads = useDownloads(true);
  const [query, setQuery] = useState("");
  const term = useDeferredValue(query.trim().toLowerCase());
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const chosen = catalog.filter(item => selectedIds.has(item.slug));
  function toggle(item: Series) { if (bulkBusy) return; setSelected(current => current.includes(item.slug) ? current.filter(slug => slug !== item.slug) : [...current, item.slug]); }
  function open(item: Series) { if (selecting) toggle(item); else openSeries(item); }
  function select(item: Series) { if (bulkBusy) return; setSelecting(true); toggle(item); }
  function bulkActions() {
    const clear = () => { setSelected([]); setSelecting(false); };
    showSheet(`${chosen.length} stories`, chosen.slice(0, 3).map(item => item.title).join(" · "), [
      ...READING_LISTS.map(([key, text]) => ({ text: `Move to ${text}`, onPress: () => { setStoriesOptions(chosen.map(item => item.slug), { list: key }); clear(); } })),
      { text: "Remove from reading lists", onPress: () => { setStoriesOptions(chosen.map(item => item.slug), { list: undefined }); clear(); } },
      { text: "Bookmark", onPress: () => { setStoriesOptions(chosen.map(item => item.slug), { bookmarked: true }); clear(); } },
      ...(chosen.some(item => downloads.some(job => job.series.slug === item.slug && ["queued", "downloading", "waiting"].includes(job.status))) ? [{ text: "Pause selected downloads", onPress: () => { chosen.forEach(item => pauseDownload(item.slug)); clear(); } }] : []),
      ...(chosen.some(item => item.hasLocalFiles) ? [{ text: "Delete saved files", style: "destructive" as const, onPress: () => showSheet("Delete selected downloads?", "Saved chapters and partial files will be deleted. Bookmarks and progress stay. Active downloads will be skipped.", [
        { text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => { void (async () => {
          setBulkBusy(true); let removed = 0, skipped = 0;
          try { for (const item of chosen.filter(item => item.hasLocalFiles)) { if (downloadBusy(item.slug)) { skipped++; continue; } if (await removeDownloads(item, [], true)) removed++; else skipped++; } setBulkMessage(`${removed} stories cleared${skipped ? ` · ${skipped} skipped` : ""}`); clear(); }
          finally { setBulkBusy(false); }
        })(); } },
      ]) }] : []),
      { text: "Cancel", style: "cancel" },
    ]);
  }
  const [scope, setScope] = useState<LibraryScope>("downloads");
  const [status, setStatus] = useState<"all" | "unread" | "updates">("all");
  const updatesOnly = status === "updates", unreadOnly = status === "unread";
  const [list, setList] = useState<ReadingList | "all">("all");
  const [sort, setSort] = useState<"activity" | "updated" | "title">("activity");
  const [history, setHistory] = useState(readingHistory);
  useFocusEffect(useCallback(() => {
    setHistory(readingHistory());
    if (params.scope === "bookmarked" || params.scope === "autoDownload") { setScope(params.scope); setStatus("all"); setList("all"); setQuery(""); }
    if (params.updates) { setStatus(params.updates === "1" ? "updates" : "all"); setList("all"); }
    if (params.scope || params.updates) router.setParams({ scope: undefined, updates: undefined });
  }, [params.scope, params.updates]));
  const updateCount = useCallback((slug: string, available?: string[]) => saved[slug]?.bookmarked ? unreadReleases(updates[slug], read[slug], available).length : 0, [saved, updates, read]);
  const scopeCounts = useMemo(() => libraryScopeCounts(catalog, saved), [catalog, saved]);
  const scoped = useMemo(() => catalog.filter(item => matchesStoryQuery(item, term) && inLibraryScope(item, saved[item.slug], scope)), [catalog, saved, scope, term]);
  const library = useMemo(() => scoped.filter(item => (!updatesOnly || updateCount(item.slug, item.chapterIds) > 0) && (list === "all" || saved[item.slug]?.list === list) && (!unreadOnly || item.localChapters?.some(id => !read[item.slug]?.[id]))).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : (Date.parse(sort === "updated" ? b.updatedAt || "" : history[b.slug]?.readAt || b.syncedAt || "") || 0) - (Date.parse(sort === "updated" ? a.updatedAt || "" : history[a.slug]?.readAt || a.syncedAt || "") || 0)), [scoped, saved, read, updateCount, updatesOnly, unreadOnly, list, sort, history]);
  const filtered = Boolean(term) || updatesOnly || unreadOnly || list !== "all";
  function clearFilters() { setStatus("all"); setList("all"); setQuery(""); }
  function changeScope(value: LibraryScope) { setScope(value); clearFilters(); }
  const scopeTitle = { downloads: "Downloads", bookmarked: "Bookmarks", autoDownload: "Auto-downloads", liked: "Liked", lists: "Reading lists" }[scope];
  const statusTitle = { all: "All stories", unread: "Unread chapters", updates: "New releases" }[status];
  const sortTitle = { activity: "Recent activity", updated: "Recently updated", title: "Title" }[sort];
  function showActions(item: Series) {
    showSheet(item.title, "Manage the chapters saved on this phone.", [
      { text: "Saved chapters", onPress: () => router.push({ pathname: "/series/[slug]", params: { slug: item.slug, filter: "downloaded" } }) },
      { text: "Delete saved files", style: "destructive", onPress: () => {
        if (downloadBusy(item.slug)) { showSheet("Download in progress", "Pause or cancel this story’s download before deleting saved files."); return; }
        showSheet("Delete all saved files?", "Chapters and partial files for this story will be deleted. Bookmarks and read history stay.", [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => { void removeDownloads(item, [], true); } },
        ]);
      } },
      { text: "Cancel", style: "cancel" },
    ]);
  }
  return <SafeAreaView edges={["top"]} style={ui.safe}><FlatList style={{flex:1}} keyboardDismissMode="on-drag" removeClippedSubviews={false}
    data={library} keyExtractor={item => item.slug} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
    contentContainerStyle={{ paddingBottom: 26 }} keyboardShouldPersistTaps="handled"
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void sync()} tintColor={color.lilac} colors={[color.purple]} />}
    ListHeaderComponent={<><PageHeading title="Your library" subtitle="SAVED FOR YOU" action={<Pressable accessibilityLabel={selecting ? "Finish selecting stories" : "Select stories"} disabled={bulkBusy} onPress={() => { setSelecting(value => !value); setSelected([]); }} style={{padding:12}}><Icon name={selecting ? "close" : "checkbox-outline"} tint={color.lilac} /></Pressable>} /><View style={{ paddingHorizontal: 22 }}>
    <View style={[ui.row,{backgroundColor:color.surface,borderRadius:12,paddingHorizontal:12,marginBottom:12}]}><Icon name="search-outline" tint={color.muted} size={19}/><TextInput accessibilityLabel="Search your library" value={query} onChangeText={setQuery} placeholder="Search your library…" placeholderTextColor={color.muted} style={{flex:1,color:color.text,height:48}}/>{query ? <Pressable accessibilityLabel="Clear library search" onPress={()=>setQuery("")} style={{padding:10}}><Icon name="close" size={17}/></Pressable>:null}</View>
    {bulkMessage ? <Text accessibilityLiveRegion="polite" style={ui.muted}>{bulkMessage}</Text>:null}
    <View accessibilityRole="tablist" style={[ui.row, { gap: 0, borderBottomWidth: 1, borderColor: color.line }]}>{([["downloads", "Downloads", "download"], ["bookmarked", "Bookmarks", "bookmark"], ["autoDownload", "Auto-downloads", "cloud-download"], ["liked", "Liked", "heart"], ["lists", "Lists", "list"]] as const).map(([key, label, icon]) => <Pressable key={key} accessibilityRole="tab" accessibilityLabel={`${label}, ${scopeCounts[key]} ${scopeCounts[key] === 1 ? "story" : "stories"}`} accessibilityState={{ selected: scope === key }} onLongPress={() => showSheet(label, `${scopeCounts[key]} stories`)} onPress={() => changeScope(key)} style={{ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: 9, borderBottomWidth: 2, borderColor: scope === key ? color.lilac : "transparent" }}><Icon name={scope === key ? icon : `${icon}-outline`} size={21} tint={scope === key ? color.lilac : color.muted} /><Text style={{ color: scope === key ? color.lilac : color.muted, fontSize: 10 }}>{scopeCounts[key]}</Text></Pressable>)}</View>
    <View style={[ui.row,{justifyContent:"space-between",paddingVertical:10,gap:6}]}>
      <View style={{flex:1}}><Text style={[ui.text,{fontSize:14,fontWeight:"700"}]}>{scopeTitle}</Text><Text accessibilityLiveRegion="polite" style={[ui.muted,{fontSize:11,marginTop:3}]}>{!catalogReady ? "Checking saved files…" : filtered ? `${library.length} of ${scopeCounts[scope]} stories` : `${library.length} stories`}</Text></View>
      <Pressable accessibilityLabel={`Filter: ${statusTitle}`} onPress={() => showSheet("Show stories", undefined, ([["all","All stories"],["unread","Unread chapters"],["updates","New releases"]] as const).map(([key,text])=>({text,selected:status===key,onPress:()=>setStatus(key)})))} style={[ui.row,{minHeight:44,paddingHorizontal:10,gap:5}]}><Icon name="filter-outline" tint={status!=="all"?color.lilac:color.muted} size={17}/><Text style={{color:status!=="all"?color.lilac:color.muted,fontSize:11}}>{status==="all"?"Filter":statusTitle}</Text></Pressable>
      <Pressable accessibilityLabel={`Sort: ${sortTitle}`} onPress={() => showSheet("Sort stories", undefined, ([["activity","Recent activity"],["updated","Recently updated"],["title","Title"]] as const).map(([key,text])=>({text,selected:sort===key,onPress:()=>setSort(key)})))} style={{minHeight:44,paddingHorizontal:10,justifyContent:"center"}}><Icon name="swap-vertical-outline" tint={color.muted} size={18}/></Pressable>
      {filtered && <Pressable accessibilityLabel="Clear library filters" onPress={clearFilters} style={{minHeight:44,paddingHorizontal:10,justifyContent:"center"}}><Icon name="close-circle-outline" tint={color.lilac} size={20}/></Pressable>}
    </View>
    {scope==="lists" && <Pressable accessibilityLabel="Choose reading list" onPress={()=>showSheet("Reading list",undefined,[{text:"All lists",selected:list==="all",onPress:()=>setList("all")},...READING_LISTS.map(([key,text])=>({text,selected:list===key,onPress:()=>setList(key)}))])} style={[ui.row,{paddingVertical:10,gap:8}]}><Icon name="list-outline" tint={color.lilac} size={17}/><Text style={[ui.text,{fontSize:12}]}>{READING_LISTS.find(([key])=>key===list)?.[1] || "All lists"}</Text><Icon name="chevron-down" tint={color.muted} size={13}/></Pressable>}
</View></>}
    ListEmptyComponent={<View style={{ alignItems: "center", paddingHorizontal: 22, paddingVertical: 70 }}><Icon name={scope === "autoDownload" ? "cloud-download-outline" : scope === "downloads" ? "download-outline" : scope === "liked" ? "heart-outline" : "bookmark-outline"} tint={color.lilac} size={40} /><Text style={[ui.empty, { textAlign: "center" }]}>{!catalogReady ? "Loading your library…" : filtered ? "No stories match these filters." : scope === "autoDownload" ? "Enable the cloud-download icon on a story." : scope === "downloads" ? "Save a story’s chapters to read anywhere." : "Save stories from their detail page. They’ll appear here."}</Text>{filtered && <Pressable onPress={clearFilters} style={[ui.primary, { marginTop: 16 }]}><Text style={ui.primaryText}>Clear filters</Text></Pressable>}</View>}
    renderItem={({ item }) => {
      const chapters = item.localChapters || [];
      const last = history[item.slug];
      const newCount = updateCount(item.slug, item.chapterIds);
      const continuation = resumeTarget(item, last, read[item.slug]) || nextUnread(chapterList(item.chapterIds, chapters, {}, "all", "", false), undefined, read[item.slug]);
      const chapter = continuation || chapters[0];
      return <View key={item.slug} style={{ paddingHorizontal: 22, paddingVertical: 14, borderBottomWidth: 1, borderColor: color.line }}>
        <View style={[ui.row, { alignItems: "flex-start" }]}>
          {selecting && <Pressable accessibilityRole="checkbox" accessibilityLabel={`Select ${item.title}`} accessibilityState={{checked:selectedIds.has(item.slug)}} disabled={bulkBusy} onPress={()=>toggle(item)} style={{paddingVertical:14,paddingRight:2}}><Icon name={selectedIds.has(item.slug)?"checkbox":"square-outline"} tint={color.lilac}/></Pressable>}
          <Pressable onPress={() => open(item)} onLongPress={() => select(item)}><Cover item={item} style={{ width: 70, height: 98, borderRadius: 11 }} /><View style={{position:"absolute",bottom:5,right:5}}><DownloadBadge slug={item.slug}/></View></Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Pressable onPress={() => open(item)} onLongPress={() => select(item)}><Text numberOfLines={2} style={{ color: color.text, fontWeight: "800", fontSize: 16, lineHeight: 21 }}>{item.title}</Text><PublicationStatus item={item} /></Pressable>
            {newCount > 0 && <Pressable accessibilityLabel={`${newCount} new unread chapters of ${item.title}`} onPress={() => open(item)} onLongPress={() => select(item)} style={[ui.row, { alignSelf: "flex-start", marginTop: 4, paddingVertical: 4, gap: 5 }]}><Icon name="sparkles" size={12} tint={color.lilac} /><Text style={{ color: color.lilac, fontWeight: "700", fontSize: 11 }}>{newCount} new {newCount === 1 ? "chapter" : "chapters"}</Text></Pressable>}
            {chapter && !selecting && <ReadingAction item={item} chapter={chapter} fraction={chapterProgress(last, chapter)} read={Boolean(read[item.slug]?.[chapter])} />}
          </View>
          {item.hasLocalFiles && !selecting && <Pressable accessibilityRole="button" accessibilityLabel={`Library actions for ${item.title}`} disabled={deleting} hitSlop={8} onPress={() => showActions(item)} style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}><Icon name="ellipsis-vertical" tint={color.muted} size={18} /></Pressable>}
        </View>
      </View>;
    }} />
    {selecting && <View style={[ui.row,{paddingHorizontal:20,paddingVertical:10,borderTopWidth:1,borderColor:color.line,backgroundColor:color.surface}]}><Text accessibilityLiveRegion="polite" style={[ui.text,{flex:1}]}>{chosen.length} selected{chosen.some(item=>!library.some(visible=>visible.slug===item.slug)) ? " · includes hidden stories":""}</Text><Pressable accessibilityLabel="Select all stories" disabled={bulkBusy} onPress={()=>setSelected(current=>[...new Set([...current,...library.map(item=>item.slug)])])} style={{padding:12}}><Icon name="checkmark-done-outline" tint={color.lilac}/></Pressable><Pressable accessibilityLabel="Bulk library actions" disabled={!chosen.length||bulkBusy} onPress={bulkActions} style={{padding:12}}>{bulkBusy?<ActivityIndicator color={color.lilac}/>:<Icon name="ellipsis-horizontal" tint={chosen.length?color.lilac:color.muted}/>}</Pressable></View>}
  </SafeAreaView>;
}

