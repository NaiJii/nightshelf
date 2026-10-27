import { ToggleRow } from "./toggle-row";
import { Pressable } from "./pressable";
import { RefObject, useCallback, useState } from "react";
import { AppState, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { WebView } from "react-native-webview";
import { readerControls } from "../lib/reader-controls";
import { useShelf } from "../lib/app-state";
import { color, Icon, ui } from "./ui";

export function useReaderConveniences(web: RefObject<WebView | null>, enabled: boolean) {
  const { preferences: p } = useShelf();
  const [error, setError] = useState("");
  useFocusEffect(useCallback(() => {
    const controls = readerControls;
    if (!controls) return;
    let focused = true;
    const apply = (active: boolean) => {
      void controls.configure(active && enabled, true, p.readerBrightness, p.readerVolumeScroll).catch(() => {
        if (focused) setError("Reader controls could not be applied. Close and reopen the chapter to retry.");
      });
    };
    apply(AppState.currentState === "active");
    const app = AppState.addEventListener("change", state => apply(state === "active"));
    const keys = controls.addListener("onVolumeKey", ({ direction }) => {
      if (focused && enabled && p.readerVolumeScroll && AppState.currentState === "active" && (direction === 1 || direction === -1)) {
        web.current?.injectJavaScript(`window.scrollBy({top:${direction} * Math.max(80, (window.visualViewport ? window.visualViewport.height : innerHeight) * 0.8),behavior:'smooth'});true;`);
      }
    });
    return () => { focused = false; app.remove(); keys.remove(); apply(false); };
  }, [enabled, p.readerBrightness, p.readerVolumeScroll, web]));
  return error;
}

export function ReaderOptions({ error }: { error: string }) {
  const { preferences: p, updatePreferences: update } = useShelf();
  const brightness = p.readerBrightness < 0 ? 0.5 : p.readerBrightness;
  return <View style={{ paddingHorizontal: 18, paddingVertical: 10, backgroundColor: color.surface, borderBottomWidth: 1, borderColor: color.line }}>
    <View style={[ui.row, { justifyContent: "space-between" }]}><Text style={ui.text}>Brightness</Text><View style={[ui.row, { gap: 4 }]}><Pressable accessibilityLabel="Use phone brightness" accessibilityState={{ selected: p.readerBrightness < 0 }} onPress={() => update({ readerBrightness: -1 })} style={{ padding: 10 }}><Text style={{ color: p.readerBrightness < 0 ? color.lilac : color.muted }}>System</Text></Pressable><Pressable accessibilityLabel="Dim reader" onPress={() => update({ readerBrightness: Math.max(0.1, Math.round((brightness - 0.1) * 10) / 10) })} style={{ padding: 10 }}><Icon name="remove" size={18} /></Pressable><Text accessibilityLiveRegion="polite" style={[ui.muted, { minWidth: 38, textAlign: "center" }]}>{p.readerBrightness < 0 ? "Auto" : `${Math.round(brightness * 100)}%`}</Text><Pressable accessibilityLabel="Brighten reader" onPress={() => update({ readerBrightness: Math.min(1, Math.round((brightness + 0.1) * 10) / 10) })} style={{ padding: 10 }}><Icon name="add" size={18} /></Pressable></View></View>
    <ToggleRow title="Scroll with volume buttons" value={p.readerVolumeScroll} onValueChange={readerVolumeScroll => update({readerVolumeScroll})} />
    <ToggleRow title="Prefetch next 2 chapters" label="Prefetch next 2 chapters on Wi-Fi" description="Wi-Fi only, within your automatic download limit." value={p.readerPrefetch} onValueChange={readerPrefetch => update({readerPrefetch})} />
    <ToggleRow title="Delete after reading" label="Delete chapter after reading when you leave" description="Remove completed chapters when you leave the reader." value={p.deleteAfterReading} onValueChange={deleteAfterReading => update({deleteAfterReading})} />
    {error ? <Text style={[ui.muted, { fontSize: 11, marginTop: 4 }]}>{error}</Text> : null}
  </View>;
}
