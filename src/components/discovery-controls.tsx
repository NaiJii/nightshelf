import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { SOURCES } from "../lib/parser";
import { WEBTOON_LANGUAGES } from "../lib/webtoon";
import { useShelf } from "../lib/app-state";
import { Chip, color, Icon, ui } from "./ui";

export function DiscoveryControls() {
  const { preferences: p, updatePreferences: update } = useShelf();
  const [expanded, setExpanded] = useState(false);
  const [languagesOpen, setLanguagesOpen] = useState(false);
  return <View style={{ marginHorizontal: 22 }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 6, gap: 8 }}>{SOURCES.map(({ id: source, name }) => <Chip key={source} text={name} active={(p.source || "asura") === source} onPress={() => update({ source })} />)}</ScrollView>
    {p.source === "mangakakalot" && <Pressable accessibilityLabel="Verify source" onPress={() => router.push({ pathname: "/verify-source", params: { source: p.source } })} style={[ui.row, { paddingVertical: 12 }]}><Icon name="shield-checkmark-outline" size={18} tint={color.lilac} /><Text style={{ color: color.lilac }}>Verify source</Text><Text style={[ui.muted, { fontSize: 11 }]}>If the website blocks requests</Text></Pressable>}
    {p.source === "webtoon" && <Pressable accessibilityLabel="Choose WEBTOON language" onPress={() => setLanguagesOpen(value => !value)} style={[ui.row, { paddingVertical: 14 }]}><Icon name="language-outline" tint={color.lilac} size={20} /><Text style={[ui.text, { flex: 1 }]}>{WEBTOON_LANGUAGES.find(([id]) => id === p.webtoonLanguage)?.[1] || "English"}</Text><Icon name="chevron-down" tint={color.muted} size={17} /></Pressable>}
    {p.source === "webtoon" && languagesOpen && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 14 }}>{WEBTOON_LANGUAGES.map(([webtoonLanguage, text]) => <Chip key={webtoonLanguage} text={text} active={p.webtoonLanguage === webtoonLanguage} onPress={() => { update({ webtoonLanguage }); setLanguagesOpen(false); }} />)}</View>}
    <View style={[ui.row, { borderBottomWidth: 1, borderColor: color.line }]}>
      {p.source === "webtoon" ? ([["originals", "Originals"], ["canvas", "Canvas"]] as const).map(([webtoonCollection, title]) => <Pressable key={webtoonCollection} accessibilityRole="tab" accessibilityState={{ selected: (p.webtoonCollection || "originals") === webtoonCollection }} onPress={() => update({ webtoonCollection })} style={{ paddingVertical: 14, paddingHorizontal: 6, borderBottomWidth: 2, borderColor: (p.webtoonCollection || "originals") === webtoonCollection ? color.lilac : "transparent" }}><Text style={{ color: color.text, fontWeight: "700", fontSize: 15 }}>{title}</Text></Pressable>) : (!p.source || p.source === "asura") ? ([["all", "All"], ["comics", "Comics"], ["novels", "Novels"]] as const).map(([contentMode, title]) => <Pressable key={contentMode} accessibilityRole="tab" accessibilityState={{ selected: p.contentMode === contentMode }} onPress={() => update({ contentMode })} style={{ paddingVertical: 14, paddingHorizontal: 6, borderBottomWidth: 2, borderColor: p.contentMode === contentMode ? color.lilac : "transparent" }}><Text style={{ color: p.contentMode === contentMode ? color.text : color.muted, fontWeight: "700", fontSize: 15 }}>{title}</Text></Pressable>) : <Text style={[ui.muted, { paddingVertical: 14 }]}>Comics</Text>}
      <View style={{ flex: 1 }} /><Pressable accessibilityLabel="Discovery filters" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={{ padding: 12 }}><Icon name="filter-outline" tint={expanded ? color.lilac : color.muted} size={20} /></Pressable>
    </View>
    {expanded && <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: color.line }}>
      {([["hideDownloaded", "Hide downloaded"], ["hideLiked", "Hide liked"], ["hideBookmarked", "Hide bookmarked"]] as const).map(([key, label]) => <View key={key} style={[ui.row, { justifyContent: "space-between", paddingVertical: 3 }]}><Text style={ui.text}>{label}</Text><Switch accessibilityLabel={label} value={p[key]} onValueChange={value => update({ [key]: value })} trackColor={{ true: color.purple }} /></View>)}
      <Text style={[ui.muted, { fontSize: 11, marginVertical: 5 }]}>Shared across Home, popularity lists and Explore searches.</Text>
    </View>}
  </View>;
}

export function PopularPeriods() {
  const { preferences, updatePreferences } = useShelf();
  return <View style={{ flexDirection: "row", marginTop: 12, marginBottom: 4, backgroundColor: color.surface, borderRadius: 12, padding: 3 }}>{([["week", "Weekly"], ["month", "Monthly"], ["all", "All time"]] as const).map(([period, label]) => <Pressable key={period} accessibilityRole="tab" accessibilityState={{ selected: preferences.period === period }} onPress={() => updatePreferences({ period })} style={{ flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 9, backgroundColor: preferences.period === period ? color.raised : "transparent" }}><Text style={{ color: preferences.period === period ? color.text : color.muted, fontWeight: "700", fontSize: 12 }}>{label}</Text></Pressable>)}</View>;
}



