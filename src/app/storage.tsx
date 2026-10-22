import { Pressable } from "../components/pressable";
import { useActionSheet } from "../components/action-sheet";
import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Page, ui, color, Icon } from "../components/ui";
import { useDownloads, useShelf } from "../lib/app-state";
import { formatBytes, storageSummaryAsync, verifyChapterFiles } from "../lib/library-tools";
import type { Series } from "../lib/parser";

export default function StorageManager() {
  const showSheet = useActionSheet();
  const { read, removeDownloads, downloadBusy, startDownload, deleting, catalog } = useShelf();
  const downloads = useDownloads(true);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof storageSummaryAsync>> | null>(null);
  const [busy, setBusy] = useState("");
  const [report, setReport] = useState("");
  const refresh = useCallback(() => { const controller = new AbortController(); void storageSummaryAsync(controller.signal).then(value => { if (!controller.signal.aborted) setSummary(value); }).catch(error => { if (!controller.signal.aborted) setReport(error instanceof Error ? error.message : String(error)); }); return () => controller.abort(); }, []);
  useFocusEffect(refresh);
  async function scan(item: Series) {
    setBusy(item.slug); setReport("");
    const bad: string[] = []; let legacy = 0, checked = 0;
    try {
      for (const id of item.localChapters || []) {
        await new Promise(resolve => setTimeout(resolve, 0));
        try { const value = verifyChapterFiles(item.slug, id); checked += value.checked; if (value.legacy) legacy++; if (value.damaged) bad.push(id); } catch { bad.push(id); }
      }
      setReport(`${item.title}: ${checked} files checked. ${bad.length} chapters need repair.${legacy ? ` ${legacy} older chapters lack checksums; repair will add them.` : ""}`);
      if (bad.length || legacy) showSheet("Chapter check complete", bad.length ? `${bad.length} chapters need repair. Valid original panels will be kept.` : "Older chapters can be checked by Android and given checksums without downloading valid panels again.", [{ text: "Later", style: "cancel" }, { text: "Repair", onPress: () => startDownload(item, (bad.length ? bad : item.localChapters || []).join(",")) }]);
    } finally { setBusy(""); }
  }
  function erase(item: Series, all = false) {
    const ids = (item.localChapters || []).filter(id => read[item.slug]?.[id]);
    showSheet(all ? "Delete all downloads for this story?" : `Delete ${ids.length} read chapters?`, "Bookmarks, lists and read history will stay.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => void removeDownloads(item, ids, all).then(() => storageSummaryAsync()).then(setSummary).catch(error => setReport(String(error))) }]);
  }
  function clearAllRead() {
    const stories = catalog.filter(item => item.localChapters?.some(id => read[item.slug]?.[id]));
    showSheet("Delete all read downloads?", `${stories.length} stories contain read chapters. Active or queued downloads will be skipped. Your reading history stays.`, [{ text: "Cancel", style: "cancel" }, { text: "Delete read", style: "destructive", onPress: () => { void (async () => { setBusy("cleanup"); let removed = 0, skipped = 0;
          try { for (const item of stories) {
            if (downloadBusy(item.slug) || downloads.some(job => job.series.slug === item.slug)) { skipped++; continue; }
            if (await removeDownloads(item, (item.localChapters || []).filter(id => read[item.slug]?.[id]))) removed++;
          } setSummary(await storageSummaryAsync()); setReport(`${removed} stories cleaned${skipped ? ` · ${skipped} busy stories skipped` : ""}`); }
          finally { setBusy(""); } })().catch(error => setReport(String(error))); } }]);
  }
  return <Page title="Storage" subtitle="ON THIS PHONE" action={<Pressable accessibilityLabel="Back" onPress={() => router.back()} style={{ padding: 12 }}><Icon name="arrow-back" /></Pressable>}><View style={{ paddingHorizontal: 22 }}>
    {!summary ? <ActivityIndicator color={color.lilac} /> : <><Text style={ui.title}>{formatBytes(summary.stories.reduce((sum, row) => sum + row.bytes, 0))} of chapters</Text><Text style={[ui.muted, { marginVertical: 10 }]}>{formatBytes(summary.free)} free on phone · {formatBytes(summary.covers)} cached covers</Text></>}
    <Pressable disabled={deleting || Boolean(busy)} onPress={clearAllRead} style={{ paddingVertical: 16 }}><Text style={{ color: "#f08080" }}>{deleting ? "Deleting…" : "Delete all read chapters"}</Text></Pressable>
    {report ? <Text accessibilityLiveRegion="polite" style={[ui.muted, { marginVertical: 12 }]}>{report}</Text> : null}
    {summary?.stories.map(({ item, bytes }) => {
      const blocked = downloadBusy(item.slug) || downloads.some(job => job.series.slug === item.slug) || deleting || Boolean(busy);
      const readCount = item.localChapters?.filter(id => read[item.slug]?.[id]).length || 0;
      return <View key={item.slug} style={{ paddingVertical: 18, borderBottomWidth: 1, borderColor: color.line }}>
        <Pressable onPress={() => router.push({ pathname: "/series/[slug]", params: { slug: item.slug, filter: "downloaded" } })}><Text style={[ui.text, { fontWeight: "700", fontSize: 16 }]}>{item.title}</Text><Text style={[ui.muted, { marginTop: 6 }]}>{formatBytes(bytes)} · {item.localChapters?.length || 0} chapters · {readCount} read</Text></Pressable>
        <View style={[ui.row, { flexWrap: "wrap", marginTop: 8, opacity: blocked ? 0.5 : 1 }]}><Pressable disabled={blocked} onPress={() => void scan(item)} style={{ paddingVertical: 10 }}>{busy === item.slug ? <ActivityIndicator color={color.lilac} /> : <Text style={{ color: color.lilac }}>Check & repair</Text>}</Pressable><Pressable disabled={blocked || !readCount} onPress={() => erase(item)} style={{ paddingVertical: 10 }}><Text style={{ color: readCount ? "#f08080" : color.muted }}>Delete read</Text></Pressable><Pressable disabled={blocked} onPress={() => erase(item, true)} style={{ paddingVertical: 10 }}><Text style={{ color: "#f08080" }}>Delete all</Text></Pressable></View>
        {blocked && !busy && <Text style={[ui.muted, { fontSize: 11 }]}>Finish or cancel this story’s queued transfer before managing its files.</Text>}
      </View>;
    })}
    {summary && !summary.stories.length && <Text style={ui.empty}>No chapters stored on this phone.</Text>}
  </View></Page>;
}
