import { ActivityIndicator, Text, View } from "react-native";
import type { Series } from "../lib/parser";
import { readingActionLabel } from "../lib/reading-ux";
import { useReaderNavigation } from "./use-reader-navigation";
import { Pressable } from "./pressable";
import { color, Icon, ui } from "./ui";

export function ReadingAction({ item, chapter, fraction, read }: { item: Series; chapter: string; fraction: number; read: boolean }) {
  const navigation = useReaderNavigation(item.slug, item.title, undefined, undefined, true);
  const saved = Boolean(item.localChapters?.includes(chapter));
  const label = readingActionLabel(chapter, saved, fraction, read);
  return <View>
    <Pressable accessibilityLabel={label} disabled={navigation.busy} onPress={() => navigation.go(chapter)} style={[ui.row, { minHeight: 44, gap: 7 }]}>
      {navigation.busy ? <ActivityIndicator size="small" color={color.lilac} /> : <Icon name={saved ? "play" : "download-outline"} size={13} tint={color.lilac} />}
      <Text style={{ color: color.lilac, fontWeight: "700", fontSize: 12 }}>{navigation.busy ? "Preparing…" : label}</Text>
    </Pressable>
    {navigation.needsVerification && <Pressable onPress={navigation.verify} style={{paddingVertical:12}}><Text style={{color:color.lilac,fontSize:12}}>Verify and retry</Text></Pressable>}
    {navigation.status ? <Pressable accessibilityLabel={navigation.busy ? "Cancel reader download" : "Dismiss reading status"} onPress={navigation.busy ? navigation.cancel : navigation.clearStatus} style={{ paddingVertical: 8 }}><Text accessibilityLiveRegion="polite" style={[ui.muted, { fontSize: 11 }]}>{navigation.status}{navigation.busy ? " · Cancel" : ""}</Text></Pressable> : null}
  </View>;
}
