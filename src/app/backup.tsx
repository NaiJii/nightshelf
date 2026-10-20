import { useActionSheet } from "../components/action-sheet";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { File } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { backupFile, restoreBackup, validateBackup } from "../lib/backup";
import { useShelf } from "../lib/app-state";
import { Page, ui, Icon, color } from "../components/ui";

export default function Backups() {
  const showSheet = useActionSheet();
  const { reloadLocal, downloadBusy, deleting } = useShelf();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  async function exportFile() {
    setBusy("Preparing backup…");
    try { await new Promise(resolve => setTimeout(resolve, 20)); const file = backupFile(); if (!await Sharing.isAvailableAsync()) throw new Error("File sharing is unavailable on this device."); await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "Save NightShelf backup" }); setMessage("Backup prepared. Keep the exported file somewhere you can access on your next phone."); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); }
  }
  async function importFile() {
    if (downloadBusy() || deleting) { setMessage("Pause active transfers and wait for deletion to finish before importing."); return; }
    setBusy("Opening backup…");
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ["application/json", "text/plain", "application/octet-stream"], copyToCacheDirectory: true });
      if (picked.canceled) return;
      const file = new File(picked.assets[0].uri);
      if (file.size > 20 * 1024 ** 2) throw new Error("Metadata backups must be smaller than 20 MB.");
      const text = await file.text(); const data = validateBackup(text);
      showSheet("Merge this backup?", `${data.catalog.length} stories and ${Object.values(data.read).reduce((n, chapters) => n + Object.keys(chapters).length, 0)} read chapters. Existing downloads stay. Newer local reading positions are preserved.`, [{ text: "Cancel", style: "cancel" }, { text: "Import", onPress: () => { void (async () => { setBusy("Restoring…"); try { if (downloadBusy() || deleting) throw new Error("Wait for active transfers to finish."); await new Promise(resolve => setTimeout(resolve, 20)); const count = restoreBackup(text); reloadLocal(); setMessage(`Imported ${count} stories. Bookmarks, lists and read history are ready.`); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(""); } })(); } }]);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); }
  }
  return <Page title="Backup & restore" subtitle="TAKE YOUR LIBRARY WITH YOU" action={<Pressable accessibilityLabel="Back" onPress={() => router.back()} style={{ padding: 12 }}><Icon name="arrow-back" /></Pressable>}><View style={{ paddingHorizontal: 22 }}>
    <Text style={ui.muted}>A portable file containing your stories, bookmarks, likes, reading lists, read chapters, reading positions and reader settings. Save it to Files or a drive you already use. No NightShelf account is needed.</Text>
    <Text style={[ui.muted, { marginTop: 14 }]}>Chapter images and novel text are not included. Download them again after importing on another phone. Automatic downloads and notification permissions are not enabled by importing a backup.</Text>
    <Pressable disabled={Boolean(busy)} onPress={() => void exportFile()} style={[ui.primary, { marginTop: 24 }]}><Text style={ui.primaryText}>Export backup</Text></Pressable>
    <Pressable disabled={Boolean(busy)} onPress={() => void importFile()} style={[ui.row, { justifyContent: "center", padding: 20 }]}><Icon name="document-outline" tint={color.lilac} /><Text style={{ color: color.lilac }}>Import backup</Text></Pressable>
    {busy ? <View style={ui.row}><ActivityIndicator color={color.lilac} /><Text style={ui.muted}>{busy}</Text></View> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={ui.muted}>{message}</Text> : null}
  </View></Page>;
}
