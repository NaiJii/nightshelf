import { useActionSheet } from "../../components/action-sheet";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useShelf } from "../../lib/app-state";
import { readingHistory } from "../../lib/storage";
import { Chip, color, Cover, Icon, Page, ui } from "../../components/ui";
import { openSeries } from "../../components/series-card";
import { PublicationStatus } from "../../components/story-row";
import { unreadReleases } from "../../lib/release-policy";
import { DownloadList } from "../../components/download-list";
import { nextUnread, ReadingList, type Series } from "../../lib/parser";
import { READING_LISTS } from "../../components/story-options";

export default function Library() {
  const showSheet = useActionSheet();
  const { catalog, saved, read, updates, removeDownloads, deleting, downloadBusy } = useShelf();
  const [scope, setScope] = useState<"downloads" | "bookmarked" | "liked" | "lists">("downloads");
  const [updatesOnly, setUpdatesOnly] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [list, setList] = useState<ReadingList | "all">("all");
  const [sort, setSort] = useState<"activity" | "updated" | "title">("activity");
  const [history, setHistory] = useState(readingHistory);
  useFocusEffect(useCallback(() => { setHistory(readingHistory()); }, []));
  const updateCount = (slug: string, available?: string[]) => saved[slug]?.bookmarked ? unreadReleases(updates[slug], read[slug], available).length : 0;
  const updatedStories = catalog.filter(item => updateCount(item.slug, item.chapterIds) > 0).length;
  const library = catalog.filter(item => (scope === "downloads" ? item.hasLocalFiles : scope === "lists" ? saved[item.slug]?.list : saved[item.slug]?.[scope]) && (!updatesOnly || updateCount(item.slug, item.chapterIds) > 0) && (list === "all" || saved[item.slug]?.list === list) && (!unreadOnly || item.localChapters?.some(id => !read[item.slug]?.[id]))).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : (Date.parse(sort === "updated" ? b.updatedAt || "" : history[b.slug]?.readAt || b.syncedAt || "") || 0) - (Date.parse(sort === "updated" ? a.updatedAt || "" : history[a.slug]?.readAt || a.syncedAt || "") || 0));
  const filtered = updatesOnly || unreadOnly || list !== "all";
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
  return <Page title="Your library" subtitle="SAVED FOR YOU"><View style={{ paddingHorizontal: 22 }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ borderBottomWidth: 1, borderColor: color.line }} contentContainerStyle={{ gap: 18 }}>{([["downloads", "Downloads"], ["bookmarked", "Bookmarks"], ["liked", "Liked"], ["lists", "Lists"]] as const).map(([key, label]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: scope === key }} onPress={() => setScope(key)} style={{ paddingVertical: 14, borderBottomWidth: 2, borderColor: scope === key ? color.lilac : "transparent" }}><Text style={{ color: scope === key ? color.text : color.muted, fontWeight: "700" }}>{label}</Text></Pressable>)}</ScrollView>
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: updatesOnly }} onPress={() => setUpdatesOnly(value => !value)} style={[ui.row, { paddingVertical: 15, gap: 7, alignSelf: "flex-start" }]}><Icon name={updatesOnly ? "sparkles" : "sparkles-outline"} tint={color.lilac} size={16} /><Text style={{ color: updatesOnly ? color.lilac : color.muted, fontSize: 12 }}>New releases{updatedStories ? ` · ${updatedStories} ${updatedStories === 1 ? "story" : "stories"}` : ""}</Text></Pressable>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingBottom: 12 }}><Chip text="All lists" active={list === "all"} onPress={() => setList("all")} />{READING_LISTS.map(([key, text]) => <Chip key={key} text={text} active={list === key} onPress={() => setList(key)} />)}</ScrollView>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingBottom: 14 }}><Chip text="Unread downloads" active={unreadOnly} onPress={() => setUnreadOnly(value => !value)} />{([["activity", "Recent activity"], ["updated", "Recently updated"], ["title", "Title"]] as const).map(([key, text]) => <Chip key={key} text={text} active={sort === key} onPress={() => setSort(key)} />)}</ScrollView>
    <DownloadList />
    {!library.length && <View style={{ alignItems: "center", paddingVertical: 70 }}><Icon name={scope === "downloads" ? "download-outline" : scope === "liked" ? "heart-outline" : "bookmark-outline"} tint={color.lilac} size={40} /><Text style={[ui.empty, { textAlign: "center" }]}>{filtered ? "No stories match these filters." : scope === "downloads" ? "Save a story’s chapters to read anywhere." : "Save stories from their detail page. They’ll appear here."}</Text>{filtered && <Pressable onPress={() => { setUpdatesOnly(false); setUnreadOnly(false); setList("all"); }} style={[ui.primary, { marginTop: 16 }]}><Text style={ui.primaryText}>Clear filters</Text></Pressable>}</View>}
    {library.map(item => {
      const chapters = item.localChapters || [];
      const last = history[item.slug];
      const newCount = updateCount(item.slug, item.chapterIds);
      const continuation = nextUnread(chapters, last, read[item.slug]);
      const chapter = continuation || chapters[0];
      return <View key={item.slug} style={{ paddingVertical: 20, borderBottomWidth: 1, borderColor: color.line }}>
        <View style={[ui.row, { alignItems: "flex-start" }]}><Pressable onPress={() => openSeries(item)}><Cover item={item} style={{ width: 70, height: 98, borderRadius: 11 }} /></Pressable><Pressable onPress={() => openSeries(item)} style={{ flex: 1 }}><Text numberOfLines={2} style={{ color: color.text, fontWeight: "800", fontSize: 16, lineHeight: 21 }}>{item.title}</Text><PublicationStatus item={item} /></Pressable>
          {item.hasLocalFiles && <Pressable accessibilityRole="button" accessibilityLabel={`Library actions for ${item.title}`} disabled={deleting} hitSlop={8} onPress={() => showActions(item)} style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}><Icon name="ellipsis-vertical" tint={color.muted} size={18} /></Pressable>}
        </View>
        {newCount > 0 && <Pressable accessibilityLabel={`${newCount} new unread chapters of ${item.title}`} onPress={() => openSeries(item)} style={[ui.row, { marginLeft: 82, alignSelf: "flex-start", marginTop: 10, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9, backgroundColor: "#8b5cf626", gap: 5 }]}><Icon name="sparkles" size={12} tint={color.lilac} /><Text style={{ color: color.lilac, fontWeight: "700", fontSize: 11 }}>{newCount} new {newCount === 1 ? "chapter" : "chapters"}</Text></Pressable>}
        {chapter && <Pressable onPress={() => router.push({ pathname: "/reader/[slug]/[chapter]", params: { slug: item.slug, chapter, title: item.title } })} style={[ui.row, { marginLeft: 82, paddingTop: 13, paddingBottom: 4, gap: 7 }]}><Icon name="play" size={13} tint={color.lilac} /><Text style={{ color: color.lilac, fontWeight: "700", fontSize: 12 }}>{continuation ? `${last ? "Continue reading" : "Start reading"} · ${chapters.filter(value => !read[item.slug]?.[value]).length} unread` : "Read again"}</Text></Pressable>}
      </View>;
    })}
  </View></Page>;
}

