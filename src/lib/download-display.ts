import { selectChapters } from "./parser";
import type { DownloadJob } from "./download-queue";

export function queuedChapters(job: DownloadJob): string[] {
  if (job.chapters) return job.chapters;
  try { return selectChapters((job.series.chapterIds || []).map(id => ({id,url:""})), job.selection).map(chapter => chapter.id); }
  catch { return []; }
}
export function downloadDetail(job: DownloadJob): string {
  const message = (job.message.startsWith(job.series.title + " · ") ? job.message.slice(job.series.title.length + 3) : job.message).replace(/^Downloading\s*·?\s*/i, "");
  if (!job.currentChapter) return message;
  const panels = job.message.match(/(\d+\/\d+)$/)?.[1];
  const context = `Chapter ${job.currentChapter}${panels ? ` · ${panels} panels` : job.chapterProgress !== undefined ? ` · ${Math.floor(job.chapterProgress * 100)}%` : ""}${job.totalChapters ? ` · ${Math.max(0, job.totalChapters - (job.completedChapters || 0))} chapter${job.totalChapters - (job.completedChapters || 0) === 1 ? "" : "s"} left` : ""}`;
  return job.status === "downloading" ? context : `${context} · ${message}`;
}
