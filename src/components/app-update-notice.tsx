import { Text } from "react-native";
import { router } from "expo-router";
import { useAppUpdates } from "./app-updates-provider";
import { Pressable } from "./pressable";
import { color, Icon, ui } from "./ui";
export function AppUpdateNotice() {
  const { update } = useAppUpdates();
  return update ? <Pressable accessibilityLabel={`NightShelf ${update.version} update available`} onPress={() => router.navigate("/app-update")} style={[ui.row,{marginHorizontal:22,marginVertical:10,padding:12,gap:8,borderRadius:12,backgroundColor:color.surface}]}><Icon name="arrow-up-circle-outline" tint={color.lilac} size={18}/><Text style={[ui.muted,{flex:1,fontSize:12}]}>NightShelf {update.version} is available</Text><Icon name="chevron-forward" tint={color.muted} size={14}/></Pressable> : null;
}
