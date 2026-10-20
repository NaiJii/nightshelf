export type SourceId = "asura" | "webtoon" | "vortex" | "mangakakalot";
export const SOURCES: { id: SourceId; name: string }[] = [{ id: "asura", name: "Asura" }, { id: "webtoon", name: "WEBTOON" }, { id: "vortex", name: "Vortex" }, { id: "mangakakalot", name: "MangaKakalot" }];
export type Series = {
  source?: SourceId;
  language?: string;
  chapterUrls?: Record<string, string>;
  chapterTitles?: Record<string, string>;
  sourceRank?: number;
  url: string;
  slug: string;
  title: string;
  summary: string;
  detailsCached?: boolean;
  metadataSyncedAt?: string;
  cover: string;
  localCover?: string;
  rating: string;
  bookmarks: string;
  status: string;
  type: string;
  chapterCount: number;
  chapterIds?: string[];
  latestChapter: string;
  rank?: number;
  syncedAt?: string;
  localChapters?: string[];
  hasLocalFiles?: boolean;
  updatedAt?: string;
  sourceDates?: boolean;
  kind?: "comic" | "novel";
  popularRanks?: Partial<Record<Period, number>>;
  genres?: string[];
};

export type Chapter = { id: string; url: string; locked?: boolean };
export type Period = "week" | "month" | "all";
export type ContentMode = "all" | "comics" | "novels";
export type DiscoveryFilters = { source?: SourceId; webtoonLanguage?: string; webtoonCollection?: "originals" | "canvas"; contentMode: ContentMode; hideDownloaded: boolean; hideLiked: boolean; hideBookmarked: boolean };
export type ReadingList = "reading" | "planned" | "finished" | "hold";
export type SavedStory = { liked?: boolean; bookmarked?: boolean; list?: ReadingList; autoDownload?: boolean };
export function formatRating(value: string): string {
  const parts = value.trim().match(/^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?$/);
  if (!parts || !Number.isFinite(Number(parts[1])) || (parts[2] && (!Number.isFinite(Number(parts[2])) || Number(parts[2]) <= 0))) return "";
  return Number(parts[1]).toFixed(1) + (parts[2] ? `/${Number(parts[2]).toFixed(1).replace(/\.0$/, "")}` : "");
}
export type NovelText = { title: string; paragraphs: string[] };

export function mergeDiscovery(fresh: Series, previous?: Series): Series {
  const item = { ...previous, ...fresh, slug: previous?.slug || fresh.slug, localCover: previous?.localCover, syncedAt: previous?.syncedAt };
  for (const key of ["summary", "rating", "cover", "status", "bookmarks", "latestChapter"] as const) if (!fresh[key]) item[key] = previous?.[key] || "";
  if (!fresh.chapterCount) item.chapterCount = previous?.chapterCount || 0;
  return item;
}

