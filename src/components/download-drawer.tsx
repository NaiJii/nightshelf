import { useCallback, useState, type ReactNode } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { usePathname } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useDownloads } from "../lib/app-state";
import { DownloadList } from "./download-list";
import { Pressable } from "./pressable";
import { color, Icon, ui } from "./ui";

import { DownloadDrawerContext } from "./download-drawer-context";
export { useDownloadDrawer } from "./download-drawer-context";
export function DownloadDrawerProvider({ children }: { children: ReactNode }) {
  const [openedPath, setOpenedPath] = useState<string | null>(null);
  const pathname = usePathname();
  const open = openedPath === pathname;
  if (openedPath !== null && openedPath !== pathname) setOpenedPath(null);
  const show = useCallback(() => setOpenedPath(pathname), [pathname]);
  return <DownloadDrawerContext.Provider value={show}>{children}<Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setOpenedPath(null)}>
    <View style={{flex:1,justifyContent:"flex-end"}}><Pressable accessibilityLabel="Close downloads" onPress={()=>setOpenedPath(null)} style={{position:"absolute",inset:0,backgroundColor:"#0009"}}/>
      <SafeAreaView edges={["bottom"]} accessibilityViewIsModal style={{maxHeight:"85%",backgroundColor:color.surface,borderTopLeftRadius:24,borderTopRightRadius:24,paddingHorizontal:20}}>
        <View style={[ui.row,{justifyContent:"space-between",paddingTop:12}]}><Text style={ui.title}>Download queue</Text><Pressable accessibilityLabel="Close download queue" onPress={()=>setOpenedPath(null)} style={{padding:14}}><Icon name="close"/></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled"><DownloadList showHeading={false} onOpenStory={()=>setOpenedPath(null)}/><EmptyQueue/></ScrollView>
      </SafeAreaView>
    </View>
  </Modal></DownloadDrawerContext.Provider>;
}
function EmptyQueue() { return useDownloads(true).length ? null : <Text style={[ui.empty,{paddingVertical:30}]}>No downloads queued.</Text>; }
