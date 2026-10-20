import { RefObject, useCallback, useState } from "react";
import { AppState, Pressable, Switch, Text, View } from "react-native";
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
      void controls.configure(active && enabled, p.readerKeepAwake, p.readerBrightness, p.readerVolumeScroll).catch(() => {
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
  }, [enabled, p.readerBrightness, p.readerKeepAwake, p.readerVolumeScroll, web]));
  return error;
}

export function ReaderOptions({ error }: { error: string }) {
  const { preferences: p, updatePreferences: update } = useShelf();
  const brightness = p.readerBrightness < 0 ? 0.5 : p.readerBrightness;
  return <View style={{ paddingHorizontal: 18, paddingVertical: 10, backgroundColor: color.surface, borderBottomWidth: 1, borderColor: color.line }}>
    <View style={[ui.row, { justifyContent: "space-between" }]}><Text style={ui.text}>Brightness</Text><View style={[ui.row, { gap: 4 }]}><Pressable accessibilityLabel="Use phone brightness" accessibilityState={{ selected: p.readerBrightness < 0 }} onPress={() => update({ readerBrightness: -1 })} style={{ padding: 10 }}><Text style={{ color: p.readerBrightness < 0 ? color.lilac : color.muted }}>System</Text></Pressable><Pressable accessibilityLabel="Dim reader" onPress={() => update({ readerBrightness: Math.max(0.1, Math.round((brightness - 0.1) * 10) / 10) })} style={{ padding: 10 }}><Icon name="remove" size={18} /></Pressable><Text accessibilityLiveRegion="polite" style={[ui.muted, { minWidth: 38, textAlign: "center" }]}>{p.readerBrightness < 0 ? "Auto" : `${Math.round(brightness * 100)}%`}</Text><Pressable accessibilityLabel="Brighten reader" onPress={() => update({ readerBrightness: Math.min(1, Math.round((brightness + 0.1) * 10) / 10) })} style={{ padding: 10 }}><Icon name="add" size={18} /></Pressable></View></View>
    <View style={[ui.row, { justifyContent: "space-between" }]}><Text style={ui.text}>Keep screen awake</Text><Switch accessibilityLabel="Keep screen awake while reading" value={p.readerKeepAwake} onValueChange={readerKeepAwake => update({ readerKeepAwake })} trackColor={{ true: color.purple }} /></View>
    <View style={[ui.row, { justifyContent: "space-between" }]}><Text style={ui.text}>Scroll with volume buttons</Text><Switch accessibilityLabel="Scroll with volume buttons" value={p.readerVolumeScroll} onValueChange={readerVolumeScroll => update({ readerVolumeScroll })} trackColor={{ true: color.purple }} /></View>
    <Pressable accessibilityRole="checkbox" accessibilityLabel="Delete chapter after reading when you leave" accessibilityState={{ checked: p.deleteAfterReading }} onPress={() => update({ deleteAfterReading: !p.deleteAfterReading })} style={[ui.row, { paddingVertical: 12, gap: 12 }]}><View style={{ flex: 1 }}><Text style={ui.text}>Delete after reading</Text><Text style={[ui.muted, { fontSize: 11, marginTop: 4 }]}>Remove completed chapters when you leave the reader.</Text></View><Icon name={p.deleteAfterReading ? "checkbox" : "square-outline"} tint={color.lilac} size={23} /></Pressable>
    <Text style={[ui.muted, { fontSize: 11, marginTop: 4 }]}>{error || (!readerControls ? "Install the latest Android build to use these controls." : "Volume down moves forward; volume up moves back. Phone brightness and volume controls return when you leave.")}</Text>
  </View>;
}
