import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useShelf } from "../lib/app-state";
import { unreadReleases } from "../lib/release-policy";
import { sourceLabel } from "../lib/parser";
import { color, Cover, Icon, ui } from "./ui";

export function ReleaseFeed() {
  const { catalog, saved, updates, read } = useShelf();
  const entries = useMemo(() => catalog.filter(item => saved[item.slug]?.bookmarked).map(item => ({ item, chapters: unreadReleases(updates[item.slug], read[item.slug], item.chapterIds) })).filter(entry => entry.chapters.length).sort((a, b) => (b.item.updatedAt || "").localeCompare(a.item.updatedAt || "")), [catalog, saved, updates, read]);
  if (!entries.length) return null;
  return <View style={ui.section}><View style={[ui.row, { justifyContent: "space-between" }]}><Text style={ui.title}>New releases</Text><Pressable accessibilityLabel="View all new releases" onPress={() => router.navigate({ pathname: "/library", params: { scope: "bookmarked", updates: "1" } })} style={{ padding: 12 }}><Icon name="arrow-forward" size={20} tint={color.lilac} /></Pressable></View>
    {entries.slice(0, 5).map(({ item, chapters }) => <Pressable key={item.slug} accessibilityLabel={`${item.title}, ${chapters.length} new ${chapters.length === 1 ? "chapter" : "chapters"}`} onPress={() => router.push({ pathname: "/series/[slug]", params: { slug: item.slug, filter: "unread" } })} style={[ui.row, { paddingVertical: 12, borderBottomWidth: 1, borderColor: color.line }]}><Cover item={item} style={{ width: 42, height: 58, borderRadius: 8 }} /><View style={{ flex: 1 }}><Text numberOfLines={2} style={[ui.text, { fontWeight: "700", fontSize: 14 }]}>{item.title}</Text><Text style={[ui.muted, { marginTop: 5, fontSize: 11 }]}>{chapters.length} new {chapters.length === 1 ? "chapter" : "chapters"} · {sourceLabel(item)}</Text></View><Icon name={saved[item.slug]?.autoDownload ? "cloud-download-outline" : "notifications-outline"} size={20} tint={color.lilac} /></Pressable>)}
  </View>;
}
