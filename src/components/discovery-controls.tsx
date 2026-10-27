import { ToggleRow } from "./toggle-row";
import { Pressable } from "./pressable";
import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { SOURCES, filterDiscovery } from "../lib/parser";
import { providerInfo } from "../lib/provider-info";
import { useShelf } from "../lib/app-state";
import { Chip, color, Icon, ui } from "./ui";

export function DiscoveryControls() {
  const { catalog, preferences: p, updatePreferences: update } = useShelf();
  const [expanded, setExpanded] = useState(false);
  const [languagesOpen, setLanguagesOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const source = p.source || "asura";
  const info = providerInfo(source);
  const languages = info.languages || [];
  const language = languages.find(([id]) => id === p.webtoonLanguage)?.[0] || languages[0]?.[0];
  const collection = info.collections?.find(([id]) => id === p.webtoonCollection)?.[0] || info.collections?.[0]?.[0];
  const selectedTags = p.genreFilters?.[source] || [];
  const tags = [...new Set([...selectedTags, ...filterDiscovery(catalog, { ...p, genreFilters: {}, hideDownloaded: false, hideLiked: false, hideBookmarked: false }, {}).flatMap(item => item.genres || [])])].sort((a, b) => a.localeCompare(b));
  function setTags(values: string[]) { update({ genreFilters: { ...p.genreFilters, [source]: values } }); }
  return <View style={{ marginHorizontal: 22 }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 6, gap: 8 }}>{SOURCES.map(({ id: source, name }) => <Chip key={source} text={name} active={(p.source || "asura") === source} onPress={() => { setTagQuery(""); update({ source }); }} />)}</ScrollView>
    {info.verification && <Pressable accessibilityLabel="Verify source" onPress={() => router.push({ pathname: "/verify-source", params: { source: p.source } })} style={[ui.row, { paddingVertical: 6, minHeight:44 }]}><Icon name="shield-checkmark-outline" size={18} tint={color.lilac} /><Text style={{ color: color.lilac }}>Verify source</Text></Pressable>}
    {languages.length > 0 && <Pressable accessibilityLabel={`Choose ${info.name} language`} onPress={() => setLanguagesOpen(value => !value)} style={[ui.row, { paddingVertical: 14 }]}><Icon name="language-outline" tint={color.lilac} size={20} /><Text style={[ui.text, { flex: 1 }]}>{languages.find(([id]) => id === language)?.[1] || languages[0]?.[1] || "English"}</Text><Icon name="chevron-down" tint={color.muted} size={17} /></Pressable>}
    {languages.length > 0 && languagesOpen && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 14 }}>{languages.map(([webtoonLanguage, text]) => <Chip key={webtoonLanguage} text={text} active={language === webtoonLanguage} onPress={() => { update({ webtoonLanguage, genreFilters: { ...p.genreFilters, [source]: [] } }); setTagQuery(""); setLanguagesOpen(false); }} />)}</View>}
    <View style={[ui.row, { borderBottomWidth: 1, borderColor: color.line }]}>
      {info.collections ? info.collections.map(([webtoonCollection, title]) => <Pressable key={webtoonCollection} accessibilityRole="tab" accessibilityState={{ selected: collection === webtoonCollection }} onPress={() => update({ webtoonCollection })} style={{ paddingVertical: 14, paddingHorizontal: 6, borderBottomWidth: 2, borderColor: collection === webtoonCollection ? color.lilac : "transparent" }}><Text style={{ color: color.text, fontWeight: "700", fontSize: 15 }}>{title}</Text></Pressable>) : info.formats.length > 1 ? ([["all", "All"], ["comics", "Comics"], ["novels", "Novels"]] as const).map(([contentMode, title]) => <Pressable key={contentMode} accessibilityRole="tab" accessibilityState={{ selected: p.contentMode === contentMode }} onPress={() => update({ contentMode })} style={{ paddingVertical: 14, paddingHorizontal: 6, borderBottomWidth: 2, borderColor: p.contentMode === contentMode ? color.lilac : "transparent" }}><Text style={{ color: p.contentMode === contentMode ? color.text : color.muted, fontWeight: "700", fontSize: 15 }}>{title}</Text></Pressable>) : <Text style={[ui.muted, { paddingVertical: 14 }]}>Comics</Text>}
      <View style={{ flex: 1 }} /><Pressable accessibilityLabel={`Discovery filters${selectedTags.length ? `, ${selectedTags.length} tags selected` : ""}`} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={[ui.row, { padding: 12, gap: 5 }]}><Icon name="filter-outline" tint={expanded || selectedTags.length ? color.lilac : color.muted} size={20} />{selectedTags.length > 0 && <Text style={{ color: color.lilac, fontSize: 12 }}>{selectedTags.length}</Text>}</Pressable>
    </View>
    {expanded && <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: color.line }}>
      <View style={[ui.row, { justifyContent: "space-between" }]}><Text style={[ui.text, { fontWeight: "700" }]}>Tags</Text>{selectedTags.length > 0 && <Pressable accessibilityLabel="Clear tag filters" onPress={() => setTags([])} style={{ padding: 10 }}><Text style={{ color: color.lilac }}>Clear ({selectedTags.length})</Text></Pressable>}</View>
      {tags.length > 12 && <TextInput accessibilityLabel="Find a tag" placeholder="Find a tag…" placeholderTextColor={color.muted} value={tagQuery} onChangeText={setTagQuery} style={{ color: color.text, backgroundColor: color.surface, borderRadius: 10, padding: 12, marginVertical: 8 }} />}
      <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", gap: 7, paddingVertical: 8 }}>{tags.filter(tag => selectedTags.includes(tag) || tag.toLowerCase().includes(tagQuery.trim().toLowerCase())).map(tag => <Chip key={tag} text={tag} active={selectedTags.includes(tag)} onPress={() => setTags(selectedTags.includes(tag) ? selectedTags.filter(value => value !== tag) : [...selectedTags, tag])} />)}</ScrollView>
      <Text style={[ui.muted, { fontSize: 11, marginBottom: 10 }]}>{tags.length ? "Matches all selected tags in loaded stories." : "Tags appear as story details load."}</Text>
      {([["hideDownloaded", "Hide downloaded"], ["hideLiked", "Hide liked"], ["hideBookmarked", "Hide bookmarked"]] as const).map(([key, label]) => <ToggleRow key={key} title={label} value={p[key]} onValueChange={value => update({ [key]: value })} />)}
    </View>}
  </View>;
}

export function PopularPeriods() {
  const { preferences, updatePreferences } = useShelf();
  const labels = { week: "Weekly", month: "Monthly", all: "All time" };
  return <View style={{ flexDirection: "row", marginTop: 12, marginBottom: 4, backgroundColor: color.surface, borderRadius: 12, padding: 3 }}>{providerInfo(preferences.source).periods.map(period => <Pressable key={period} accessibilityRole="tab" accessibilityState={{ selected: preferences.period === period }} onPress={() => updatePreferences({ period })} style={{ flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 9, backgroundColor: preferences.period === period ? color.raised : "transparent" }}><Text style={{ color: preferences.period === period ? color.text : color.muted, fontWeight: "700", fontSize: 12 }}>{labels[period]}</Text></Pressable>)}</View>;
}



