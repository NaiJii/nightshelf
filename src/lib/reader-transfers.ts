import type { DownloadJob } from "./download-queue";
import type { Series } from "./parser";
import { backgroundTransfers } from "./background-downloads";

const active = new Map<string, { job: DownloadJob; cancel: () => void }>();
const listeners = new Set<() => void>();
let snapshot: DownloadJob[] = [];
let statusSnapshot: DownloadJob[] = [], statusKey = "";
function publish() {
  snapshot = [...active.values()].map(value => ({...value.job}));
  const key = snapshot.map(job => `${job.series.slug}:${job.currentChapter}:${job.status}`).join("|");
  if (key !== statusKey) { statusKey = key; statusSnapshot = snapshot; }
  listeners.forEach(listener => listener());
}
export const readerTransfers = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => snapshot,
  getStatusSnapshot: () => statusSnapshot,
};
export function cancelReaderTransfer(slug: string): boolean {
  const transfer = active.get(slug); if (!transfer) return false;
  transfer.job.status = "cancelling"; transfer.job.message = "Stopping chapter download…"; publish();
  transfer.cancel(); return true;
}
export function beginReaderTransfer(series: Series, chapter: string, cancel: () => void) {
  const entry = {cancel,job:{series,selection:chapter,chapters:[chapter],reader:true,currentChapter:chapter,totalChapters:1,completedChapters:0,chapterProgress:0,status:"downloading",message:`Preparing chapter ${chapter}…`,progress:0} as DownloadJob};
  active.set(series.slug, entry); publish();
  const id = `reader-${series.slug}-${chapter}`;
  let finished = false, lastNotice = -Infinity, notice = Promise.resolve();
  function notify(done: boolean) {
    notice = notice.catch(() => {}).then(async () => { await backgroundTransfers?.readerProgress?.(id, series.title, entry.job.message, entry.job.progress, done); }).catch(() => {});
  }
  notify(false);
  return {
    progress(message: string, fraction: number) {
      if (finished) return;
      entry.job.message = message; entry.job.progress = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0; entry.job.chapterProgress = entry.job.progress;
      publish();
      if (Date.now() - lastNotice >= 1000 || fraction >= 1) { lastNotice = Date.now(); notify(false); }
    },
    finish() {
      if (finished) return; finished = true;
      if (active.get(series.slug) === entry) { active.delete(series.slug); publish(); }
      notify(true);
    },
  };
}
