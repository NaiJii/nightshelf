import { Pressable } from "./pressable";
import { Text, View, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Series, sourceOf, sourceLabel, kindOf, formatRating } from "../lib/parser";
import { Cover, DownloadBadge, color, Icon } from "./ui";
import { providerInfo } from "../lib/provider-info";

export function openSeries(item: Series) { router.push({ pathname: "/series/[slug]", params: { slug: item.slug } }); }
export function SeriesCard({ item, grid = false }: { item: Series; grid?: boolean }) {
  const rating = formatRating(item.rating);
  const info = providerInfo(sourceOf(item));
  return <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}, rated ${rating || "unrated"}`} onPress={() => openSeries(item)} style={[styles.card, grid && { width: "48%" }]}>
    <View><Cover item={item} style={styles.cover} /><View style={{position:"absolute",top:8,left:8}}><DownloadBadge slug={item.slug}/></View>{rating ? <View style={styles.rating}><Text style={styles.ratingText}>★ {rating}</Text></View> : null}{Boolean(item.localChapters?.length) && <View style={styles.offline}><Icon name="checkmark-circle" tint={color.lilac} size={21} /></View>}</View>
    <Text numberOfLines={2} style={[styles.title, grid && { minHeight: 38 }]}>{item.title}</Text><View style={{flexDirection:"row",gap:5,alignItems:"center",minHeight:34}}><Icon name={kindOf(item)==="novel"?"document-text-outline":"images-outline"} size={13} tint={color.muted}/>{(item.language || Boolean(info.languages)) && <Icon name="globe-outline" size={12} tint={color.muted}/>}<Text numberOfLines={2} style={[styles.meta,{flex:1}]}>{sourceLabel(item)} · {kindOf(item)==="novel"?"Novel":item.type || "Comic"}{item.language && !info.languages?` · ${item.language.toUpperCase()}`:""}</Text></View><Text numberOfLines={1} style={[styles.meta, { minHeight: 16 }]}>{item.chapterCount ? `${item.chapterCount} ${info.chapterNoun}` : item.latestChapter ? `Latest · Ch. ${item.latestChapter}` : "— chapters"}</Text>{item.summary && <Text numberOfLines={2} style={[styles.meta, { lineHeight: 16 }]}>{item.summary}</Text>}
  </Pressable>;
}
const styles = StyleSheet.create({ card: { width: 150, marginBottom: 14, borderRadius: 16, overflow: "hidden" }, cover: { width: "100%", aspectRatio: 0.68, borderRadius: 16 }, rating: { position: "absolute", top: 8, right: 8, borderRadius: 15, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: "#09090de8" }, ratingText: { color: "white", fontSize: 11, fontWeight: "800" }, offline: { position: "absolute", bottom: 9, right: 9, padding: 3, borderRadius: 20, backgroundColor: color.bg }, title: { color: color.text, fontSize: 14, fontWeight: "700", marginTop: 10, lineHeight: 19 }, meta: { color: color.muted, fontSize: 11, marginTop: 5 } });
