import { Pressable } from "./pressable";
import { Text, View, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Series, sourceOf, formatRating } from "../lib/parser";
import { Cover, color, Icon } from "./ui";

export function openSeries(item: Series) { router.push({ pathname: "/series/[slug]", params: { slug: item.slug } }); }
export function SeriesCard({ item, grid = false }: { item: Series; grid?: boolean }) {
  const rating = formatRating(item.rating);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}, rated ${rating || "unrated"}`} onPress={() => openSeries(item)} style={[styles.card, grid && { width: "48%" }]}>
    <View><Cover item={item} style={styles.cover} />{rating ? <View style={styles.rating}><Text style={styles.ratingText}>★ {rating}</Text></View> : null}{Boolean(item.localChapters?.length) && <View style={styles.offline}><Icon name="checkmark-circle" tint={color.lilac} size={21} /></View>}</View>
    <Text numberOfLines={2} style={[styles.title, grid && { minHeight: 38 }]}>{item.title}</Text><Text numberOfLines={1} style={[styles.meta, { minHeight: 16 }]}>{item.type || "Comic"}{sourceOf(item) === "webtoon" ? ` · ${(item.language || "en").toUpperCase()}` : ""}</Text><Text numberOfLines={1} style={[styles.meta, { minHeight: 16 }]}>{item.chapterCount ? `${item.chapterCount} ${sourceOf(item) === "webtoon" ? "episodes" : "chapters"}` : item.latestChapter ? `Latest · Ch. ${item.latestChapter}` : "Chapter count unavailable"}{!rating ? " · Unrated" : ""}</Text><Text numberOfLines={3} style={[styles.meta, { lineHeight: 16, minHeight: 48 }]}>{item.summary || (item.metadataSyncedAt ? "No summary provided." : "Summary unavailable.")}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({ card: { width: 150, marginBottom: 14, borderRadius: 16, overflow: "hidden" }, cover: { width: "100%", aspectRatio: 0.68, borderRadius: 16 }, rating: { position: "absolute", top: 8, right: 8, borderRadius: 15, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: "#09090de8" }, ratingText: { color: "white", fontSize: 11, fontWeight: "800" }, offline: { position: "absolute", bottom: 9, right: 9, padding: 3, borderRadius: 20, backgroundColor: color.bg }, title: { color: color.text, fontSize: 14, fontWeight: "700", marginTop: 10, lineHeight: 19 }, meta: { color: color.muted, fontSize: 11, marginTop: 5 } });
