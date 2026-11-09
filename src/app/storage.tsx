import { Pressable } from "../components/pressable";
import { useActionSheet } from "../components/action-sheet";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Page, ui, color, Icon } from "../components/ui";
import { useDownloads, useShelf } from "../lib/app-state";
import { formatBytes, storageSummaryAsync, verifyChapterFiles } from "../lib/library-tools";
import type { Series } from "../lib/parser";
import { downloadConflicts } from "../lib/download-display";

export default function StorageManager() {
  const showSheet = useActionSheet();
  const { read, removeDownloads, downloadBusy, startDownload, deleting, catalog } = useShelf();
  const downloads = useDownloads(true);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof storageSummaryAsync>> | null>(null);
  const [busy, setBusy] = useState("");
  const [report, setReport] = useState("");
  const summaryRequest = useRef<AbortController | null>(null), operation = useRef<AbortController | null>(null);
  const focused = useRef(false);
  const refresh = useCallback(() => { summaryRequest.current?.abort(); const controller = new AbortController(); summaryRequest.current = controller; void storageSummaryAsync(controller.signal).then(value => { if (!controller.signal.aborted) setSummary(value); }).catch(error => { if (!controller.signal.aborted) setReport(error instanceof Error ? error.message : String(error)); }); return () => controller.abort(); }, []);
  useFocusEffect(useCallback(() => {
    focused.current = true; setBusy(""); const stop = refresh();
    return () => { focused.current = false; stop(); summaryRequest.current?.abort(); operation.current?.abort(); };
  }, [refresh]));
  async function scan(item: Series) {
    if (operation.current && !operation.current.signal.aborted) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(item.slug); setReport("");
    const bad: string[] = []; let legacy = 0, checked = 0;
    try {
      for (const id of item.localChapters || []) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (controller.signal.aborted) return;
        try { const value = verifyChapterFiles(item.slug, id); checked += value.checked; if (value.legacy) legacy++; if (value.damaged) bad.push(id); } catch { bad.push(id); }
        if (checked && checked % 20 === 0) setReport(`${checked} files checked…`);
      }
      if (controller.signal.aborted || !focused.current) return;
      setReport(`${item.title}: ${checked} files checked. ${bad.length} chapters need repair.${legacy ? ` ${legacy} older chapters lack checksums; repair will add them.` : ""}`);
      if (bad.length || legacy) showSheet("Chapter check complete", bad.length ? `${bad.length} chapters need repair. Valid original panels will be kept.` : "Older chapters can be checked by Android and given checksums without downloading valid panels again.", [{ text: "Later", style: "cancel" }, { text: "Repair", onPress: () => startDownload(item, (bad.length ? bad : item.localChapters || []).join(",")) }]);
    } finally { if (operation.current === controller) { operation.current = null; if (focused.current) setBusy(""); } }
  }
  function erase(item: Series, all = false) {
    const readIds = (item.localChapters || []).filter(id => read[item.slug]?.[id]);
    const ids = readIds.filter(id => !downloads.some(job => job.series.slug === item.slug && downloadConflicts(job, [id])));
    if (!all && !ids.length) { showSheet("Download in progress", "These read chapters are part of a pending download. Cancel it before deleting them."); return; }
    showSheet(all ? "Delete all downloads for this story?" : `Delete ${ids.length} read chapters?`, `Bookmarks, lists and read history will stay.${!all && ids.length < readIds.length ? " Chapters in pending downloads will be kept." : ""}`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => { summaryRequest.current?.abort(); void removeDownloads(item, ids, all).then(ok => { if (ok && focused.current) refresh(); }).catch(error => setReport(String(error))); } }]);
  }
  function clearAllRead() {
    const stories = catalog.filter(item => item.localChapters?.some(id => read[item.slug]?.[id]));
    showSheet("Delete all read downloads?", `${stories.length} stories contain read chapters. Chapters in pending downloads will be kept. Your reading history stays.`, [{ text: "Cancel", style: "cancel" }, { text: "Delete read", style: "destructive", onPress: () => { void (async () => { summaryRequest.current?.abort(); setBusy("cleanup"); let removed = 0, skipped = 0;
          try { for (const item of stories) {
            const ids = (item.localChapters || []).filter(id => read[item.slug]?.[id]);
            const safe = ids.filter(id => !downloads.some(job => job.series.slug === item.slug && downloadConflicts(job, [id])));
            if (safe.length && await removeDownloads(item, safe)) removed++;
            else { skipped++; continue; }
            if (safe.length < ids.length) skipped++;
          } if (focused.current) { refresh(); setReport(`${removed} stories cleaned${skipped ? ` · ${skipped} stories have protected chapters` : ""}`); } }
          finally { setBusy(""); } })().catch(error => setReport(String(error))); } }]);
  }
  return <Page title="Storage" subtitle="ON THIS PHONE" action={<Pressable accessibilityLabel="Back" onPress={() => router.back()} style={{ padding: 12 }}><Icon name="arrow-back" /></Pressable>}><View style={{ paddingHorizontal: 22 }}>
    {!summary ? <ActivityIndicator color={color.lilac} /> : <><Text style={ui.title}>{formatBytes(summary.stories.reduce((sum, row) => sum + row.bytes, 0))} of chapters</Text><Text style={[ui.muted, { marginVertical: 10 }]}>{formatBytes(summary.free)} free on phone · {formatBytes(summary.covers)} cached covers</Text></>}
    <Pressable disabled={deleting || Boolean(busy)} onPress={clearAllRead} style={{ paddingVertical: 16 }}><Text style={{ color: "#f08080" }}>{deleting ? "Deleting…" : "Delete all read chapters"}</Text></Pressable>
    {report ? <Text accessibilityLiveRegion="polite" style={[ui.muted, { marginVertical: 12 }]}>{report}</Text> : null}
    {summary?.stories.map(({ item, bytes }) => {
      const blocked = downloadBusy(item.slug) || downloads.some(job => job.series.slug === item.slug) || deleting || Boolean(busy);
      const readBlocked = deleting || Boolean(busy);
      const readCount = item.localChapters?.filter(id => read[item.slug]?.[id]).length || 0;
      return <View key={item.slug} style={{ paddingVertical: 18, borderBottomWidth: 1, borderColor: color.line }}>
        <Pressable onPress={() => router.push({ pathname: "/series/[slug]", params: { slug: item.slug, filter: "downloaded" } })}><Text style={[ui.text, { fontWeight: "700", fontSize: 16 }]}>{item.title}</Text><Text style={[ui.muted, { marginTop: 6 }]}>{formatBytes(bytes)} · {item.localChapters?.length || 0} chapters · {readCount} read</Text></Pressable>
        <View style={[ui.row, { flexWrap: "wrap", marginTop: 8 }]}><Pressable disabled={blocked} onPress={() => void scan(item)} style={{ paddingVertical: 10, opacity:blocked?0.5:1 }}>{busy === item.slug ? <ActivityIndicator color={color.lilac} /> : <Text style={{ color: color.lilac }}>Check & repair</Text>}</Pressable>{busy === item.slug && <Pressable accessibilityLabel="Cancel file check" onPress={() => { operation.current?.abort(); setReport("Check cancelled."); }} style={{padding:10}}><Icon name="close" size={18}/></Pressable>}<Pressable disabled={readBlocked || !readCount} onPress={() => erase(item)} style={{ paddingVertical: 10, opacity:readBlocked?0.5:1 }}><Text style={{ color: readCount ? "#f08080" : color.muted }}>Delete read</Text></Pressable><Pressable disabled={blocked} onPress={() => erase(item, true)} style={{ paddingVertical: 10, opacity:blocked?0.5:1 }}><Text style={{ color: "#f08080" }}>Delete all</Text></Pressable></View>
        {blocked && !busy && <Text style={[ui.muted, { fontSize: 11 }]}>Cancel this story’s transfer before checking or deleting all its files.</Text>}
      </View>;
    })}
    {summary && !summary.stories.length && <Text style={ui.empty}>No chapters stored on this phone.</Text>}
  </View></Page>;
}