export function chapterListCached(item: Series): boolean {
  if (!item.detailsCached || !Array.isArray(item.chapterIds) || (!item.chapterIds.length && (item.chapterCount > 0 || !item.metadataSyncedAt))) return false;
  return sourceOf(item) === "asura" || item.chapterIds.every(id => Boolean(item.chapterUrls?.[id]));
}
export function chapterList(source: string[] = [], saved: string[] = [], read: Record<string, string> = {}, filter = "all", query = "", newest = true, titles: Record<string, string> = {}): string[] {
  const owned = new Set(saved);
  const term = query.trim().replace(/^chapter\s*/i, "").toLowerCase();
  return [...new Set([...source, ...saved])].filter(id => (id.toLowerCase().includes(term) || (titles[id] || "").toLowerCase().includes(query.trim().toLowerCase()))
    && (filter !== "saved" || owned.has(id)) && (filter !== "unread" || !read[id]))
    .sort((a, b) => newest ? chapterSort(b, a) : chapterSort(a, b));
}
export function nextUnread(chapters: string[], position: { chapter: string } | undefined, read: Record<string, string> = {}): string | undefined {
  return position && chapters.includes(position.chapter) && !read[position.chapter] ? position.chapter : chapters.find(chapter => !read[chapter]);
}
export function kindOf(item: Series): "comic" | "novel" { return item.kind || (new URL(item.url).pathname.startsWith("/novels/") ? "novel" : "comic"); }
export function sourceOf(item: Series): SourceId {
  const host = new URL(item.url).hostname;
  return host === "www.webtoons.com" ? "webtoon" : host === "vortexscans.org" || host === "www.vortexscans.org" ? "vortex" : host === "www.mangakakalot.gg" || host === "mangakakalot.gg" ? "mangakakalot" : "asura";
}
export function sourceLabel(item: Series): string { const source = sourceOf(item); return source === "webtoon" ? `WEBTOON · ${(item.language || "en").toUpperCase()}` : SOURCES.find(value => value.id === source)!.name; }
export function filterDiscovery(items: Series[], filters: DiscoveryFilters, saved: Record<string, SavedStory>): Series[] {
  return items.filter(item => (!filters.source || sourceOf(item) === filters.source)
    && (filters.source !== "webtoon" || item.language === (filters.webtoonLanguage || "en"))
    && (filters.source !== "webtoon" || !filters.webtoonCollection || item.url.includes("/canvas/") === (filters.webtoonCollection === "canvas"))
    && (filters.source && filters.source !== "asura" || filters.contentMode === "all" || kindOf(item) === (filters.contentMode === "novels" ? "novel" : "comic"))
    && (!filters.hideDownloaded || (!item.localChapters?.length && !item.hasLocalFiles))
    && (!filters.hideLiked || !saved[item.slug]?.liked)
    && (!filters.hideBookmarked || !saved[item.slug]?.bookmarked));
}
export function publicationState(item: Series, now = Date.now()): { label: string; color: string } {
  const status = item.status.toLowerCase();
  if (/drop|cancel/.test(status)) return { label: "Dropped", color: "#f08080" };
  if (/complet|finished/.test(status)) return { label: "Completed", color: "#9bafff" };
  if (/hiatus|on.hold/.test(status)) return { label: "On hiatus", color: "#d6a84b" };
  if (item.updatedAt && now - Date.parse(item.updatedAt) >= 30 * 86400_000) return { label: "Inactive", color: "#d6a84b" };
  if (/ongoing|releasing/.test(status)) return { label: "Ongoing", color: "#65cba1" };
  return { label: item.status || "Unknown", color: "#aaa6b3" };
}
export function releaseLabel(item: Series, now = Date.now()): string {
  const time = Date.parse(item.updatedAt || "");
  if (!Number.isFinite(time)) return "Release date unavailable";
  const days = Math.max(0, Math.floor((now - time) / 86400_000));
  return days === 0 ? "Updated today" : days === 1 ? "Updated yesterday" : days < 30 ? `Updated ${days} days ago` : `Updated ${new Date(time).toLocaleDateString()}`;
}

