import { Directory, File, Paths } from "expo-file-system";
import { chapterSort, DEFAULT_WEIGHTS } from "./parser";
import type { DiscoveryFilters, NovelText, Period, SavedStory, Series, SortOrder, SortWeights } from "./parser";
import type { DownloadJob } from "./download-queue";

export const ROOT = new Directory(Paths.document, "nightshelf");
export const LIBRARY = new Directory(ROOT, "library");
export const COVERS = new Directory(ROOT, "covers");
const CATALOG = new File(ROOT, "catalog.json");
const PREFERENCES = new File(ROOT, "preferences.json");
const HISTORY = new File(ROOT, "history.json");
const SAVED = new File(ROOT, "saved.json");
const READ = new File(ROOT, "read.json");
const RELEASES = new File(ROOT, "releases.json");
const UPDATES = new File(ROOT, "release-updates.json");
const DOWNLOADS = new File(ROOT, "downloads.json");
export function loadDownloads(): DownloadJob[] {
  initializeStorage();
  try { const jobs = JSON.parse(DOWNLOADS.textSync()); return Array.isArray(jobs) ? jobs.filter(job => job?.series && safePart(job.series.slug) && typeof job.selection === "string") : []; } catch { return []; }
}
export function saveDownloads(jobs: DownloadJob[]): void { initializeStorage(); DOWNLOADS.write(JSON.stringify(jobs)); }
export type Preferences = DiscoveryFilters & { releaseCheckInterval: 60 | 120; autoDownloadLimitMB: number; readerKeepAwake: boolean; readerBrightness: number; readerVolumeScroll: boolean; releaseNotifications: boolean; deleteAfterReading: boolean; autoSync: boolean; mobileData: "ask" | "allow" | "never"; interval: 5 | 10; sort: SortOrder; weights: SortWeights; period: Period; novelFontSize: number; novelTheme: "dark" | "sepia" };
export const DEFAULT_PREFERENCES: Preferences = { releaseCheckInterval: 120, autoDownloadLimitMB: 2048, source: "asura", webtoonLanguage: "en", webtoonCollection: "originals", readerKeepAwake: true, readerBrightness: -1, readerVolumeScroll: false, releaseNotifications: false, deleteAfterReading: false, autoSync: true, mobileData: "ask", interval: 10, sort: "smart", weights: DEFAULT_WEIGHTS, contentMode: "all", hideDownloaded: true, hideLiked: false, hideBookmarked: false, period: "week", novelFontSize: 19, novelTheme: "dark" };
export type ReadingPosition = { chapter: string; fraction: number; readAt: string; chapters?: Record<string, { fraction: number; readAt: string }> };

export function loadPreferences(): Preferences {
  initializeStorage();
  try { return { ...DEFAULT_PREFERENCES, ...JSON.parse(PREFERENCES.textSync()) }; } catch { return DEFAULT_PREFERENCES; }
}
export function savePreferences(value: Preferences): void { initializeStorage(); PREFERENCES.write(JSON.stringify(value)); }
export function savedStories(): Record<string, SavedStory> {
  initializeStorage();
  try { return JSON.parse(SAVED.textSync()); } catch { return {}; }
}
export function toggleSaved(slug: string, field: "liked" | "bookmarked"): void {
  const all = savedStories();
  all[slug] = { ...all[slug], [field]: !all[slug]?.[field] };
  SAVED.write(JSON.stringify(all));
}
export function readingHistory(): Record<string, ReadingPosition> {
  initializeStorage();
  try { return JSON.parse(HISTORY.textSync()); } catch { return {}; }
}
export function savePosition(slug: string, chapter: string, fraction: number): void {
  if (![slug, chapter].every(safePart) || !Number.isFinite(fraction)) throw new Error("Invalid reading position.");
  const history = readingHistory(), previous = history[slug];
  const chapters = { ...previous?.chapters };
  if (previous && !chapters[previous.chapter]) chapters[previous.chapter] = { fraction: previous.fraction, readAt: previous.readAt };
  const position = { fraction: Math.max(0, Math.min(1, fraction)), readAt: new Date().toISOString() };
  chapters[chapter] = position;
  history[slug] = { chapter, ...position, chapters };
  HISTORY.write(JSON.stringify(history));
}

