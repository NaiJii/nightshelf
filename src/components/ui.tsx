import { Pressable } from "./pressable";
import { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, ColorValue, Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { Series } from "../lib/parser";
import { useShelf } from "../lib/app-state";

export const color = { bg: "#0b0b10", surface: "#17171f", raised: "#24232f", text: "#f7f4fb", muted: "#aaa6b3", purple: "#8b5cf6", lilac: "#c9a7ff", line: "#ffffff14" };
export function Icon({ name, size = 22, tint = color.text }: { name: ComponentProps<typeof Ionicons>["name"]; size?: number; tint?: ColorValue }) { return <Ionicons name={name} size={size} color={tint} />; }
export function Cover({ item, style }: { item: Series; style: object }) {
  // Only cached covers are rendered: remote Image requests must not bypass the data-consent gate.
  return item.localCover ? <Image source={{ uri: item.localCover }} style={style} resizeMode="cover" /> : <View style={[style, { backgroundColor: color.raised, alignItems: "center", justifyContent: "center" }]}><Icon name="book-outline" tint={color.muted} /></View>;
}
export function Page({ title, subtitle, children, action }: { title: string; subtitle: string; children: ReactNode; action?: ReactNode }) {
  const shelf = useShelf();
  return <SafeAreaView edges={["top"]} style={ui.safe}>
    <ScrollView contentContainerStyle={ui.page} refreshControl={<RefreshControl refreshing={shelf.refreshing} onRefresh={() => void shelf.sync()} tintColor={color.lilac} colors={[color.purple]} />}>
      <PageHeading title={title} subtitle={subtitle} action={action} />
      {children}
    </ScrollView>
  </SafeAreaView>;
}
export function PageHeading({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  const shelf = useShelf();
  const tint = shelf.connection.warning ? "#d6b782" : color.muted;
  return <><View style={ui.header}><View style={{ flex: 1 }}><Text style={ui.eyebrow}>{subtitle}</Text><Text style={ui.pageTitle}>{title}</Text></View><View style={{ alignItems: "flex-end", gap: 5 }}><View accessible accessibilityLabel={`Connection: ${shelf.connection.label}`} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Icon name={shelf.connection.icon} size={12} tint={tint} /><Text style={{ color: tint, fontSize: 10 }}>{shelf.connection.label}</Text></View>{shelf.syncing && <ActivityIndicator size="small" color={color.lilac} accessibilityLabel="Syncing in background" />}</View>{action}</View>{shelf.notice ? <Pressable accessibilityRole="button" accessibilityLabel={`${shelf.notice} Tap to dismiss`} onPress={shelf.dismissNotice} style={ui.notice}><Text style={[ui.muted, { flex: 1 }]}>{shelf.notice}</Text><Icon name="close" size={16} /></Pressable> : null}</>;
}
export function Chip({ text, active, onPress }: { text: string; active?: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(active) }} onPress={onPress} style={[ui.chip, active && ui.activeChip]}><Text style={[ui.chipText, active && { color: color.text }]}>{text}</Text></Pressable>; }
export const ui = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg }, page: { paddingBottom: 26 }, header: { padding: 22, flexDirection: "row", alignItems: "center" }, pageTitle: { color: color.text, fontSize: 32, fontWeight: "900", letterSpacing: -1 }, eyebrow: { color: color.lilac, fontSize: 10, letterSpacing: 2, fontWeight: "800", marginBottom: 5 }, section: { paddingHorizontal: 20, marginTop: 28 }, title: { color: color.text, fontSize: 23, fontWeight: "800", letterSpacing: -0.6 }, muted: { color: color.muted, fontSize: 13, lineHeight: 20 }, text: { color: color.text }, row: { flexDirection: "row", alignItems: "center", gap: 12 }, chip: { paddingHorizontal: 15, minHeight: 42, justifyContent: "center", borderRadius: 22, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line }, activeChip: { backgroundColor: "#8b5cf62b", borderColor: color.purple }, chipText: { color: color.muted, fontSize: 12, fontWeight: "700" }, chips: { gap: 8, paddingVertical: 14, paddingHorizontal: 20 }, primary: { minHeight: 48, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 14, backgroundColor: color.purple, alignItems: "center", justifyContent: "center" }, primaryText: { color: "white", fontWeight: "800" }, notice: { marginHorizontal: 20, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderColor: color.line }, empty: { color: color.muted, paddingVertical: 24, lineHeight: 23 },
});
