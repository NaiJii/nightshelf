import type { Series } from "./parser";
import { throwIfAborted } from "./request-control";

export type DownloadJob = {
  series: Series; selection: string; chapters?: string[];
  status: "queued" | "downloading" | "paused" | "waiting" | "error" | "cancelling";
  message: string; progress: number;
  automatic?: boolean;
  autoBookmark?: boolean;
  native?: boolean;
};
type Worker = (job: DownloadJob, signal: AbortSignal, progress: (message: string, fraction: number) => void, plan: (chapters: string[]) => void) => Promise<void | "native">;
export function restoredDownloads(jobs: DownloadJob[]): DownloadJob[] { return jobs.map(job => ({ ...job, status: "paused", message: "Paused after reopening · resume when ready" })); }

export class DownloadQueue {
  jobs: DownloadJob[];
  private running = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private cancelling = new Map<string, Promise<void>>();
  private worker: Worker;
  private changed: (jobs: DownloadJob[]) => void;
  private removeFiles: (slug: string) => void;
  private canRun: () => boolean;
  constructor(jobs: DownloadJob[], worker: Worker, changed: (jobs: DownloadJob[]) => void, removeFiles: (slug: string) => void, canRun = () => true) {
    this.jobs = restoredDownloads(jobs);
    this.worker = worker; this.changed = changed; this.removeFiles = removeFiles; this.canRun = canRun;
  }
  private publish() { this.changed(this.jobs.map(job => ({ ...job }))); }
  isBusy(slug?: string) { return slug ? this.running.has(slug) || this.cancelling.has(slug) : this.running.size > 0 || this.cancelling.size > 0; }
  enqueue(series: Series, selection: string, autoBookmark = false): boolean {
    if (this.jobs.some(job => job.series.slug === series.slug)) return false;
    this.jobs.push({ series, selection, autoBookmark, status: "queued", message: "Queued", progress: 0 }); this.publish(); this.pump(); return true;
  }
  pause(slug: string) {
    const job = this.jobs.find(job => job.series.slug === slug);
    if (!job || job.status === "cancelling") return;
    job.status = "paused"; job.message = "Paused · saved pages kept";
    this.running.get(slug)?.controller.abort(); this.publish(); this.pump();
  }
  resume(slug: string) {
    const job = this.jobs.find(job => job.series.slug === slug);
    if (!job || !["paused", "waiting", "error"].includes(job.status)) return;
    job.status = "queued"; job.native = false; job.automatic = false; job.message = "Queued to resume"; this.publish(); this.pump();
  }
  reconcileNative(states: Record<string, {state: string; active: boolean; message: string; progress: number; hasPlan?: boolean}>) {
    let changed = false;
    this.jobs = this.jobs.filter(job => {
      const value = states[job.series.slug]; if (!value) return true;
      if (!job.native) { if (value.active && value.hasPlan && !this.running.has(job.series.slug)) { job.native = true; changed = true; } else return true; }
      if (job.status === "cancelling") return true;
      if (value.state === "done" && !value.active) { changed = true; return false; }
      if (job.status === "paused" && value.active) return true;
      const status = value.state === "paused" ? "paused" : value.state === "waiting" ? "waiting" : value.state === "error" ? "error" : "downloading";
      if (status !== job.status || job.message !== value.message || job.progress !== value.progress) changed = true;
      job.status = status; job.message = value.message; job.progress = value.progress;
      if (!value.active && ["paused", "waiting", "error"].includes(value.state)) job.native = false;
      return true;
    });
    if (changed) this.publish();
    this.pump();
  }
  resumeWaiting() { let changed = false; for (const job of this.jobs) if (job.status === "waiting") { job.status = "queued"; job.automatic = true; job.message = "Queued to resume"; changed = true; } if (changed) this.publish(); this.pump(); }
  suspend() {
    for (const job of this.jobs) if (job.status === "queued" || job.status === "downloading") {
      job.status = "waiting"; job.message = "Paused in background · resumes on reopening"; this.running.get(job.series.slug)?.controller.abort();
    }
    this.publish();
  }
  cancel(slug: string, deleteFiles = false, stopWriter: () => Promise<void> = async () => {}): Promise<void> {
    const existing = this.cancelling.get(slug); if (existing) return existing;
    const job = this.jobs.find(job => job.series.slug === slug); if (!job) return Promise.resolve();
    job.status = "cancelling"; job.message = deleteFiles ? "Stopping and deleting saved chapters…" : "Cancelling…";
    const run = this.running.get(slug); run?.controller.abort(); this.publish();
    const done = (async () => {
      try {
        await run?.done;
        await stopWriter();
        if (deleteFiles) this.removeFiles(slug);
        this.jobs = this.jobs.filter(value => value !== job);
      } catch (error) { job.status = "error"; job.message = error instanceof Error ? error.message : String(error); }
      finally { this.cancelling.delete(slug); this.publish(); this.pump(); }
    })();
    this.cancelling.set(slug, done); return done;
  }
  pump() {
    if (!this.canRun()) return;
    for (const job of this.jobs) {
      const slug = job.series.slug;
      if (this.running.size >= 2) break;
      if (job.native || job.status !== "queued" || this.running.has(slug) || this.cancelling.has(slug)) continue;
      const controller = new AbortController();
      job.status = "downloading"; job.message = "Preparing download…";
      // Defer execution until the running entry is installed, even for a synchronous worker error.
      const done = Promise.resolve().then(async () => {
        try {
          const result = await this.worker(job, controller.signal, (message, progress) => {
            if (controller.signal.aborted) return;
            job.message = message; job.progress = Math.max(0, Math.min(1, progress)); this.publish();
          }, chapters => { throwIfAborted(controller.signal); job.chapters = chapters; this.publish(); });
          throwIfAborted(controller.signal);
          if (result === "native") { job.native = true; job.status = "downloading"; job.message = "Android is saving chapters…"; }
          else this.jobs = this.jobs.filter(value => value !== job);
        } catch (error) {
          if (!controller.signal.aborted) {
            job.status = error instanceof Error && error.name === "NetworkPaused" ? "waiting" : error instanceof Error && error.name === "DownloadPaused" ? "paused" : "error";
            job.message = error instanceof Error ? error.message : String(error);
          }
        } finally { this.running.delete(slug); this.publish(); this.pump(); }
      });
      this.running.set(slug, { controller, done }); this.publish();
    }
  }
}
