import { Tabs } from "expo-router";
import { View } from "react-native";
import { Icon, color } from "../../components/ui";
import { useDownloads, useShelf } from "../../lib/app-state";
import { unreadReleases } from "../../lib/release-policy";

export default function TabLayout() {
  const { catalog, updates, read, saved } = useShelf();
  const downloads = useDownloads(true);
  const updatedStories = catalog.filter(item => saved[item.slug]?.bookmarked && unreadReleases(updates[item.slug], read[item.slug], item.chapterIds).length).length;
  return <View style={{ flex: 1, backgroundColor: color.bg }}>
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: color.lilac, tabBarInactiveTintColor: color.muted, tabBarStyle: { backgroundColor: "#111118", borderTopColor: color.line }, tabBarLabelStyle: { fontSize: 10, fontWeight: "700" } }}>
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ focused, color: tint }) => <Icon name={focused ? "home" : "home-outline"} tint={tint} /> }} />
      <Tabs.Screen name="explore" options={{ title: "Explore", tabBarIcon: ({ focused, color: tint }) => <Icon name={focused ? "compass" : "compass-outline"} tint={tint} /> }} />
      <Tabs.Screen name="library" options={{ title: "Library", tabBarBadge: downloads.length ? `↓${downloads.length}` : updatedStories ? Math.min(99, updatedStories) : undefined, tabBarBadgeStyle: { backgroundColor: color.purple, color: "white" }, tabBarIcon: ({ focused, color: tint }) => <Icon name={focused ? "library" : "library-outline"} tint={tint} /> }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ focused, color: tint }) => <Icon name={focused ? "options" : "options-outline"} tint={tint} /> }} />
    </Tabs>
  </View>;
}
