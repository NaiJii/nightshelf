import { NativeModule, requireOptionalNativeModule } from "expo";
import { NetworkPaused } from "./network";
import { throwIfAborted } from "./request-control";
export type TransferState = { state: "queued" | "preparing" | "running" | "done" | "paused" | "waiting" | "error"; progress: number; message: string; active: boolean; hasPlan: boolean; currentChapter?: string; chapterProgress?: number; completedChapters?: number; totalChapters?: number };
export type NativeChapter = { id: string; marker: string; files: {url: string; target: string; original: string; agent: string; referer: string; hash?: string}[]; text?: string; textTarget?: string };
declare class Transfers extends NativeModule {
  states(id: string | null): string;
  serviceRunning(): boolean;
  setNetworkPolicy(wifiOnly: boolean): void;
  syncQueue(jobs: string): void;
  queueSummary(): string;
  begin(id: string, title: string): Promise<void>;
  enqueue(plan: string): Promise<void>;
  resume(id: string): Promise<void>;
  pause(id: string): Promise<void>;
  endPreparation(id: string): Promise<void>;
  discard(id: string): Promise<void>;
}
export const backgroundTransfers = requireOptionalNativeModule<Transfers>("NightShelfBackgroundDownloads");
export function queueSummary(jobs: { progress: number }[]): { total: number; completed: number; progress: number } {
  try { const value = JSON.parse(backgroundTransfers?.queueSummary() || "{}"); if (value.total > 0) return value; } catch {}
  return { total: jobs.length, completed: 0, progress: jobs.length ? jobs.reduce((sum, job) => sum + Math.max(0, Math.min(1, job.progress || 0)), 0) / jobs.length : 0 };
}
export function transferStates(id?: string): Record<string, TransferState> { try { return JSON.parse(backgroundTransfers?.states(id || null) || "{}"); } catch { return {}; } }
export class DownloadPaused extends Error { name = "DownloadPaused"; }
export async function stopTransfer(id: string): Promise<void> {
  const value = transferStates(id)[id];
  if (!backgroundTransfers || !value || (!value.active && !value.hasPlan && value.state !== "queued")) return;
  await backgroundTransfers.pause(id);
  while (transferStates(id)[id]?.active) await new Promise(resolve => setTimeout(resolve, 150));
}
export async function waitForTransfer(id: string, progress: (message: string, fraction: number) => void, saved: () => void, signal?: AbortSignal): Promise<void> {
  const stop = () => { void backgroundTransfers?.pause(id).catch(() => {}); };
  signal?.addEventListener("abort", stop, { once: true });
  let last = "", missing = 0, interrupted = 0;
  try {
    if (signal?.aborted) stop();
    while (true) {
      const value = transferStates(id)[id];
      if (value) {
        missing = 0;
        progress(value.message, value.progress);
        if (value.message !== last) { last = value.message; saved(); }
        if (!value.active) throwIfAborted(signal);
        // A queued job can legitimately wait for Android constraints. Running jobs
        // with no writer across multiple polls were interrupted by the service.
        interrupted = !value.active && (value.state === "running" || value.state === "preparing") ? interrupted + 1 : 0;
        if (interrupted >= 3) throw new DownloadPaused("Transfer interrupted - resume when ready");
        // Wait for the native writer to close before allowing cancellation/deletion.
        if (!value.active && value.state !== "preparing" && value.state !== "running" && value.state !== "queued") {
          throwIfAborted(signal);
          if (value.state === "done") { saved(); return; }
          if (value.state === "paused") throw new DownloadPaused(value.message);
          if (value.state === "waiting") throw new NetworkPaused(value.message);
          throw new Error(value.message);
        }
      } else {
        throwIfAborted(signal);
        if (++missing > 15) throw new Error("Android download service did not respond.");
      }
      await new Promise(resolve => setTimeout(resolve, 750));
    }
  } finally { signal?.removeEventListener("abort", stop); }
}
