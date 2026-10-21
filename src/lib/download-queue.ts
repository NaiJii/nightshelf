import type { Series } from "./parser";
import { throwIfAborted } from "./request-control";

export type DownloadJob = {
  series: Series; selection: string; chapters?: string[];
  status: "queued" | "downloading" | "paused" | "waiting" | "error" | "cancelling";
  message: string; progress: number;
  automatic?: boolean;
  autoBookmark?: boolean;
  native?: boolean;
  pauseRequested?: boolean;
  resumeBlocked?: boolean;
  readerHeld?: boolean;
};
type Worker = (job: DownloadJob, signal: AbortSignal, progress: (message: string, fraction: number) => void, plan: (chapters: string[]) => void) => Promise<void | "native">;
export function restoredDownloads(jobs: DownloadJob[]): DownloadJob[] { return jobs.map(job => job.readerHeld ? { ...job, readerHeld: false, status: "paused", message: "Read now interrupted · resume bulk download" } : job.native ? { ...job } : { ...job, status: "paused", message: "Paused after reopening · resume when ready" }); }

export class DownloadQueue {
  jobs: DownloadJob[];
  private running = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private cancelling = new Map<string, Promise<void>>();
  private worker: Worker;
  private changed: (jobs: DownloadJob[]) => void;
  private removeFiles: (slug: string) => void;
  private canRun: () => boolean;
  private persisted: () => DownloadJob[];
  private removed = new Set<string>();
  private nativeResumes = new Set<string>();
  private readerHolds = 0;
  private readerDrains = 0;
  private readerStop: Promise<void> = Promise.resolve();
  private readerStopWriter?: (slug: string) => Promise<void>;
  private listeners = new Set<() => void>();
  private snapshot: DownloadJob[];
  private statusSnapshot: DownloadJob[];
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  getStatusSnapshot = () => this.statusSnapshot;
  constructor(jobs: DownloadJob[], worker: Worker, changed: (jobs: DownloadJob[]) => void, removeFiles: (slug: string) => void, canRun = () => true, persisted = () => [] as DownloadJob[]) {
    this.jobs = restoredDownloads(jobs);
    this.snapshot = this.jobs.map(job => ({ ...job }));
    this.statusSnapshot = this.snapshot;
    this.worker = worker; this.changed = changed; this.removeFiles = removeFiles; this.canRun = canRun; this.persisted = persisted;
  }
  private recoverJobs() {
    let changed = false;
    for (const job of this.persisted()) if (job.native && !this.removed.has(job.series.slug) && !this.jobs.some(current => current.series.slug === job.series.slug)) { this.jobs.push({ ...job }); changed = true; }
    return changed;
  }
  private publish() {
    this.recoverJobs();
    this.holdReaderJobs();
    this.snapshot = this.jobs.map(job => ({ ...job }));
    if (this.snapshot.length !== this.statusSnapshot.length || this.snapshot.some((job, index) => job.series.slug !== this.statusSnapshot[index].series.slug || job.status !== this.statusSnapshot[index].status || job.native !== this.statusSnapshot[index].native || job.readerHeld !== this.statusSnapshot[index].readerHeld)) this.statusSnapshot = this.snapshot;
    this.changed(this.snapshot); this.removed.clear(); this.listeners.forEach(listener => listener());
  }
  isBusy(slug?: string) { return slug ? this.running.has(slug) || this.cancelling.has(slug) : this.running.size > 0 || this.cancelling.size > 0; }
  move(slug: string, direction: -1 | 1) {
    const waiting = this.jobs.filter(job => job.status === "queued" && !this.running.has(job.series.slug));
    const index = waiting.findIndex(job => job.series.slug === slug), other = waiting[index + direction];
    if (index < 0 || !other) return;
    const from = this.jobs.indexOf(waiting[index]), to = this.jobs.indexOf(other);
    [this.jobs[from], this.jobs[to]] = [this.jobs[to], this.jobs[from]];
    this.publish(); this.pump();
  }
  enqueue(series: Series, selection: string, autoBookmark = false): boolean {
    if (this.jobs.some(job => job.series.slug === series.slug)) return false;
    this.jobs.push({ series, selection, autoBookmark, status: "queued", message: "Queued", progress: 0 }); this.publish(); this.pump(); return true;
  }
  pause(slug: string) {
    const job = this.jobs.find(job => job.series.slug === slug);
    if (!job || job.status === "cancelling") return;
    job.readerHeld = false; job.pauseRequested = true; job.resumeBlocked = false; job.status = "paused"; job.message = "Paused · saved pages kept";
    this.running.get(slug)?.controller.abort(); this.publish(); this.pump();
  }
  resume(slug: string) {
    const job = this.jobs.find(job => job.series.slug === slug);
    if (!job || !["paused", "waiting", "error"].includes(job.status)) return;
    job.readerHeld = false;
    if (job.native) this.nativeResumes.add(slug);
    job.status = "queued"; job.pauseRequested = false; job.resumeBlocked = false; job.automatic = false; job.message = "Queued to resume"; this.publish(); this.pump();
  }
  reconcileNative(states: Record<string, {state: string; active: boolean; message: string; progress: number; hasPlan?: boolean}>) {
    let changed = this.recoverJobs();
    this.jobs = this.jobs.filter(job => {
      const value = states[job.series.slug]; if (!value) return true;
      if (this.running.has(job.series.slug)) return true;
      if (!job.native) { if (value.active && value.hasPlan) { job.native = true; changed = true; } else return true; }
      if (job.status === "cancelling" || job.readerHeld) return true;
      if (value.state === "done" && !value.active) { this.removed.add(job.series.slug); this.nativeResumes.delete(job.series.slug); changed = true; return false; }
      if (job.pauseRequested && value.active) return true;
      if (job.resumeBlocked && value.state === "paused" && !value.active) return true;
      job.resumeBlocked = false;
      if (!value.active) job.pauseRequested = false;
      const interrupted = value.state === "running" && !value.active && value.hasPlan;
      const status = value.state === "paused" ? "paused" : value.state === "waiting" || interrupted ? "waiting" : value.state === "error" ? "error" : value.state === "queued" ? "queued" : "downloading";
      const message = interrupted ? "Transfer interrupted · ready to resume" : value.message;
      if (status !== job.status || job.message !== message || job.progress !== value.progress) changed = true;
      job.status = status; job.message = message; job.progress = value.progress;
      // Keep ownership while Android retains the plan, including network waits.
      if (!value.active && value.hasPlan === false) job.native = false;
      return true;
    });
    if (changed) this.publish();
    this.pump();
  }
  resumeWaiting() { let changed = false; for (const job of this.jobs) if (job.status === "waiting") { if (job.native) this.nativeResumes.add(job.series.slug); job.status = "queued"; job.automatic = true; job.message = "Queued to resume"; changed = true; } if (changed) this.publish(); this.pump(); }
  suspend() {
    for (const job of this.jobs) if (job.status === "queued" || job.status === "downloading") {
      job.status = "waiting"; job.message = "Paused in background · resumes on reopening"; this.running.get(job.series.slug)?.controller.abort();
    }
    this.publish();
  }
  cancel(slug: string, deleteFiles = false, stopWriter: () => Promise<void> = async () => {}): Promise<void> {
    const existing = this.cancelling.get(slug); if (existing) return existing;
    const job = this.jobs.find(job => job.series.slug === slug); if (!job) return Promise.resolve();
    job.readerHeld = false; job.status = "cancelling"; job.message = deleteFiles ? "Stopping and deleting saved chapters…" : "Cancelling…";
    const run = this.running.get(slug); run?.controller.abort(); this.publish();
    const done = (async () => {
      try {
        await run?.done;
        await stopWriter();
        if (deleteFiles) this.removeFiles(slug);
        this.removed.add(slug);
        this.nativeResumes.delete(slug);
        this.jobs = this.jobs.filter(value => value !== job);
      } catch (error) { job.status = "error"; job.message = error instanceof Error ? error.message : String(error); }
      finally { this.cancelling.delete(slug); this.publish(); this.pump(); }
    })();
    this.cancelling.set(slug, done); return done;
  }
  private holdReaderJobs() {
    if (!this.readerHolds || !this.readerStopWriter) return;
    const stopWriter = this.readerStopWriter;
    const held = this.jobs.filter(job => !job.readerHeld && ["queued", "downloading", "waiting"].includes(job.status));
    const writers = held.map(job => ({ job, running: this.running.get(job.series.slug) }));
    for (const { job, running } of writers) {
      job.readerHeld = true; job.status = "paused"; job.message = "Waiting for Read now";
      running?.controller.abort();
    }
    if (writers.length) {
      this.readerDrains++;
      this.readerStop = Promise.allSettled([this.readerStop, ...writers.filter(({job, running}) => job.native || running).map(async ({job, running}) => {
        await running?.done;
        await stopWriter(job.series.slug);
      })]).then(results => { const failure = results.find(result => result.status === "rejected"); if (failure?.status === "rejected") throw failure.reason; }).finally(() => { this.readerDrains--; this.pump(); });
      // A late background job may be recovered between reader acquisitions.
      void this.readerStop.catch(() => {});
    }
  }
  private async drainReaderWriters() {
    let draining;
    do { draining = this.readerStop; await draining; } while (draining !== this.readerStop);
  }
  async holdForReader(stopWriter: (slug: string) => Promise<void>): Promise<() => void> {
    if (!this.readerHolds++) { this.readerStop = Promise.resolve(); this.readerStopWriter = stopWriter; }
    let released = false;
    const release = () => {
      if (released) return; released = true;
      if (--this.readerHolds) return;
      this.readerStopWriter = undefined;
      for (const job of this.jobs) if (job.readerHeld) {
        job.readerHeld = false; job.status = "queued"; job.pauseRequested = false;
        job.message = "Resuming after Read now";
        if (job.native) this.nativeResumes.add(job.series.slug);
      }
      this.publish(); this.pump();
    };
    try { this.publish(); await this.drainReaderWriters(); return release; }
    catch (error) { release(); throw error; }
  }
  pump() {
    if (this.readerHolds || this.readerDrains || !this.canRun()) return;
    for (const job of this.jobs) {
      const slug = job.series.slug;
      if (this.running.size >= 2) break;
      if ((job.native && !this.nativeResumes.has(slug)) || job.status !== "queued" || this.running.has(slug) || this.cancelling.has(slug)) continue;
      this.nativeResumes.delete(slug);
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
          else { this.removed.add(slug); this.jobs = this.jobs.filter(value => value !== job); }
        } catch (error) {
          if (!controller.signal.aborted) {
            job.status = error instanceof Error && error.name === "NetworkPaused" ? "waiting" : error instanceof Error && error.name === "DownloadPaused" ? "paused" : "error";
            job.resumeBlocked = Boolean(job.native && job.status === "waiting");
            job.message = error instanceof Error ? error.message : String(error);
          }
        } finally { this.running.delete(slug); this.publish(); this.pump(); }
      });
      this.running.set(slug, { controller, done }); this.publish();
    }
  }
}
