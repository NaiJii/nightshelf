import { Pressable } from "./pressable";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { color, Icon, ui } from "./ui";

type Action = { text: string; style?: "default" | "cancel" | "destructive"; selected?: boolean; onPress?: () => void };
type Sheet = { title: string; message?: string; actions: Action[] };
type ShowSheet = (title: string, message?: string, actions?: Action[]) => void;
const SheetContext = createContext<ShowSheet | null>(null);

export function ActionSheetProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const current = useRef<Sheet | null>(null);
  const showSheet = useCallback<ShowSheet>((title, message, actions) => {
    const next = { title, message, actions: actions?.length ? actions : [{ text: "OK" }] };
    current.current = next; setSheet(next);
  }, []);
  function close() { current.current = null; setSheet(null); }
  function choose(action: Action) {
    if (!sheet || current.current !== sheet) return;
    close(); action.onPress?.();
  }
  return <SheetContext.Provider value={showSheet}>{children}
    <Modal visible={Boolean(sheet)} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss menu" onPress={close} style={{ position: "absolute", inset: 0, backgroundColor: "#00000099" }} />
        <SafeAreaView accessibilityViewIsModal edges={["bottom"]} style={{ backgroundColor: color.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: color.line, paddingHorizontal: 20, paddingTop: 8, maxHeight: "85%", width: "100%", maxWidth: 560, alignSelf: "center" }}>
          <View style={{ width: 34, height: 4, backgroundColor: color.raised, borderRadius: 3, alignSelf: "center", marginVertical: 6 }} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
            <View style={[ui.row, { gap: 8 }]}><Text accessibilityRole="header" style={[ui.title, { flex: 1, fontSize: 22 }]}>{sheet?.title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={close} style={{ padding: 12 }}><Icon name="close" tint={color.muted} size={20} /></Pressable></View>
            {sheet?.message ? <Text style={[ui.muted, { marginTop: 4, marginBottom: 14 }]}>{sheet.message}</Text> : null}
            {sheet?.actions.filter(action => action.style !== "cancel").map((action, index) => <Pressable key={index} accessibilityRole="button" accessibilityState={{ selected: action.selected }} onPress={() => choose(action)} style={({ pressed }) => [ui.row, { minHeight: 56, paddingHorizontal: 14, paddingVertical: 14, gap: 12, marginTop: 8, borderRadius: 14, backgroundColor: pressed ? color.raised : action.style === "destructive" ? "#f0808010" : color.bg, borderWidth: 1, borderColor: action.selected ? color.purple : color.line }]}>
              <Icon name={action.selected ? "checkmark-circle" : action.style === "destructive" ? "trash-outline" : "chevron-forward"} tint={action.style === "destructive" ? "#f08080" : color.lilac} size={19} /><Text style={{ flex: 1, color: action.style === "destructive" ? "#f08080" : color.text, fontSize: 15, fontWeight: "600" }}>{action.text}</Text>
            </Pressable>)}
            {sheet?.actions.filter(action => action.style === "cancel").map((action, index) => <Pressable key={index} accessibilityRole="button" onPress={() => choose(action)} style={{ padding: 16, alignItems: "center", marginTop: 8 }}><Text style={{ color: color.muted, fontWeight: "600" }}>{action.text}</Text></Pressable>)}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  </SheetContext.Provider>;
}

export function useActionSheet(): ShowSheet {
  const show = useContext(SheetContext);
  if (!show) throw new Error("Action sheets require ActionSheetProvider.");
  return show;
}
