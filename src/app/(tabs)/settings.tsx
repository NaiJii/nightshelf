import { ToggleRow } from "../../components/toggle-row";
import { Pressable } from "../../components/pressable";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { useShelf } from "../../lib/app-state";
import { useAppUpdates } from "../../components/app-updates-provider";
import { Chip, color, Icon, Page, ui } from "../../components/ui";

export default function Settings() {
  const { preferences: p, updatePreferences: update, setReleaseNotifications, notificationBusy } = useShelf();
  const appUpdate = useAppUpdates();
  return <Page title="Settings" subtitle="PREFERENCES"><View style={{ paddingHorizontal: 22 }}>
    {([["/storage", "Storage & cleanup", "server-outline"], ["/backup", "Backup & restore", "save-outline"], ["/source-health", "Source health", "pulse-outline"]] as const).map(([path, label, icon]) => <Pressable key={path} onPress={() => router.push(path)} style={[ui.row, { paddingVertical: 12, minHeight: 48, borderBottomWidth: 1, borderColor: color.line }]}><Icon name={icon} tint={color.lilac} /><Text style={[ui.text, { flex: 1, fontSize: 16, fontWeight: "600" }]}>{label}</Text><Icon name="chevron-forward" size={16} tint={color.muted} /></Pressable>)}
    <Pressable onPress={() => router.navigate("/app-update")} style={[ui.row,{paddingVertical:12,minHeight:48,borderBottomWidth:1,borderColor:color.line}]}><Icon name="arrow-up-circle-outline" tint={color.lilac}/><View style={{flex:1}}><Text style={[ui.text,{fontSize:16,fontWeight:"600"}]}>App updates{appUpdate.update ? ` · ${appUpdate.update.version} available` : ""}</Text><Text style={[ui.muted,{fontSize:11,marginTop:4}]}>{appUpdate.installed ? `Installed ${appUpdate.installed.version}` : "Unavailable in this installation"}</Text></View><Icon name="chevron-forward" tint={color.muted} size={16}/></Pressable>
    <ToggleRow title="Check for app updates" label="Automatically check for app updates" description="On every launch over unmetered Wi-Fi. Prompts when an update is available." value={p.autoAppUpdates !== false} onValueChange={autoAppUpdates => update({autoAppUpdates})} />
    <Text style={[ui.title, { fontSize:18, marginTop: 22 }]}>Automatic download limit</Text><Text style={[ui.muted, { marginTop: 8 }]}>Maximum storage for automatic downloads. Manual downloads remain available.</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 16 }}>{[512, 1024, 2048, 5120, 10240].map(autoDownloadLimitMB => <Chip key={autoDownloadLimitMB} text={autoDownloadLimitMB < 1024 ? "512 MB" : `${autoDownloadLimitMB / 1024} GB`} active={p.autoDownloadLimitMB === autoDownloadLimitMB} onPress={() => update({ autoDownloadLimitMB })} />)}</View>
    <ToggleRow title="Bookmarked releases" label="Bookmarked release notifications" description="Choose alerts with each story’s bell icon. Chapters are grouped per story." value={p.releaseNotifications} busy={notificationBusy} onValueChange={value => void setReleaseNotifications(value)} />
    <Text style={[ui.title,{fontSize:18}]}>Background release checks</Text><Text style={[ui.muted, { marginTop: 6 }]}>Wi-Fi only. Android may delay checks.</Text><View style={{ flexDirection: "row", gap: 8, marginVertical: 16 }}>{([60, 120] as const).map(releaseCheckInterval => <Chip key={releaseCheckInterval} text={releaseCheckInterval === 60 ? "Every hour" : "Every 2 hours"} active={p.releaseCheckInterval === releaseCheckInterval} onPress={() => update({ releaseCheckInterval })} />)}</View>
    <ToggleRow title="Automatic sync" description="On opening and while NightShelf is active." value={p.autoSync} onValueChange={autoSync => update({autoSync})} />
    <View style={[ui.row, { marginVertical: 20 }]}>{([5, 10] as const).map(interval => <Chip key={interval} text={`Every ${interval} minutes`} active={p.interval === interval} onPress={() => update({ interval })} />)}</View>
    <Text style={[ui.title, {fontSize:18, marginTop:18}]}>Metered connections</Text><Text style={[ui.muted, { marginTop: 8 }]}>Includes mobile data and Wi-Fi marked as metered by Android.</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 16 }}>{([['ask', 'Ask first'], ['never', 'Unmetered Wi-Fi'], ['allow', 'Always allow']] as const).map(([mobileData, text]) => <Chip key={mobileData} text={text} active={p.mobileData === mobileData} onPress={() => update({ mobileData })} />)}</View>
  </View></Page>;
}
