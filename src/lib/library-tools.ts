import { readJson, writeJson } from "./json-store";
import { Directory, File, Paths } from "expo-file-system";
import { chapterListCached } from "./parser";
import type { SavedStory, SourceId } from "./parser";
import { sourceIdForUrl } from "./provider-info";
import { yieldToForeground } from "./request-control";
import { catalogMetadata, chapterDirectory, chapterFiles, COVERS, LIBRARY, loadCatalog, loadCatalogAsync, ROOT, savedStories, releaseSnapshots, releaseUpdates } from "./storage";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${Math.round(bytes / 1024 ** 2)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
export function folderBytes(folder: Directory, excludePartials = false): number {
  if (!folder.exists) return 0;
  return folder.list().reduce((sum, file) => sum + (file instanceof Directory ? folderBytes(file, excludePartials) : excludePartials && file.name.endsWith(".part") ? 0 : file.size || 0), 0);
}
export function freeBytes(): number { return Paths.availableDiskSpace; }
export function libraryBytes(excludePartials = false): number { return folderBytes(LIBRARY, excludePartials); }
export async function folderBytesAsync(folder: Directory, signal?: AbortSignal, excludePartials = false): Promise<number> {
  const pending = [folder]; let total = 0;
  while (pending.length) {
    const next = pending.pop()!;
    if (!next.exists) continue;
    const entries = next.list();
    for (let start = 0; start < entries.length; start += 32) {
      await new Promise(resolve => setTimeout(resolve, 0));
      await yieldToForeground(signal);
      for (const entry of entries.slice(start, start + 32)) {
        if (entry instanceof Directory) pending.push(entry); else if (entry.exists && !(excludePartials && entry.name.endsWith(".part"))) total += entry.size || 0;
      }
    }
  }
  return total;
}
export async function libraryBytesAsync(signal?: AbortSignal, excludePartials = false): Promise<number> { return folderBytesAsync(LIBRARY, signal, excludePartials); }
export async function storageSummaryAsync(signal?: AbortSignal): Promise<ReturnType<typeof storageSummary>> {
  const stories: ReturnType<typeof storageSummary>["stories"] = [];
  for (const item of (await loadCatalogAsync(signal)).filter(item => item.hasLocalFiles)) stories.push({ item, bytes: await folderBytesAsync(new Directory(LIBRARY, item.slug), signal) });
  return { free: freeBytes(), covers: await folderBytesAsync(COVERS, signal), stories: stories.sort((a, b) => b.bytes - a.bytes) };
}
export function storageSummary() {
  return { free: freeBytes(), covers: folderBytes(COVERS), stories: loadCatalog().filter(item => item.hasLocalFiles).map(item => ({ item, bytes: folderBytes(new Directory(LIBRARY, item.slug)) })).sort((a, b) => b.bytes - a.bytes) };
}
export function updateStoryOptions(slug: string, change: Partial<SavedStory>): void {
  updateStoriesOptions([slug], change);
}
export function updateStoriesOptions(slugs: string[], change: Partial<SavedStory>): void {
  if (slugs.some(slug => !/^[a-zA-Z0-9_.-]+$/.test(slug) || slug === "." || slug === "..")) throw new Error("Invalid story.");
  const all = savedStories(), snapshots = releaseSnapshots(), updates = releaseUpdates();
  let metadata: Map<string, ReturnType<typeof catalogMetadata>[number]> | undefined;
  let snapshotsChanged = false, updatesChanged = false;
  for (const slug of new Set(slugs)) {
    const previous = all[slug] || {}, next = { ...previous, ...change };
    if (change.autoDownload || change.notifyReleases) next.bookmarked = true;
    const needsBaseline = (next.bookmarked && !previous.bookmarked) || (next.autoDownload && !previous.autoDownload) || (next.notifyReleases && !previous.notifyReleases);
    if (needsBaseline) metadata ||= new Map(catalogMetadata().map(item => [item.slug, item]));
    const item = needsBaseline ? metadata?.get(slug) : undefined;
    const baseline = item && chapterListCached(item) ? item.chapterIds : undefined;
    const snapshot = () => { if (baseline) snapshots[slug] = [...baseline]; else delete snapshots[slug]; snapshotsChanged = true; };
    const clearUpdates = () => { delete updates[slug]; updatesChanged = true; };
    if (next.bookmarked && !previous.bookmarked) {
      snapshot(); clearUpdates(); next.notifyReleases ??= false;
    } else if (next.notifyReleases && !previous.notifyReleases) snapshot();
    if (!next.bookmarked) {
      next.autoDownload = false; next.notifyReleases = false;
      if (previous.bookmarked) { delete snapshots[slug]; snapshotsChanged = true; clearUpdates(); }
    }
    if (next.autoDownload && !previous.autoDownload) next.autoDownloadBaseline = baseline ? [...baseline] : undefined;
    all[slug] = next;
  }
  if (snapshotsChanged) writeJson(new File(ROOT, "releases.json"), snapshots);
  if (updatesChanged) writeJson(new File(ROOT, "release-updates.json"), updates);
  writeJson(new File(ROOT, "saved.json"), all);
}
// Estimates use saved chapters of the same story, then an explicit format fallback.
export function estimateDownload(slug: string, count: number, novel: boolean, knownChapters?: string[]): { bytes: number; sampled: boolean } {
  if (count <= 0) return { bytes: 0, sampled: false };
  const chapters = knownChapters ?? loadCatalog().find(value => value.slug === slug)?.localChapters ?? [];
  const sample = chapters.slice(-5).map(id => folderBytes(chapterDirectory(slug, id))).filter(size => size > 0);
  return { bytes: count * (sample.length ? sample.reduce((a, b) => a + b, 0) / sample.length : novel ? 40 * 1024 : 18 * 1024 ** 2), sampled: sample.length > 0 };
}
export type SourceHealth = { state: "ok" | "verification" | "unavailable" | "network" | "parser"; message: string; checkedAt: string; lastSuccess?: string };
export function sourceHealth(): Partial<Record<SourceId, SourceHealth>> {
  try { return readJson(new File(ROOT, "source-health.json"), {}); } catch { return {}; }
}
export function recordSourceHealth(source: SourceId, state: SourceHealth["state"], message: string): void {
  const all = sourceHealth(), now = new Date().toISOString();
  all[source] = { state, message, checkedAt: now, lastSuccess: state === "ok" ? now : all[source]?.lastSuccess };
  ROOT.create({ intermediates: true, idempotent: true });
  writeJson(new File(ROOT, "source-health.json"), all);
}
export function sourceForRequest(url: string): SourceId | undefined {
  return sourceIdForUrl(url, true);
}
export function verifyChapterFiles(slug: string, id: string): { damaged: number; checked: number; legacy: boolean } {
  const folder = chapterDirectory(slug, id);
  const manifest = JSON.parse(new File(folder, ".complete").textSync());
  if (manifest.kind === "novel") { const file = new File(folder, "text.json"); const value = JSON.parse(file.textSync()); return { damaged: Array.isArray(value.paragraphs) && value.paragraphs.length && (!manifest.hash || file.md5 === manifest.hash) ? 0 : 1, checked: 1, legacy: !manifest.hash }; }
  const files = chapterFiles(slug, id);
  if (!Array.isArray(manifest.urls)) return { damaged: files.length ? 0 : 1, checked: files.length, legacy: true };
  let damaged = 0;
  for (let index = 0; index < manifest.urls.length; index++) {
    const url = manifest.urls[index], ext = new URL(url).pathname.match(/\.(avif|gif|jpe?g|png|webp)$/i)?.[0].toLowerCase() || ".webp";
    const file = new File(folder, `${String(index + 1).padStart(3, "0")}${ext}`);
    const hash = manifest.hashes?.[index];
    if (!file.exists || !file.size || (hash && file.md5 !== hash)) {
      damaged++;

    }
  }
  return { damaged, checked: manifest.urls.length, legacy: !manifest.hashes };
}