const CHAPTER_LINK = /href=["']([^"']*\/chapter\/([^"'/?#]+))[^"']*["']/gi;

export function decodeHtml(value: string): string {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"', nbsp: " ", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", ndash: "–", mdash: "—", hellip: "…" };
  return value.replace(/&(#x?[\da-f]+|\w+);/gi, (_, entity: string) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? `&${entity};`;
    const hex = entity[1]?.toLowerCase() === "x";
    const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

function attribute(tag: string, name: string): string {
  return decodeHtml(tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? "");
}

function meta(source: string, name: string): string {
  for (const tag of source.match(/<meta\b[^>]*>/gi) ?? []) {
    if (attribute(tag, "property") === name || attribute(tag, "name") === name) return attribute(tag, "content");
  }
  return "";
}

export function plainText(source: string): string {
  return decodeHtml(source
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function beforeLabel(text: string, label: string): string {
  return text.match(new RegExp(`([\\d.]+(?:K|M)?)\\s+${label}`, "i"))?.[1] ?? "";
}

function afterLabel(text: string, label: string): string {
  return text.match(new RegExp(`${label}\\s+([\\w-]+)`, "i"))?.[1] ?? "";
}

export function chapterSort(a: string, b: string): number {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  return a.localeCompare(b, undefined, { numeric: true });
}

export function parseChapters(source: string, baseUrl: string): Chapter[] {
  const chapters = new Map<string, string>();
  for (const match of source.matchAll(CHAPTER_LINK)) chapters.set(match[2], new URL(match[1], baseUrl).toString());
  return [...chapters].map(([id, url]) => ({ id, url })).sort((a, b) => chapterSort(a.id, b.id));
}

export function parseSeries(source: string, url: string): Series {
  const chapters = parseChapters(source, url);
  const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "series";
  const text = plainText(source);
  const dates = [...decodeHtml(source).matchAll(/"published_at"\s*:\s*(?:\[0,)?"([^"]+)"/g)].map(match => match[1]).filter(value => Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now()).sort((a, b) => Date.parse(b) - Date.parse(a));
  return {
    url,
    slug,
    title: (meta(source, "og:title") || source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || slug).split(" | ")[0].trim(),
    summary: plainText(source.match(/<div\b[^>]*\bid=["']description-text["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || meta(source, "og:description") || meta(source, "description")),
    cover: meta(source, "og:image"),
    rating: beforeLabel(text, "Rating"),
    bookmarks: beforeLabel(text, "Bookmarks"),
    status: afterLabel(text, "Status"),
    type: afterLabel(text, "Type"),
    chapterCount: chapters.length,
    chapterIds: chapters.map(chapter => chapter.id),
    latestChapter: chapters.at(-1)?.id ?? "",
    kind: new URL(url).pathname.startsWith("/novels/") ? "novel" : "comic",
    updatedAt: dates[0],
    sourceDates: true,
  };
}

export function parsePageImages(source: string, baseUrl: string): string[] {
  const images: string[] = [];
  for (const tag of source.match(/<img\b[^>]*>/gi) ?? []) {
    if (!/\bdata-page-index=/i.test(tag)) continue;
    const candidates = (attribute(tag, "data-srcset") || attribute(tag, "srcset")).split(",")
      .map(value => value.trim().split(/\s+/)).filter(([url]) => Boolean(url))
      .sort((a, b) => parseFloat(b[1] || "0") - parseFloat(a[1] || "0"));
    const src = attribute(tag, "data-original") || attribute(tag, "data-full") || candidates[0]?.[0] || attribute(tag, "data-src") || attribute(tag, "src");
    if (src) {
      const url = new URL(src, baseUrl);
      if (url.protocol === "https:" || url.protocol === "http:") images.push(url.toString());
    }
  }
  return [...new Set(images)];
}

export function parseDiscovery(source: string): string[] {
  return [...new Set([...source.matchAll(/href=["'](\/(?:comics|novels)\/[^/"'?#]+)\/?["']/gi)]
    .map(match => `https://asurascans.com${match[1]}`))].slice(0, 36);
}

export type SortOrder = "smart" | "trending" | "rating" | "updated" | "chapters" | "title";
export type SortWeights = { trending: number; rating: number; length: number };
export const DEFAULT_WEIGHTS: SortWeights = { trending: 3, rating: 2, length: 1 };

export function sortExplore(items: Series[], order: SortOrder, weights: SortWeights): Series[] {
  const score = (item: Series) => weights.trending * (item.rank ? (11 - item.rank) / 10 : 0)
    + weights.rating * (Number(item.rating) || 0) / 10
    + weights.length * Math.min(item.chapterCount / 200, 1);
  return [...items].sort((a, b) => {
    if (order === "title") return a.title.localeCompare(b.title);
    if (order === "rating") return (Number(b.rating) || 0) - (Number(a.rating) || 0);
    if (order === "trending") return (a.rank || 999) - (b.rank || 999);
    if (order === "updated") return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    if (order === "chapters") return b.chapterCount - a.chapterCount;
    return score(b) - score(a);
  });
}

export function parseTrending(source: string): string[] {
  const start = source.search(/Trending Comics/i);
  const end = source.search(/Trending Novels/i);
  const section = source.slice(Math.max(start, 0), end > start ? end : undefined);
  const urls: string[] = [];
  for (const match of section.matchAll(/href=["'](\/comics\/[^/"'?#]+)\/?["']/gi)) urls.push(`https://asurascans.com${match[1]}`);
  return [...new Set(urls)].slice(0, 10);
}

export function parseApiSeries(raw: unknown, kind: "comic" | "novel"): Series | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.slug !== "string" || !/^[a-zA-Z0-9_-]+$/.test(data.slug) || typeof data.title !== "string") return null;
  const path = kind === "novel" ? `/novels/${data.slug}` : typeof data.public_url === "string" ? data.public_url : `/comics/${data.slug}`;
  let url: URL;
  try { url = new URL(path, "https://asurascans.com"); } catch { return null; }
  if (url.hostname !== "asurascans.com" || !/^\/(comics|novels)\/[^/]+$/.test(url.pathname)) return null;
  const slug = kind === "novel" ? `novel--${data.slug}` : url.pathname.split("/").at(-1)!;
  const recent = Array.isArray(data.recent_chapters) ? data.recent_chapters : [];
  const latest = data.latest_chapter_number ?? (recent.reduce((max, item) => Math.max(max, Number(item.number) || 0), 0) || data.chapter_count);
  return {
    url: url.toString(), slug, kind, title: data.title, summary: plainText(String(data.description || "")),
    cover: String(data.cover_url || data.cover || ""), rating: String(data.rating || ""), bookmarks: String(data.bookmarks || ""),
    status: String(data.status || "unknown"), type: kind === "novel" ? "Novel" : String(data.type || "Comic"),
    chapterCount: Number(data.chapter_count) || 0, latestChapter: String(latest || ""),
    updatedAt: typeof data.last_chapter_at === "string" && Number.isFinite(Date.parse(data.last_chapter_at)) ? data.last_chapter_at : undefined,
    sourceDates: true,
    genres: Array.isArray(data.genres) ? data.genres.map(value => typeof value === "string" ? value : value?.name).filter((value): value is string => typeof value === "string") : [],
  };
}

export function parseNovelChapters(raw: unknown, seriesUrl: string): Chapter[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(item => item && /^\d+(?:\.\d+)?$/.test(String(item.number))).map(item => ({ id: String(item.number), url: `${seriesUrl}/chapter/${item.number}`, locked: item.is_locked !== false })).sort((a, b) => chapterSort(a.id, b.id));
}

export function parseNovelText(raw: unknown): NovelText {
  if (!raw || typeof raw !== "object") throw new Error("No novel text returned.");
  const data = raw as Record<string, unknown>;
  if (data.is_locked !== false || typeof data.content_html !== "string") throw new Error("This chapter is locked or requires website access.");
  const clean = data.content_html.replace(/<!--[^]*?-->/g, "").replace(/<(script|style|iframe|form)\b[^]*?<\/\1>/gi, "");
  const paragraphs = clean.split(/<\/(?:p|div|h[1-6]|li|blockquote)>|<br\s*\/?\s*>/i).map(plainText).filter(Boolean);
  if (!paragraphs.length) throw new Error("This chapter has no readable text.");
  return { title: plainText(String(data.title || "")), paragraphs };
}

export function selectChapters(chapters: Chapter[], selector: string): Chapter[] {
  if (selector === "@first") return chapters.slice(0, 5);
  if (selector === "@latest") return chapters.slice(-5);
  if (!selector.trim()) return chapters;
  const exact = new Set<string>();
  const ranges: [number, number][] = [];
  for (const token of selector.split(",").map(value => value.trim()).filter(Boolean)) {
    const range = token.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
    if (range) ranges.push([Math.min(+range[1], +range[2]), Math.max(+range[1], +range[2])]);
    else exact.add(token);
  }
  return chapters.filter(({ id }) => exact.has(id) || ranges.some(([from, to]) => +id >= from && +id <= to));
}
