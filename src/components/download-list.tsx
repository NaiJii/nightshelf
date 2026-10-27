import { downloadDetail } from "../lib/download-display";
import { Pressable } from "./pressable";
import { useActionSheet } from "./action-sheet";
import { ActivityIndicator, Text, View } from "react-native";
import { useDownloads, useShelf } from "../lib/app-state";
import { openSeries } from "./series-card";
import { color, Icon, ui } from "./ui";
import { sourceLabel, sourceOf } from "../lib/parser";
import { router } from "expo-router";
import { queueSummary } from "../lib/background-downloads";
import { providerInfo } from "../lib/provider-info";
import { needsVerification } from "../lib/provider-errors";

export function DownloadList({ slug: scope, onOpenStory, showHeading = true }: { slug?: string; onOpenStory?: () => void; showHeading?: boolean } = {}) {
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
  return <View style={{ paddingVertical: 8 }}><View style={[ui.row, { justifyContent: "space-between", paddingVertical: 6 }]}>{showHeading && <Text style={[ui.title, { fontSize: 18 }]}>{scope ? "Download" : "Downloads"}</Text>}<Text style={[ui.muted, { fontSize: 11 }]}>{downloads.length} pending{paused ? ` · ${paused} paused` : ""}{waiting ? ` · ${waiting} waiting` : ""}</Text>{!scope && allDownloads.length > 1 && <Text style={{color:color.lilac,fontWeight:"700"}}>{percent}%</Text>}</View>{!scope && allDownloads.length > 1 && <View accessibilityRole="progressbar" accessibilityLabel="Overall download queue, averaged by series" accessibilityValue={{min:0,max:100,now:percent}} style={{height:3,backgroundColor:color.raised,borderRadius:3,marginTop:6}}><View style={{width:`${percent}%`,height:3,backgroundColor:color.lilac}}/></View>}{downloads.map(job => {
    const slug = job.series.slug;
    const busy = job.status === "downloading" || job.status === "cancelling";
    const status = job.status === "error" ? "Needs attention" : job.status === "waiting" ? "Waiting" : job.status === "paused" ? "Paused" : job.status === "cancelling" ? "Stopping…" : job.status === "queued" ? "Queued" : job.message.startsWith("Preparing") || job.message.startsWith("Saving story") ? "Preparing" : "Downloading";
    return <View key={slug} style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: color.line }}>
      <View style={[ui.row, { gap: 8 }]}>{busy ? <ActivityIndicator size="small" color={color.lilac} /> : <Icon name={job.status === "error" ? "alert-circle-outline" : job.status === "paused" ? "pause-circle-outline" : "time-outline"} size={18} tint={color.lilac} />}<Pressable onPress={() => { onOpenStory?.(); openSeries(job.series); }} style={{ flex: 1 }}><Text numberOfLines={1} style={[ui.text, { fontWeight: "700" }]}>{job.series.title}</Text></Pressable></View>
      <Text accessibilityLiveRegion="polite" style={{ color: job.status === "error" ? "#f08080" : color.lilac, fontSize: 11, marginTop: 5 }}>{status === "Downloading" ? sourceLabel(job.series) : `${status} · ${sourceLabel(job.series)}`} · {Math.floor(job.progress * 100)}%</Text><Text style={[ui.muted, { fontSize: 11, marginTop: 6 }]}>{downloadDetail(job)}</Text>
      {job.status === "error" && providerInfo(sourceOf(job.series)).verification && needsVerification(job.message) && <Pressable onPress={() => { onOpenStory?.(); router.push({ pathname: "/verify-source", params: { retryDownload: slug } }); }} style={{ paddingVertical: 12 }}><Text style={{ color: color.lilac }}>Verify and retry</Text></Pressable>}
      <View accessibilityRole="progressbar" accessibilityLabel={`${job.series.title} download`} accessibilityValue={{ min: 0, max: 100, now: Math.floor(job.progress * 100) }} style={{ height: 3, backgroundColor: color.raised, borderRadius: 3, marginTop: 9 }}><View style={{ width: `${job.progress * 100}%`, height: 3, backgroundColor: color.lilac, borderRadius: 3 }} /></View>
      <View style={[ui.row, { justifyContent: "flex-end", gap: 4 }]}>{job.status !== "cancelling" && <>
        {queued.some(value => value.series.slug === slug) && queued.length > 1 && <>
          <Pressable accessibilityLabel={`Move ${job.series.title} earlier in queue`} disabled={queued[0].series.slug === slug} onPress={() => moveDownload(slug, -1)} style={{ padding: 12, minWidth:44,minHeight:44, opacity: queued[0].series.slug === slug ? 0.3 : 1 }}><Icon name="arrow-up" size={18} tint={color.lilac} /></Pressable>
          <Pressable accessibilityLabel={`Move ${job.series.title} later in queue`} disabled={queued.at(-1)?.series.slug === slug} onPress={() => moveDownload(slug, 1)} style={{ padding: 12, minWidth:44,minHeight:44, opacity: queued.at(-1)?.series.slug === slug ? 0.3 : 1 }}><Icon name="arrow-down" size={18} tint={color.lilac} /></Pressable>
        </>}
        {job.status === "downloading" || job.status === "queued" ? <Pressable accessibilityLabel={`Pause ${job.series.title}`} onPress={() => pauseDownload(slug)} style={{ minHeight:44,minWidth:44,alignItems:"center",justifyContent:"center" }}><Icon name="pause" size={19} tint={color.lilac} /></Pressable> : <Pressable accessibilityLabel={`${job.status === "error" ? "Retry" : "Resume"} ${job.series.title}`} onPress={() => resumeDownload(slug)} style={{ minHeight:44,minWidth:44,alignItems:"center",justifyContent:"center" }}><Icon name={job.status === "error" ? "refresh" : "play"} size={19} tint={color.lilac} /></Pressable>}
        {job.status === "waiting" && <Pressable accessibilityLabel={`Pause ${job.series.title}`} onPress={() => pauseDownload(slug)} style={{minHeight:44,minWidth:44,alignItems:"center",justifyContent:"center"}}><Icon name="pause" size={19} tint={color.lilac}/></Pressable>}
        <Pressable accessibilityLabel={`Stop ${job.series.title}`} onPress={() => cancel(slug)} style={{minHeight:44,minWidth:44,alignItems:"center",justifyContent:"center"}}><Icon name="close" size={20} tint={color.muted}/></Pressable>
      </>}</View>
    </View>;
  })}</View>;
}

