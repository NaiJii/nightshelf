import { Pressable } from "./pressable";
import { useActionSheet } from "./action-sheet";
import { ActivityIndicator, Text, View } from "react-native";
import { useDownloads, useShelf } from "../lib/app-state";
import { openSeries } from "./series-card";
import { color, Icon, ui } from "./ui";
import { sourceLabel, sourceOf } from "../lib/parser";
import { router } from "expo-router";
import { queueSummary } from "../lib/background-downloads";

export function DownloadList({ slug: scope }: { slug?: string } = {}) {
  const showSheet = useActionSheet();
  const { pauseDownload, resumeDownload, cancelDownload, moveDownload } = useShelf();
  const allDownloads = useDownloads();
  const downloads = scope ? allDownloads.filter(job => job.series.slug === scope) : allDownloads;
  if (!downloads.length) return null;
  const overall = queueSummary(allDownloads);
  const percent = Math.floor((scope ? downloads[0].progress : overall.progress) * 100);
  const paused = allDownloads.filter(job => job.status === "paused").length;
  const waiting = allDownloads.filter(job => job.status === "waiting").length;
  const queued = allDownloads.filter(job => job.status === "queued");
  function cancel(slug: string) {
    showSheet("Stop this download?", "Keep the chapters already saved, or delete ALL saved chapters and partial files for this story, including earlier downloads. Bookmarks and read history stay.", [
      { text: "Continue", style: "cancel" },
      { text: "Stop · keep files", onPress: () => void cancelDownload(slug) },
      { text: "Stop · delete all", style: "destructive", onPress: () => void cancelDownload(slug, true) },
    ]);
  }
  return <View style={{ paddingVertical: 16 }}><View style={[ui.row, { justifyContent: "space-between" }]}><Text style={[ui.title, { fontSize: 18 }]}>{scope ? "Download" : `Downloads · ${allDownloads.length}`}</Text><Text style={{ color: color.lilac, fontWeight: "700", fontSize: 16 }}>{percent}%</Text></View>{!scope && <><Text style={[ui.muted, { fontSize: 11, marginTop: 5 }]}>{overall.completed}/{overall.total} series complete{paused ? ` · ${paused} paused` : ""}{waiting ? ` · ${waiting} waiting` : ""}</Text><View accessibilityRole="progressbar" accessibilityLabel="Overall download queue, averaged by series" accessibilityValue={{ min: 0, max: 100, now: percent }} style={{ height: 5, backgroundColor: color.raised, borderRadius: 4, marginTop: 10, overflow: "hidden" }}><View style={{ width: `${percent}%`, height: 5, backgroundColor: color.lilac }} /></View></>}{downloads.map(job => {
    const slug = job.series.slug;
    const busy = job.status === "downloading" || job.status === "cancelling";
    const status = job.status === "error" ? "Needs attention" : job.status === "waiting" ? "Waiting" : job.status === "paused" ? "Paused" : job.status === "cancelling" ? "Stopping…" : job.status === "queued" ? "Queued" : job.message.startsWith("Preparing") || job.message.startsWith("Saving story") ? "Preparing" : "Downloading";
    return <View key={slug} style={{ paddingVertical: 14, borderBottomWidth: 1, borderColor: color.line }}>
      <View style={[ui.row, { gap: 8 }]}>{busy ? <ActivityIndicator size="small" color={color.lilac} /> : <Icon name={job.status === "error" ? "alert-circle-outline" : job.status === "paused" ? "pause-circle-outline" : "time-outline"} size={18} tint={color.lilac} />}<Pressable onPress={() => openSeries(job.series)} style={{ flex: 1 }}><Text numberOfLines={1} style={[ui.text, { fontWeight: "700" }]}>{job.series.title}</Text></Pressable></View>
      <Text accessibilityLiveRegion="polite" style={{ color: job.status === "error" ? "#f08080" : color.lilac, fontSize: 11, marginTop: 5 }}>{status} · {sourceLabel(job.series)}</Text><Text style={[ui.muted, { fontSize: 11, marginTop: 6 }]}>{job.message} · {Math.floor(job.progress * 100)}%</Text>
      {job.status === "error" && sourceOf(job.series) === "mangakakalot" && /verification/i.test(job.message) && <Pressable onPress={() => router.push({ pathname: "/verify-source", params: { source: sourceOf(job.series) } })} style={{ paddingVertical: 12 }}><Text style={{ color: color.lilac }}>Verify source</Text></Pressable>}
      <View accessibilityRole="progressbar" accessibilityLabel={`${job.series.title} download`} accessibilityValue={{ min: 0, max: 100, now: Math.floor(job.progress * 100) }} style={{ height: 3, backgroundColor: color.raised, borderRadius: 3, marginTop: 9 }}><View style={{ width: `${job.progress * 100}%`, height: 3, backgroundColor: color.lilac, borderRadius: 3 }} /></View>
      <View style={[ui.row, { justifyContent: "flex-end", gap: 8 }]}>{job.status !== "cancelling" && <>
        {queued.some(value => value.series.slug === slug) && queued.length > 1 && <>
          <Pressable accessibilityLabel={`Move ${job.series.title} earlier in queue`} disabled={queued[0].series.slug === slug} onPress={() => moveDownload(slug, -1)} style={{ padding: 12, opacity: queued[0].series.slug === slug ? 0.3 : 1 }}><Icon name="arrow-up" size={18} tint={color.lilac} /></Pressable>
          <Pressable accessibilityLabel={`Move ${job.series.title} later in queue`} disabled={queued.at(-1)?.series.slug === slug} onPress={() => moveDownload(slug, 1)} style={{ padding: 12, opacity: queued.at(-1)?.series.slug === slug ? 0.3 : 1 }}><Icon name="arrow-down" size={18} tint={color.lilac} /></Pressable>
        </>}
        {job.status === "downloading" || job.status === "queued" ? <Pressable accessibilityLabel={`Pause ${job.series.title}`} onPress={() => pauseDownload(slug)} style={[ui.row, { padding: 12, gap: 5 }]}><Icon name="pause" size={15} tint={color.lilac} /><Text style={{ color: color.lilac, fontSize: 12 }}>Pause</Text></Pressable> : <Pressable accessibilityLabel={`Resume ${job.series.title}`} onPress={() => resumeDownload(slug)} style={[ui.row, { padding: 12, gap: 5 }]}><Icon name="play" size={15} tint={color.lilac} /><Text style={{ color: color.lilac, fontSize: 12 }}>{job.status === "error" ? "Retry" : "Resume"}</Text></Pressable>}
        {job.status === "waiting" && <Pressable accessibilityLabel={`Pause ${job.series.title}`} onPress={() => pauseDownload(slug)} style={{ padding: 12, minHeight: 44 }}><Text style={{ color: color.lilac, fontSize: 12 }}>Pause</Text></Pressable>}
        <Pressable accessibilityLabel={`Stop ${job.series.title}`} onPress={() => cancel(slug)} style={{ padding: 12, minHeight: 44 }}><Text style={{ color: color.muted, fontSize: 12 }}>Stop</Text></Pressable>
      </>}</View>
    </View>;
  })}</View>;
}

