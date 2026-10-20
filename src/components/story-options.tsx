import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useShelf } from "../lib/app-state";
import type { ReadingList, Series } from "../lib/parser";
import { Chip, color, Icon, ui } from "./ui";
export const READING_LISTS: [ReadingList, string][] = [["reading", "Reading"], ["planned", "Plan to read"], ["finished", "Finished"], ["hold", "On hold"]];
export function StoryOptions({ item }: { item: Series }) {
  const { saved, setStoryOptions } = useShelf();
  const [open, setOpen] = useState(false);
  const story = saved[item.slug];
  return <View style={{ paddingVertical: 12 }}>
    <Pressable accessibilityLabel="Choose reading list" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={[ui.row, { paddingVertical: 10 }]}><Icon name="list-outline" size={18} tint={color.lilac} /><Text style={[ui.text, { flex: 1 }]}>{READING_LISTS.find(([key]) => key === story?.list)?.[1] || "Add to reading list"}</Text><Icon name={open ? "chevron-up" : "chevron-down"} size={15} tint={color.muted} /></Pressable>
    {open && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingVertical: 8 }}>{READING_LISTS.map(([list, text]) => <Chip key={list} text={text} active={story?.list === list} onPress={() => { setStoryOptions(item.slug, { list }); setOpen(false); }} />)}<Chip text="None" onPress={() => { setStoryOptions(item.slug, { list: undefined }); setOpen(false); }} /></ScrollView>}
    {story?.bookmarked && <View style={[ui.row, { paddingVertical: 8 }]}><View style={{ flex: 1 }}><Text style={ui.text}>Download new releases</Text><Text style={[ui.muted, { fontSize: 11 }]}>Unmetered Wi-Fi · unread new chapters only</Text></View><Switch accessibilityLabel="Automatically download new bookmarked releases on Wi-Fi" value={Boolean(story.autoDownload)} onValueChange={autoDownload => setStoryOptions(item.slug, { autoDownload })} trackColor={{ true: color.purple }} /></View>}
  </View>;
}
