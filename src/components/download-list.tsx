import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { useShelf } from "../lib/app-state";
import { openSeries } from "./series-card";
import { color, Icon, ui } from "./ui";
import { sourceLabel, sourceOf } from "../lib/parser";
import { router } from "expo-router";
import { queueSummary } from "../lib/background-downloads";

export function DownloadList({ slug: scope }: { slug?: string } = {}) {
  const { downloads: allDownloads, pauseDownload, resumeDownload, cancelDownload } = useShelf();
  const downloads = scope ? allDownloads.filter(job => job.series.slug === scope) : allDownloads;
  if (!downloads.length) return null;
  const overall = queueSummary(allDownloads);
  const percent = Math.floor(overall.progress * 100);
  function cancel(slug: string) {
    Alert.alert("Cancel download?", "Keep the chapters already saved, or delete ALL saved chapters and partial files for this story, including earlier downloads. Bookmarks and read history stay.", [
      { text: "Keep downloading", style: "cancel" },
      { text: "Cancel · keep files", onPress: () => void cancelDownload(slug) },
      { text: "Cancel · delete all", style: "destructive", onPress: () => void cancelDownload(slug, true) },
    ]);
  }
  return <View style={{ paddingVertical: 16 }}><View style={[ui.row, { justifyContent: "space-between" }]}><Text style={[ui.title, { fontSize: 18 }]}>Downloads · {allDownloads.length}</Text><Text style={{ color: color.lilac, fontWeight: "700", fontSize: 16 }}>{percent}%</Text></View><Text style={[ui.muted, { fontSize: 11, marginTop: 5 }]}>{overall.completed}/{overall.total} series complete · overall queue</Text><View accessibilityRole="progressbar" accessibilityLabel="Overall download queue, averaged by series" accessibilityValue={{ min: 0, max: 100, now: percent }} style={{ height: 5, backgroundColor: color.raised, borderRadius: 4, marginTop: 10, overflow: "hidden" }}><View style={{ width: `${percent}%`, height: 5, backgroundColor: color.lilac }} /></View><Text style={[ui.muted, { fontSize: 10, marginTop: 6 }]}>Averages each series’ progress · also shown in Android notifications</Text>{downloads.map(job => {
    const slug = job.series.slug;
    const busy = job.status === "downloading" || job.status === "cancelling";
    return <View key={slug} style={{ paddingVertical: 14, borderBottomWidth: 1, borderColor: color.line }}>
      <View style={[ui.row, { gap: 8 }]}>{busy ? <ActivityIndicator size="small" color={color.lilac} /> : <Icon name={job.status === "error" ? "alert-circle-outline" : job.status === "paused" ? "pause-circle-outline" : "time-outline"} size={18} tint={color.lilac} />}<Pressable onPress={() => openSeries(job.series)} style={{ flex: 1 }}><Text numberOfLines={1} style={[ui.text, { fontWeight: "700" }]}>{job.series.title}</Text></Pressable></View>
      <Text style={{ color: color.lilac, fontSize: 10, marginTop: 4 }}>{sourceLabel(job.series)}</Text><Text accessibilityLiveRegion="polite" style={[ui.muted, { fontSize: 11, marginTop: 6 }]}>{job.message} · {Math.round(job.progress * 100)}%</Text>
      {job.status === "error" && sourceOf(job.series) === "mangakakalot" && /verification/i.test(job.message) && <Pressable onPress={() => router.push({ pathname: "/verify-source", params: { source: sourceOf(job.series) } })} style={{ paddingVertical: 12 }}><Text style={{ color: color.lilac }}>Verify source</Text></Pressable>}
      <View style={{ height: 3, backgroundColor: color.raised, borderRadius: 3, marginTop: 9 }}><View style={{ width: `${job.progress * 100}%`, height: 3, backgroundColor: color.lilac, borderRadius: 3 }} /></View>
      <View style={[ui.row, { justifyContent: "flex-end", gap: 8 }]}>{job.status !== "cancelling" && <>
        {job.status === "downloading" || job.status === "queued" ? <Pressable accessibilityLabel={`Pause ${job.series.title}`} onPress={() => pauseDownload(slug)} style={[ui.row, { padding: 12, gap: 5 }]}><Icon name="pause" size={15} tint={color.lilac} /><Text style={{ color: color.lilac, fontSize: 12 }}>Pause</Text></Pressable> : <Pressable accessibilityLabel={`Resume ${job.series.title}`} onPress={() => resumeDownload(slug)} style={[ui.row, { padding: 12, gap: 5 }]}><Icon name="play" size={15} tint={color.lilac} /><Text style={{ color: color.lilac, fontSize: 12 }}>{job.status === "error" ? "Retry" : "Resume"}</Text></Pressable>}
        <Pressable accessibilityLabel={`Cancel ${job.series.title}`} onPress={() => cancel(slug)} style={{ padding: 12 }}><Text style={{ color: color.muted, fontSize: 12 }}>Cancel</Text></Pressable>
      </>}</View>
    </View>;
  })}</View>;
}

