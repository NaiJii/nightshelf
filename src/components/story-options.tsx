import { Pressable } from "./pressable";
import { Text } from "react-native";
import { useShelf } from "../lib/app-state";
import type { ReadingList, Series } from "../lib/parser";
import { color, Icon, ui } from "./ui";
import { useActionSheet } from "./action-sheet";
export const READING_LISTS: [ReadingList, string][] = [["reading", "Reading"], ["planned", "Plan to read"], ["finished", "Finished"], ["hold", "On hold"]];
export function ReadingListAction({ item, iconsOnly = false }: { item: Series; iconsOnly?: boolean }) {
  const { saved, setStoryOptions } = useShelf();
  const showSheet = useActionSheet();
  const story = saved[item.slug];
  const list = story?.list;
  const savedToList = Boolean(story?.bookmarked);
  const label = READING_LISTS.find(([key]) => key === list)?.[1] || (savedToList ? "Saved" : "Reading list");
  const choose = () => showSheet("Reading list", item.title, [
    { text: "Save without a status", selected: savedToList && !list, onPress: () => setStoryOptions(item.slug, { bookmarked: true, list: undefined }) },
    ...READING_LISTS.map(([value, text]) => ({ text, selected: list === value, onPress: () => setStoryOptions(item.slug, { bookmarked: true, list: value }) })),
    ...(savedToList ? [{ text: "Remove from reading list", onPress: () => setStoryOptions(item.slug, { bookmarked: false, list: undefined }) }] : []),
    { text: "Cancel", style: "cancel" },
  ]);
  return <Pressable accessibilityRole="button" accessibilityLabel={savedToList ? `Reading list, ${label}` : "Save to reading list"} accessibilityHint="Choose a reading status" onPress={choose} style={iconsOnly ? ui.storyAction : { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}><Icon name={savedToList ? "bookmark" : "bookmark-outline"} size={20} tint={savedToList ? color.lilac : color.muted} />{!iconsOnly && list && <Text style={{ color: color.muted, fontSize: 10 }}>{label}</Text>}</Pressable>;
}
export function ReleaseActions({ item }: { item: Series }) {
  const { saved, preferences, toggleAutoDownload, setStoryNotifications, toggleStoryNotifications, pendingNotifications } = useShelf();
  const showSheet = useActionSheet();
  const story = saved[item.slug], automatic = Boolean(story?.autoDownload);
  const alerts = pendingNotifications[item.slug] ?? Boolean(story?.bookmarked && preferences.releaseNotifications && story.notifyReleases !== false);
  const style = ui.storyAction;
  return <>
    <Pressable accessibilityRole="checkbox" accessibilityLabel="Auto-download new chapters" accessibilityHint="Future unread releases only, on Wi-Fi. Hold for details." accessibilityState={{ checked: automatic }} onLongPress={() => showSheet("Auto-download", "Only new unread releases found after enabling this option are saved, on unmetered Wi-Fi.")} onPress={() => {
      const enabled = toggleAutoDownload(item.slug);
      if (enabled && !alerts) showSheet("Release alerts?", "One notification per story, grouping new chapters.", [{ text: "Not now", style: "cancel" }, { text: "Notify me", onPress: () => void setStoryNotifications(item.slug, true) }]);
    }} style={style}><Icon name={automatic ? "cloud-download" : "cloud-download-outline"} size={20} tint={automatic ? color.lilac : color.muted} /></Pressable>
    <Pressable accessibilityRole="checkbox" accessibilityLabel="New chapter notifications" accessibilityState={{ checked: alerts }} onPress={() => void toggleStoryNotifications(item.slug)} style={style}><Icon name={alerts ? "notifications" : "notifications-outline"} size={20} tint={alerts ? color.lilac : color.muted} /></Pressable>
  </>;
}
