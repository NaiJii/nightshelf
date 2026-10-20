import { Pressable } from "./pressable";
import { ActivityIndicator, Text } from "react-native";
import { useShelf } from "../lib/app-state";
import type { ReadingList, Series } from "../lib/parser";
import { color, Icon } from "./ui";
import { useActionSheet } from "./action-sheet";
export const READING_LISTS: [ReadingList, string][] = [["reading", "Reading"], ["planned", "Plan to read"], ["finished", "Finished"], ["hold", "On hold"]];
export function ReadingListAction({ item, iconsOnly = false }: { item: Series; iconsOnly?: boolean }) {
  const { saved, setStoryOptions } = useShelf();
  const showSheet = useActionSheet();
  const list = saved[item.slug]?.list;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Reading list: ${READING_LISTS.find(([key]) => key === list)?.[1] || "None"}. Choose reading list`} onPress={() => showSheet("Reading list", item.title, [
    ...READING_LISTS.map(([value, text]) => ({ text, selected: list === value, onPress: () => setStoryOptions(item.slug, { list: value }) })),
    { text: "No list", selected: !list, onPress: () => setStoryOptions(item.slug, { list: undefined }) },
    { text: "Cancel", style: "cancel" },
  ])} style={{ flex: 1, minHeight: 60, paddingVertical: 10, alignItems: "center", justifyContent: "center", gap: 5 }}><Icon name={list ? "list" : "list-outline"} size={20} tint={list ? color.lilac : color.muted} />{!iconsOnly && <Text numberOfLines={1} style={{ color: list ? color.lilac : color.muted, fontSize: 11 }}>{READING_LISTS.find(([key]) => key === list)?.[1] || "Reading list"}</Text>}</Pressable>;
}
export function ReleaseActions({ item }: { item: Series }) {
  const { saved, preferences, setStoryOptions, setStoryNotifications, notificationBusy } = useShelf();
  const showSheet = useActionSheet();
  const story = saved[item.slug], automatic = Boolean(story?.bookmarked && story.autoDownload);
  const alerts = Boolean(story?.bookmarked && preferences.releaseNotifications && story.notifyReleases !== false);
  const style = { flex: 1, minHeight: 60, alignItems: "center" as const, justifyContent: "center" as const };
  return <>
    <Pressable accessibilityRole="checkbox" accessibilityLabel="Auto-download new chapters" accessibilityHint="Future unread releases only, on Wi-Fi. Hold for details." accessibilityState={{ checked: automatic }} onLongPress={() => showSheet("Auto-download", "Only new unread releases found after enabling this option are saved, on unmetered Wi-Fi.")} onPress={() => {
      setStoryOptions(item.slug, { autoDownload: !automatic });
      if (!automatic && !alerts) showSheet("Release alerts?", "One notification per story, grouping new chapters.", [{ text: "Not now", style: "cancel" }, { text: "Notify me", onPress: () => void setStoryNotifications(item.slug, true) }]);
    }} style={style}><Icon name={automatic ? "cloud-download" : "cloud-download-outline"} size={22} tint={automatic ? color.lilac : color.muted} /></Pressable>
    <Pressable accessibilityRole="checkbox" accessibilityLabel="New chapter notifications" accessibilityState={{ checked: alerts, disabled: notificationBusy }} disabled={notificationBusy} onPress={() => void setStoryNotifications(item.slug, !alerts)} style={style}>{notificationBusy ? <ActivityIndicator size="small" color={color.lilac} /> : <Icon name={alerts ? "notifications" : "notifications-outline"} size={22} tint={alerts ? color.lilac : color.muted} />}</Pressable>
  </>;
}
