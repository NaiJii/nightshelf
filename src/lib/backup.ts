import { File, Paths } from "expo-file-system";
import { DEFAULT_PREFERENCES, ROOT, loadCatalog, loadPreferences, mergeCatalog, readingHistory, readChapters, savedStories, savePreferences } from "./storage";
import type { Preferences } from "./storage";
import type { SavedStory, Series } from "./parser";

const part = (value: string) => /^[a-zA-Z0-9_.-]+$/.test(value) && value !== "." && value !== ".." && !["__proto__", "constructor", "prototype"].includes(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
export function createBackup(): string {
  const saved = savedStories(), read = readChapters(), history = readingHistory();
  const catalog = loadCatalog().filter(item => item.hasLocalFiles || saved[item.slug]?.liked || saved[item.slug]?.bookmarked || saved[item.slug]?.list || history[item.slug] || Object.keys(read[item.slug] || {}).length);
  return JSON.stringify({ app: "NightShelf", version: 1, createdAt: new Date().toISOString(), catalog: catalog.map(({localCover: _, localChapters: __, hasLocalFiles: ___, ...item}) => item), preferences: loadPreferences(), saved, read, history });
}
export function validateBackup(text: string) {
  if (text.length > 20 * 1024 ** 2) throw new Error("Backup exceeds the 20 MB metadata limit.");
  const data = JSON.parse(text);
  if (!object(data) || data.app !== "NightShelf" || data.version !== 1 || !Array.isArray(data.catalog) || data.catalog.length > 20_000 || !object(data.saved) || !object(data.read) || !object(data.history)) throw new Error("This is not a supported NightShelf backup.");
  const catalog: Series[] = data.catalog.map(raw => {
    if (!object(raw) || typeof raw.slug !== "string" || !part(raw.slug) || typeof raw.url !== "string" || typeof raw.title !== "string") throw new Error("Backup contains an invalid story.");
    const url = new URL(raw.url);
    if (url.protocol !== "https:" || url.port || url.username || url.password || !["asurascans.com", "www.webtoons.com", "vortexscans.org", "www.vortexscans.org", "www.mangakakalot.gg", "mangakakalot.gg"].includes(url.hostname)) throw new Error("Backup contains an unsupported source.");
    return { genres: Array.isArray(raw.genres) ? raw.genres.filter((tag): tag is string => typeof tag === "string" && tag.length <= 100).slice(0, 100) : undefined, slug: raw.slug, url: raw.url, title: raw.title.slice(0, 1000), summary: typeof raw.summary === "string" ? raw.summary.slice(0, 100_000) : "", cover: typeof raw.cover === "string" && raw.cover.startsWith("https://") ? raw.cover : "", rating: typeof raw.rating === "string" ? raw.rating : "", bookmarks: "", status: typeof raw.status === "string" ? raw.status : "", type: typeof raw.type === "string" ? raw.type : "", chapterCount: typeof raw.chapterCount === "number" && Number.isFinite(raw.chapterCount) ? raw.chapterCount : 0, latestChapter: typeof raw.latestChapter === "string" ? raw.latestChapter : "", language: typeof raw.language === "string" ? raw.language : undefined, kind: raw.kind === "novel" || url.pathname.startsWith("/novels/") ? "novel" : "comic", updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined, sourceDates: Boolean(raw.sourceDates), detailsCached: false };
  });
  const known = new Set(catalog.map(item => item.slug));
  const saved: Record<string, SavedStory> = {}, read: Record<string, Record<string, string>> = {}, history: ReturnType<typeof readingHistory> = {};
  for (const [slug, value] of Object.entries(data.saved)) if (known.has(slug) && object(value)) saved[slug] = { notifyReleases: typeof value.notifyReleases === "boolean" ? value.notifyReleases : undefined, liked: value.liked === true, bookmarked: value.bookmarked === true, list: ["reading", "planned", "finished", "hold"].includes(String(value.list)) ? value.list as SavedStory["list"] : undefined };
  for (const [slug, value] of Object.entries(data.read)) if (known.has(slug) && object(value)) {
    read[slug] = {};
    for (const [id, date] of Object.entries(value)) if (part(id) && typeof date === "string" && Number.isFinite(Date.parse(date))) read[slug][id] = date;
  }
  for (const [slug, value] of Object.entries(data.history)) if (known.has(slug) && object(value) && typeof value.chapter === "string" && part(value.chapter) && typeof value.fraction === "number" && Number.isFinite(value.fraction) && typeof value.readAt === "string" && Number.isFinite(Date.parse(value.readAt))) {
    const chapters: NonNullable<ReturnType<typeof readingHistory>[string]["chapters"]> = {};
    if (object(value.chapters)) for (const [id, position] of Object.entries(value.chapters)) {
      if (part(id) && object(position) && typeof position.fraction === "number" && Number.isFinite(position.fraction) && typeof position.readAt === "string" && Number.isFinite(Date.parse(position.readAt))) chapters[id] = { fraction: Math.max(0, Math.min(1, position.fraction)), readAt: position.readAt };
    }
    history[slug] = { chapter: value.chapter, fraction: Math.max(0, Math.min(1, value.fraction)), readAt: value.readAt, chapters };
  }
  const preferences: Partial<Preferences> = {};
  if (object(data.preferences)) {
    for (const key of ["readerKeepAwake", "readerVolumeScroll", "deleteAfterReading", "autoSync", "hideDownloaded", "hideLiked", "hideBookmarked"] as const) if (typeof data.preferences[key] === "boolean") preferences[key] = data.preferences[key];
    if (object(data.preferences.genreFilters)) {
      preferences.genreFilters = {};
      for (const source of ["asura", "webtoon", "vortex", "mangakakalot"] as const) {
        const tags = data.preferences.genreFilters[source];
        if (Array.isArray(tags)) preferences.genreFilters[source] = [...new Set(tags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0 && tag.length <= 100))].slice(0, 100);
      }
    }
    if (typeof data.preferences.novelFontSize === "number") preferences.novelFontSize = Math.max(14, Math.min(30, data.preferences.novelFontSize));
    if (data.preferences.novelTheme === "sepia" || data.preferences.novelTheme === "dark") preferences.novelTheme = data.preferences.novelTheme;
    if (typeof data.preferences.readerBrightness === "number" && Number.isFinite(data.preferences.readerBrightness)) preferences.readerBrightness = Math.max(-1, Math.min(1, data.preferences.readerBrightness));
    const enums = { source: ["asura", "webtoon", "vortex", "mangakakalot"], webtoonLanguage: ["en", "fr", "es", "de", "th", "id", "zh-hant"], webtoonCollection: ["originals", "canvas"], contentMode: ["all", "comics", "novels"], sort: ["smart", "trending", "rating", "updated", "title", "chapters"], period: ["week", "month", "all"], mobileData: ["ask", "never", "allow"] };
    for (const [key, allowed] of Object.entries(enums)) if (allowed.includes(String(data.preferences[key]))) Object.assign(preferences, { [key]: data.preferences[key] });
    if (data.preferences.releaseCheckInterval === 60 || data.preferences.releaseCheckInterval === 120) preferences.releaseCheckInterval = data.preferences.releaseCheckInterval;
    if (data.preferences.interval === 5 || data.preferences.interval === 10) preferences.interval = data.preferences.interval;
    if (typeof data.preferences.autoDownloadLimitMB === "number" && Number.isFinite(data.preferences.autoDownloadLimitMB)) preferences.autoDownloadLimitMB = Math.max(128, Math.min(100_000, data.preferences.autoDownloadLimitMB));
    if (object(data.preferences.weights)) { const weights = { ...DEFAULT_PREFERENCES.weights }; for (const key of ["trending", "rating", "length"] as const) { const value = data.preferences.weights[key]; if (typeof value === "number" && Number.isFinite(value)) weights[key] = Math.max(0, Math.min(5, value)); } preferences.weights = weights; }
  }
  return { catalog, saved, read, history, preferences };
}
export function restoreBackup(text: string): number {
  const imported = validateBackup(text);
  const oldCatalog = loadCatalog(), saved = savedStories(), read = readChapters(), history = readingHistory();
  for (const [slug, value] of Object.entries(imported.saved)) saved[slug] = { ...value, ...saved[slug], liked: Boolean(saved[slug]?.liked || value.liked), bookmarked: Boolean(saved[slug]?.bookmarked || value.bookmarked), list: saved[slug]?.list || value.list, autoDownload: saved[slug]?.autoDownload || false };
  for (const [slug, value] of Object.entries(imported.read)) read[slug] = { ...read[slug], ...value };
  for (const [slug, value] of Object.entries(imported.history)) {
    const current = history[slug], chapters: NonNullable<typeof value.chapters> = {};
    for (const entry of [current, value]) if (entry) {
      const positions = { ...entry.chapters };
      if (!positions[entry.chapter] || Date.parse(entry.readAt) >= Date.parse(positions[entry.chapter].readAt)) positions[entry.chapter] = { fraction: entry.fraction, readAt: entry.readAt };
      for (const [id, position] of Object.entries(positions)) if (!chapters[id] || Date.parse(position.readAt) > Date.parse(chapters[id].readAt)) chapters[id] = position;
    }
    history[slug] = { ...(!current || Date.parse(value.readAt) > Date.parse(current.readAt) ? value : current), chapters };
  }
  // Validate everything before writing; retain a rollback snapshot for write failures.
  const names = ["catalog.json", "saved.json", "read.json", "history.json", "preferences.json"];
  const before = names.map(name => { const file = new File(ROOT, name); return file.exists ? file.textSync() : null; });
  try {
    mergeCatalog(imported.catalog.filter(item => !oldCatalog.some(old => old.slug === item.slug)));
    new File(ROOT, "saved.json").write(JSON.stringify(saved)); new File(ROOT, "read.json").write(JSON.stringify(read)); new File(ROOT, "history.json").write(JSON.stringify(history));
    savePreferences({ ...DEFAULT_PREFERENCES, ...loadPreferences(), ...imported.preferences });
  } catch (error) { names.forEach((name, index) => { const file = new File(ROOT, name); if (before[index] !== null) file.write(before[index]!); else if (file.exists) file.delete(); }); throw error; }
  return imported.catalog.length;
}
export function backupFile(): File {
  const file = new File(Paths.cache, `NightShelf-${new Date().toISOString().slice(0, 10)}.json`); file.write(createBackup()); return file;
}