export function readChapters(): Record<string, Record<string, string>> {
  initializeStorage();
  try { return JSON.parse(READ.textSync()); } catch { return {}; }
}
export function markChapterRead(slug: string, chapter: string): void {
  setChaptersRead(slug, [chapter], true);
}
export function setChaptersRead(slug: string, chapters: string[], value: boolean): void {
  if (![slug, ...chapters].every(safePart)) throw new Error("Invalid chapter selection.");
  const read = readChapters();
  const state = { ...read[slug] };
  for (const chapter of chapters) {
    if (value) state[chapter] ||= new Date().toISOString();
    else delete state[chapter];
  }
  read[slug] = state;
  READ.write(JSON.stringify(read));
  const history = readingHistory(), position = history[slug];
  if (!value && position) {
    const readAt = new Date().toISOString();
    for (const chapter of chapters) {
      if (position.chapters?.[chapter]) position.chapters[chapter] = { fraction: 0, readAt };
      if (position.chapter === chapter) { position.fraction = 0; position.readAt = readAt; }
    }
    HISTORY.write(JSON.stringify(history));
  }
}
export function releaseSnapshots(): Record<string, string[]> {
  initializeStorage();
  try { return JSON.parse(RELEASES.textSync()); } catch { return {}; }
}
export function saveReleaseSnapshot(slug: string, chapters?: string[]): void {
  const snapshots = releaseSnapshots();
  if (chapters) snapshots[slug] = chapters;
  else delete snapshots[slug];
  RELEASES.write(JSON.stringify(snapshots));
}

export function releaseUpdates(): Record<string, string[]> {
  initializeStorage();
  try { return JSON.parse(UPDATES.textSync()); } catch { return {}; }
}
export function addReleaseUpdates(slug: string, chapters: string[]): void {
  const updates = releaseUpdates();
  updates[slug] = [...new Set([...(updates[slug] || []), ...chapters])];
  UPDATES.write(JSON.stringify(updates));
}
export function clearReleaseUpdates(slug: string): void {
  const updates = releaseUpdates(); delete updates[slug];
  UPDATES.write(JSON.stringify(updates));
}

export function chapterIntact(slug: string, chapter: string): boolean {
  try {
    const manifest = JSON.parse(new File(chapterDirectory(slug, chapter), ".complete").textSync());
    if (manifest.kind === "novel") return Boolean(novelChapter(slug, chapter)?.paragraphs.length) && (!manifest.hash || new File(chapterDirectory(slug, chapter), "text.json").md5 === manifest.hash);
    const files = chapterFiles(slug, chapter);
    return files.length > 0 && (manifest.quality !== 2 || (Array.isArray(manifest.urls) && manifest.urls.length === files.length));
  } catch { return false; }
}

export const SEED: Series[] = [{
  url: "https://asurascans.com/comics/sss-class-suicide-hunter-bd5bdaf8",
  slug: "sss-class-suicide-hunter-bd5bdaf8",
  title: "SSS-Class Suicide Hunter",
  summary: "I want an S-Rank skill too! I want it so badly, I could die for it!",
  cover: "https://cdn.asurascans.com/asura-images/covers/sss-class-suicide-hunter.20c072.webp",
  rating: "9.7",
  bookmarks: "84.8K",
  status: "ongoing",
  type: "manhwa",
  chapterCount: 155,
  latestChapter: "155",
  rank: 3,
}];

export function initializeStorage(): void {
  ROOT.create({ idempotent: true, intermediates: true });
  LIBRARY.create({ idempotent: true, intermediates: true });
  COVERS.create({ idempotent: true, intermediates: true });
}

export function chapterDirectory(slug: string, chapter: string): Directory {
  if (![slug, chapter].every(part => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== "." && part !== "..")) throw new Error("Invalid chapter storage path.");
  return new Directory(LIBRARY, slug, `chapter-${chapter}`);
}

