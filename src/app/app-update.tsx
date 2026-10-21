import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import NetInfo from "@react-native-community/netinfo";
import * as FileSystem from "expo-file-system/legacy";
import { useAppUpdates } from "../components/app-updates-provider";
import { Pressable } from "../components/pressable";
import { color, Icon, Page, ui } from "../components/ui";
import { appUpdates, installedApp } from "../lib/app-updates";
import type { AppUpdate } from "../lib/app-update-policy";
import { networkGuard } from "../lib/network";
import { loadPreferences } from "../lib/storage";
import { formatBytes, freeBytes } from "../lib/library-tools";

const folder = `${FileSystem.cacheDirectory}app-updates/`, apk = `${folder}update.apk`;
export default function AppUpdateScreen() {
  const { installed, update, checking, checkedAt, error: checkError, check } = useAppUpdates();
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0);
  const [status, setStatus] = useState(""), [error, setError] = useState("");
  const [ready, setReady] = useState<AppUpdate | null>(null), [permission, setPermission] = useState(false);
  const task = useRef<FileSystem.DownloadResumable | null>(null);
  const focused = useRef(true);
  useFocusEffect(useCallback(() => { focused.current = true; return () => { focused.current = false; }; }, []));
  const active = useRef(true), cancelled = useRef(false), verified = useRef(false), operating = useRef(false);
  useEffect(() => () => {
    active.current = false;
    const pending = task.current;
    if (pending) void pending.cancelAsync().catch(() => {}).finally(() => { if (!verified.current) void FileSystem.deleteAsync(apk, { idempotent: true }).catch(() => {}); });
  }, []);
  const install = useCallback(async (release: AppUpdate) => {
    if (!appUpdates || !focused.current || operating.current) return;
    operating.current = true; setBusy(true); setError(""); setPermission(false); setStatus("Verifying update…");
    try {
      await appUpdates.verify(apk, release.sha256, release.version);
      if (!active.current || !focused.current || AppState.currentState !== "active") return;
      const result = await appUpdates.install(apk, await FileSystem.getContentUriAsync(apk));
      if (result === "permission") { setPermission(true); setStatus("Allow updates from NightShelf, then return here."); }
      else setStatus("Confirm the update in Android’s installer. Your library and progress stay.");
    } catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : "Could not open Android’s installer."); }
    finally { operating.current = false; if (active.current) setBusy(false); }
  }, []);
  useEffect(() => {
    const listener = AppState.addEventListener("change", state => {
      if (state === "active" && permission && ready && installedApp()?.canInstall) void install(ready);
    });
    return () => listener.remove();
  }, [permission, ready, install]);
  // A cancelled installer can reuse the already verified download.
  useEffect(() => {
    if (!update || !appUpdates) return;
    let current = true;
    void FileSystem.getInfoAsync(apk).then(async info => {
      if (!info.exists || info.size !== update.size || operating.current) return;
      try {
        await appUpdates!.verify(apk, update.sha256, update.version);
        if (current && active.current && !operating.current) { verified.current = true; setReady(update); }
      } catch { /* A stale or interrupted APK is replaced by the next download. */ }
    }).catch(() => {});
    return () => { current = false; };
  }, [update]);
  async function download() {
    if (!update || !appUpdates || !FileSystem.cacheDirectory || operating.current) return;
    operating.current = true; cancelled.current = false; verified.current = false;
    setBusy(true); setProgress(0); setError(""); setReady(null); setStatus("Preparing update…");
    let unsubscribe: (() => void) | undefined;
    let complete = false;
    try {
      await networkGuard(`Download the ${formatBytes(update.size)} NightShelf update?`)();
      if (!active.current || !focused.current || AppState.currentState !== "active") return;
      if (freeBytes() < update.size + 32 * 1024 ** 2) throw new Error("Not enough free space for the update.");
      const initial = await NetInfo.fetch();
      const wifiOnly = initial.type === "wifi" && !initial.details?.isConnectionExpensive;
      await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
      await FileSystem.deleteAsync(apk, { idempotent: true });
      const transfer = FileSystem.createDownloadResumable(update.url, apk, {}, value => {
        if (active.current) setProgress(Math.max(0, Math.min(1, value.totalBytesWritten / update.size)));
      });
      task.current = transfer;
      unsubscribe = NetInfo.addEventListener(network => {
        if (network.isConnected === false || network.isInternetReachable === false || ((wifiOnly || loadPreferences().mobileData === "never") && (network.type !== "wifi" || network.details?.isConnectionExpensive))) {
          cancelled.current = true;
          void transfer.cancelAsync().catch(() => {});
          if (active.current) { setStatus("Download paused."); setError("Connection changed. Retry on Wi-Fi, or approve mobile data before downloading."); }
        }
      });
      setStatus("Downloading update…");
      const result = await transfer.downloadAsync();
      if (!result || cancelled.current) return;
      if (result.status !== 200) throw new Error(`Update download failed (${result.status}).`);
      const info = await FileSystem.getInfoAsync(apk);
      if (!info.exists || info.size !== update.size) throw new Error("The update download is incomplete. Retry it.");
      setStatus("Verifying update…");
      await appUpdates.verify(apk, update.sha256, update.version);
      complete = true; verified.current = true;
      if (active.current) { setReady(update); setStatus("Update ready to install."); }
    } catch (failure) { if (active.current && !cancelled.current) { setStatus(""); setError(failure instanceof Error ? failure.message : "Update download failed. Retry it."); } }
    finally {
      unsubscribe?.(); task.current = null;
      if (!complete) await FileSystem.deleteAsync(apk, { idempotent: true }).catch(() => {});
      operating.current = false;
      if (active.current) setBusy(false);
    }
    if (complete && active.current && focused.current && AppState.currentState === "active") await install(update);
  }
  const downloading = busy && status === "Downloading update…";
  const matchingReady = ready?.url === update?.url ? ready : null;
  return <Page title="App updates" subtitle="NIGHTSHELF" action={<Pressable accessibilityLabel="Back" onPress={() => router.back()} style={{padding:12}}><Icon name="arrow-back"/></Pressable>}><View style={{padding:22,gap:16}}>
    <Text style={ui.text}>{installed ? `Installed ${installed.version} · ${installed.architecture === "arm64" ? "ARM64" : "ARMv7"}` : "Install the next Android build once to enable in-app updates."}</Text>
    {update ? <><Text style={ui.title}>NightShelf {update.version}</Text><Text style={ui.muted}>{formatBytes(update.size)} · Your library and reading progress stay.</Text>{update.notes ? <Text selectable style={[ui.muted,{lineHeight:21}]}>{update.notes}</Text> : null}
      <Pressable disabled={busy} onPress={() => void (matchingReady ? install(matchingReady) : download())} style={ui.primary}><Text style={ui.primaryText}>{busy ? "Please wait…" : matchingReady ? "Install update" : "Download and install"}</Text></Pressable>
    </> : installed && <Text style={ui.muted}>{checking ? "Checking GitHub releases…" : checkedAt ? "No newer compatible update is published." : "Check for the latest compatible version."}</Text>}
    {busy && <View style={[ui.row,{gap:10}]}><ActivityIndicator color={color.lilac}/><Text accessibilityLiveRegion="polite" style={[ui.muted,{flex:1}]}>{status}{downloading ? ` · ${Math.floor(progress*100)}%` : ""}</Text>{downloading && <Pressable accessibilityLabel="Cancel app update download" onPress={() => { cancelled.current = true; void task.current?.cancelAsync().catch(() => {}); setStatus("Update download cancelled."); }} style={{padding:12}}><Icon name="close"/></Pressable>}</View>}
    {!busy && status ? <Text accessibilityLiveRegion="polite" style={ui.muted}>{status}</Text> : null}
    {error || checkError ? <Text accessibilityLiveRegion="polite" style={{color:"#f08080"}}>{error || checkError}</Text> : null}
    <Pressable disabled={checking || busy || !installed} onPress={() => void check(true)} style={[ui.chip,{alignSelf:"flex-start"}]}><Text style={{color:color.lilac}}>{checking ? "Checking…" : "Check now"}</Text></Pressable>
    <Text style={[ui.muted,{fontSize:12,lineHeight:19}]}>Updates come from NightShelf’s free GitHub releases. Downloads follow your mobile-data settings. Android asks you to approve installation.</Text>
  </View></Page>;
}
