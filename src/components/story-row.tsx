import { Pressable, Text, View } from "react-native";
import { Series, kindOf, publicationState, releaseLabel, sourceLabel, formatRating } from "../lib/parser";
import { useShelf } from "../lib/app-state";
import { openSeries } from "./series-card";
import { color, Cover, Icon, ui } from "./ui";

export function PublicationStatus({ item }: { item: Series }) {
  const state = publicationState(item);
  return <View style={{ marginTop: 8, gap: 5 }}><Text style={{ color: color.lilac, fontSize: 10 }}>{sourceLabel(item)}</Text><View style={[ui.row, { gap: 6 }]}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: state.color }} /><Text style={{ color: state.color, fontSize: 11, fontWeight: "700" }}>{state.label}</Text></View>{item.updatedAt && <Text style={{ color: color.muted, fontSize: 11 }}>{releaseLabel(item)}</Text>}</View>;
}
export function SaveActions({ item, labels = false, vertical = false }: { item: Series; labels?: boolean; vertical?: boolean }) {
  const { saved, toggleStory } = useShelf();
  return <View style={[ui.row, { flexDirection: vertical ? "column" : "row", gap: labels ? 20 : 0 }]}>{([['bookmarked', 'bookmark', 'Bookmark'], ['liked', 'heart', 'Like']] as const).map(([field, icon, title]) => <Pressable key={field} accessibilityLabel={`${saved[item.slug]?.[field] ? 'Remove' : 'Add'} ${title.toLowerCase()}`} accessibilityState={{ selected: Boolean(saved[item.slug]?.[field]) }} onPress={() => toggleStory(item.slug, field)} style={[ui.row, { minHeight: 44, minWidth: 44, paddingVertical: 12, paddingHorizontal: labels ? 0 : 12, gap: 7 }]}><Icon name={saved[item.slug]?.[field] ? icon : `${icon}-outline`} size={20} tint={saved[item.slug]?.[field] ? color.lilac : color.muted} />{labels && <Text style={{ color: saved[item.slug]?.[field] ? color.lilac : color.muted }}>{saved[item.slug]?.[field] ? field === 'liked' ? 'Liked' : 'Bookmarked' : title}</Text>}</Pressable>)}</View>;
}
export function StoryRow({ item, rank }: { item: Series; rank?: number }) {
  const rating = formatRating(item.rating);
  return <View style={[ui.row, { paddingVertical: 17, borderBottomWidth: 1, borderColor: color.line, alignItems: "flex-start", gap: 10 }]}>
    <Pressable accessibilityLabel={item.title} onPress={() => openSeries(item)}><Cover item={item} style={{ width: 96, height: 136, borderRadius: 12 }} />{rank && <View style={{ position: "absolute", top: 6, left: 6, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 7, backgroundColor: "#0b0b10dc" }}><Text style={{ color: color.text, fontSize: 12, fontWeight: "800" }}>#{rank}</Text></View>}</Pressable>
    <Pressable onPress={() => openSeries(item)} style={{ flex: 1, paddingTop: 3 }}><Text numberOfLines={3} style={{ color: color.text, fontSize: 16, lineHeight: 21, fontWeight: "800" }}>{item.title}</Text><Text style={{ color: color.muted, fontSize: 11, marginTop: 6 }}>{kindOf(item) === "novel" ? "Novel" : item.type || "Comic"}{rating ? ` · ★ ${rating}` : ""}</Text><PublicationStatus item={item} /></Pressable>
    <SaveActions item={item} vertical />
  </View>;
}


