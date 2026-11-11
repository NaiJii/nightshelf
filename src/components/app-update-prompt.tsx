import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { router, usePathname } from "expo-router";
import { useShelf } from "../lib/app-state";
import { useActionSheet, useActionSheetOpen } from "./action-sheet";
import { useAppUpdates } from "./app-updates-provider";

export function AppUpdatePrompt() {
  const { update, checking } = useAppUpdates();
  const { preferences, catalogReady } = useShelf();
  const showSheet = useActionSheet(), sheetOpen = useActionSheetOpen();
  const path = usePathname();
  const offered = useRef(new Set<string>());
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => setActive(state === "active"));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!update || checking || !catalogReady || !active || sheetOpen || preferences.autoAppUpdates === false || offered.current.has(update.version)
      || path.startsWith("/reader/") || path === "/app-update" || path === "/verify-source") return;
    offered.current.add(update.version);
    showSheet("Update available", `NightShelf ${update.version} is ready. Your library and reading progress stay.`, [
      { text: "Later", style: "cancel" },
      { text: "Review update", onPress: () => router.navigate("/app-update") },
    ]);
  }, [update, checking, catalogReady, active, sheetOpen, preferences.autoAppUpdates, path, showSheet]);
  return null;
}
