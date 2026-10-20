import { router, Stack } from "expo-router";
import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { loadCatalog } from "../lib/storage";
import { StatusBar } from "expo-status-bar";
import { AppProvider } from "../lib/app-state";
import { ActionSheetProvider } from "../components/action-sheet";

export default function RootLayout() {
  useEffect(() => {
    let handled = "";
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const token = `${response.notification.request.identifier}/${response.notification.date}`;
      if (handled === token) return;
      const slug = response.notification.request.content.data?.slug;
      if (typeof slug !== "string" || !loadCatalog().some(item => item.slug === slug)) return;
      handled = token;
      router.push({ pathname: "/series/[slug]", params: { slug, filter: "unread" } });
      void Notifications.clearLastNotificationResponseAsync();
    };
    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, []);
  return (
    <AppProvider>
      <ActionSheetProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0b0b10" } }} />
      </ActionSheetProvider>
    </AppProvider>
  );
}