function safePart(value: string): boolean { return /^[a-zA-Z0-9_.-]+$/.test(value) && value !== "." && value !== ".."; }
export function deleteChapters(slug: string, ids: string[], all = false): void {
  if (!safePart(slug)) throw new Error("Invalid deletion target.");
  const owned = new Set(localChapters(slug));
  if (ids.some(id => !owned.has(id))) throw new Error("That chapter is not downloaded.");
  const targets = all ? [new Directory(LIBRARY, slug)] : ids.map(chapter => chapterDirectory(slug, chapter));
  if (targets.some(folder => !folder.uri.startsWith(`${LIBRARY.uri.replace(/\/$/, "")}/`))) throw new Error("Invalid deletion target.");
  for (const folder of targets) if (folder.exists) folder.delete();
}

export function novelChapter(slug: string, chapter: string): NovelText | null {
  try {
    const value = JSON.parse(new File(chapterDirectory(slug, chapter), "text.json").textSync());
    return typeof value.title === "string" && Array.isArray(value.paragraphs) && value.paragraphs.every((text: unknown) => typeof text === "string") ? value : null;
  } catch { return null; }
}

export function localChapters(slug: string): string[] {
  if (!safePart(slug)) return [];
  const folder = new Directory(LIBRARY, slug);
  if (!folder.exists) return [];
  return folder.list()
    .filter(item => item instanceof Directory && item.name.startsWith("chapter-") && new File(item, ".complete").exists)
    .map(item => item.name.replace(/^chapter-/, ""))
    .sort(chapterSort);
}

function catalogMetadata(): Series[] {
  initializeStorage();
  let items = SEED;
  if (CATALOG.exists) {
    try { items = JSON.parse(CATALOG.textSync()) as Series[]; } catch { /* use seed */ }
  }
  return items;
}

export function loadCatalog(): Series[] {
  return catalogMetadata().map(item => {
    const folder = safePart(item.slug) ? new Directory(LIBRARY, item.slug) : null;
    return { ...item, updatedAt: item.sourceDates ? item.updatedAt : undefined, localChapters: localChapters(item.slug), hasLocalFiles: Boolean(folder?.exists && folder.list().length) };
  });
}

export function saveCatalog(items: Series[]): void {
  initializeStorage();
  CATALOG.write(JSON.stringify(items.map(({ localChapters: _, hasLocalFiles: __, ...item }) => item)));
}

// Commit against current storage: simultaneous downloads/search must not lose entries to an older sync snapshot.
export function mergeCatalog(updates: Series[], rankings = false): void {
  const items = new Map(catalogMetadata().map(item => [item.slug, item]));
  for (const update of updates) {
    const current = items.get(update.slug);
    const newer = current && Date.parse(current.syncedAt || "") > (Date.parse(update.syncedAt || "") || 0);
    const item = newer ? { ...update, ...current } : { ...current, ...update };
    if (current?.detailsCached && (!update.detailsCached || newer)) {
      item.detailsCached = true; item.chapterIds = current.chapterIds; item.chapterUrls = current.chapterUrls; item.chapterTitles = current.chapterTitles;
      item.chapterListComplete = current.chapterListComplete;
      if (!update.metadataSyncedAt || newer) item.summary = current.summary;
    }
    item.localCover = update.localCover || current?.localCover;
    item.rank = rankings ? update.rank : current?.rank ?? update.rank;
    item.popularRanks = rankings ? update.popularRanks : current?.popularRanks ?? update.popularRanks;
    items.set(item.slug, item);
  }
  saveCatalog([...items.values()]);
}

export function chapterFiles(slug: string, chapter: string): string[] {
  const folder = chapterDirectory(slug, chapter);
  if (!folder.exists) return [];
  try {
    const manifest = JSON.parse(new File(folder, ".complete").textSync());
    if (manifest.quality === 2 && Array.isArray(manifest.urls)) {
      return manifest.urls.map((url: string, index: number) => new File(folder, `${String(index + 1).padStart(3, "0")}${new URL(url).pathname.match(/\.(avif|gif|jpe?g|png|webp)$/i)?.[0].toLowerCase() || ".webp"}`))
        .filter((file: File) => file.exists && file.size).map((file: File) => file.uri);
    }
  } catch { /* legacy download uses directory listing */ }
  return folder.list()
    .filter(item => item instanceof File && /^\d+\.(avif|gif|jpe?g|png|webp)$/i.test(item.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map(item => item.uri);
}


