import { Pressable, Switch, Text, View } from "react-native";
import { useShelf } from "../lib/app-state";
import type { ReadingList, Series } from "../lib/parser";
import { color, Icon, ui } from "./ui";
import { useActionSheet } from "./action-sheet";
export const READING_LISTS: [ReadingList, string][] = [["reading", "Reading"], ["planned", "Plan to read"], ["finished", "Finished"], ["hold", "On hold"]];
export function ReadingListAction({ item }: { item: Series }) {
  const { saved, setStoryOptions } = useShelf();
  const showSheet = useActionSheet();
  const list = saved[item.slug]?.list;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Reading list: ${READING_LISTS.find(([key]) => key === list)?.[1] || "None"}. Choose reading list`} onPress={() => showSheet("Reading list", item.title, [
    ...READING_LISTS.map(([value, text]) => ({ text, selected: list === value, onPress: () => setStoryOptions(item.slug, { list: value }) })),
    { text: "No list", selected: !list, onPress: () => setStoryOptions(item.slug, { list: undefined }) },
    { text: "Cancel", style: "cancel" },
  ])} style={{ flex: 1, minHeight: 60, paddingVertical: 10, alignItems: "center", justifyContent: "center", gap: 5 }}><Icon name={list ? "list" : "list-outline"} size={20} tint={list ? color.lilac : color.muted} /><Text numberOfLines={1} style={{ color: list ? color.lilac : color.muted, fontSize: 11 }}>{READING_LISTS.find(([key]) => key === list)?.[1] || "Reading list"}</Text></Pressable>;
}
export function StoryOptions({ item }: { item: Series }) {
  const { saved, setStoryOptions } = useShelf();
  const story = saved[item.slug];
  return story?.bookmarked ? <View style={[ui.row, { paddingVertical: 8 }]}><View style={{ flex: 1 }}><Text style={ui.text}>Download new releases</Text><Text style={[ui.muted, { fontSize: 11 }]}>Unmetered Wi-Fi · unread new chapters only</Text></View><Switch accessibilityLabel="Automatically download new bookmarked releases on Wi-Fi" value={Boolean(story.autoDownload)} onValueChange={autoDownload => setStoryOptions(item.slug, { autoDownload })} trackColor={{ true: color.purple }} /></View> : null;
}
