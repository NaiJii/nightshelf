import { Pressable } from "./pressable";
import { Text, View } from "react-native";
import { Series, kindOf, publicationState, releaseLabel, sourceLabel, formatRating } from "../lib/parser";
import { ReadingListAction } from "./story-options";
import { openSeries } from "./series-card";
import { color, Cover, DownloadBadge, ui } from "./ui";

export function PublicationStatus({ item }: { item: Series }) {
  const state = publicationState(item);
  return <View style={{ marginTop: 4, flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 5 }}><Text style={{ color: color.lilac, fontSize: 10 }}>{sourceLabel(item)}</Text><View style={[ui.row, { gap: 6 }]}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: state.color }} /><Text style={{ color: state.color, fontSize: 11, fontWeight: "700" }}>{state.label}</Text></View>{item.updatedAt && <Text style={{ color: color.muted, fontSize: 11 }}>{releaseLabel(item)}</Text>}</View>;
}
export function StoryRow({ item, rank }: { item: Series; rank?: number }) {
  const rating = formatRating(item.rating);
  return <View style={[ui.row, { paddingVertical: 12, borderBottomWidth: 1, borderColor: color.line, alignItems: "flex-start", gap: 10 }]}>
    <Pressable accessibilityLabel={item.title} onPress={() => openSeries(item)}><Cover item={item} style={{ width: 96, height: 136, borderRadius: 12 }} /><View style={{position:"absolute",bottom:6,right:6}}><DownloadBadge slug={item.slug}/></View>{rank && <View style={{ position: "absolute", top: 6, left: 6, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 7, backgroundColor: "#0b0b10dc" }}><Text style={{ color: color.text, fontSize: 12, fontWeight: "800" }}>#{rank}</Text></View>}</Pressable>
    <Pressable onPress={() => openSeries(item)} style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={3} style={{ color: color.text, fontSize: 16, lineHeight: 21, fontWeight: "800" }}>{item.title}</Text><Text style={{ color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 4 }}>{kindOf(item) === "novel" ? "Novel" : item.type || "Comic"}{rating ? ` · ★ ${rating}` : ""}{item.chapterCount ? ` · ${item.chapterCount} chapters` : item.latestChapter ? ` · Ch. ${item.latestChapter}` : ""}</Text><PublicationStatus item={item} /></Pressable>
    <ReadingListAction item={item} />
  </View>;
}


