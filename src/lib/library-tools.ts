import { Directory, File, Paths } from "expo-file-system";
import type { SavedStory, SourceId } from "./parser";
import { chapterDirectory, chapterFiles, COVERS, LIBRARY, loadCatalog, ROOT, savedStories } from "./storage";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${Math.round(bytes / 1024 ** 2)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
export function folderBytes(folder: Directory): number {
  if (!folder.exists) return 0;
  return folder.list().reduce((sum, file) => sum + (file instanceof Directory ? folderBytes(file) : file.size || 0), 0);
}
export function freeBytes(): number { return Paths.availableDiskSpace; }
export function libraryBytes(): number { return folderBytes(LIBRARY); }
export function storageSummary() {
  return { free: freeBytes(), covers: folderBytes(COVERS), stories: loadCatalog().filter(item => item.hasLocalFiles).map(item => ({ item, bytes: folderBytes(new Directory(LIBRARY, item.slug)) })).sort((a, b) => b.bytes - a.bytes) };
}
export function updateStoryOptions(slug: string, change: Partial<SavedStory>): void {
  if (!/^[a-zA-Z0-9_.-]+$/.test(slug) || slug === "." || slug === "..") throw new Error("Invalid story.");
  const all = savedStories(); all[slug] = { ...all[slug], ...change };
  new File(ROOT, "saved.json").write(JSON.stringify(all));
}
// Estimates use saved chapters of the same story, then an explicit format fallback.
export function estimateDownload(slug: string, count: number, novel: boolean): { bytes: number; sampled: boolean } {
  const item = loadCatalog().find(value => value.slug === slug);
  const chapters = item?.localChapters || [];
  const sample = chapters.slice(-5).map(id => folderBytes(chapterDirectory(slug, id))).filter(size => size > 0);
  return { bytes: count * (sample.length ? sample.reduce((a, b) => a + b, 0) / sample.length : novel ? 40 * 1024 : 18 * 1024 ** 2), sampled: sample.length > 0 };
}
export type SourceHealth = { state: "ok" | "verification" | "unavailable" | "network" | "parser"; message: string; checkedAt: string; lastSuccess?: string };
export function sourceHealth(): Partial<Record<SourceId, SourceHealth>> {
  try { return JSON.parse(new File(ROOT, "source-health.json").textSync()); } catch { return {}; }
}
export function recordSourceHealth(source: SourceId, state: SourceHealth["state"], message: string): void {
  const all = sourceHealth(), now = new Date().toISOString();
  all[source] = { state, message, checkedAt: now, lastSuccess: state === "ok" ? now : all[source]?.lastSuccess };
  ROOT.create({ intermediates: true, idempotent: true });
  new File(ROOT, "source-health.json").write(JSON.stringify(all));
}
export function sourceForRequest(url: string): SourceId | undefined {
  const host = new URL(url).hostname;
  return /^(?:api\.)?asurascans\.com$/.test(host) ? "asura" : host === "www.webtoons.com" ? "webtoon" : /^(?:(?:www|api)\.)?vortexscans\.org$/.test(host) ? "vortex" : /^(?:www\.)?mangakakalot\.gg$/.test(host) ? "mangakakalot" : undefined;
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
