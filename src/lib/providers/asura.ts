import { chapterSort, kindOf, parseApiSeries, parseNovelChapters, parseNovelText, sourceOf } from "../parser";
import type { Period, Series } from "../parser";
import type { Provider } from "./types";
import { cursorNumber, cursorObject } from "./types";
import { PageCache } from "./cache";
import { MOBILE_AGENT } from "./assets";

const API = "https://api.asurascans.com/api";
type Cursor = { comic: number; novel: number; comicDone: boolean; novelDone: boolean };
const rankingCache = new PageCache<Period, unknown[]>();
function siteSlug(item: Series): string {
  if (item.asuraSlug) return item.asuraSlug;
  const route = new URL(item.url).pathname.split("/").filter(Boolean).at(-1)!;
  return kindOf(item) === "comic" ? route.replace(/-[a-f\d]{8}$/i, "") : route;
}

type ComicChapter = { number: number | string; series_slug?: string; title?: string; is_premium?: boolean; is_locked?: boolean; early_access_until?: string; access_gate?: string; pages?: { url?: unknown }[]; page_count?: number };
function comicChapter(raw: unknown, slug: string): ComicChapter {
  if (!raw || typeof raw !== "object") throw new Error("Asura returned invalid chapter details.");
  const chapter = raw as ComicChapter;
  if (!/^\d+(?:\.\d+)?$/.test(String(chapter.number)) || (chapter.series_slug && chapter.series_slug !== slug)) throw new Error("Asura returned chapters for a different story. Refresh the story and retry.");
  return chapter;
}
function restricted(chapter: ComicChapter): boolean {
  return chapter.is_premium !== false || chapter.is_locked === true || Boolean(chapter.access_gate)
    || Boolean(chapter.early_access_until && (!Number.isFinite(Date.parse(chapter.early_access_until)) || Date.parse(chapter.early_access_until) > Date.now()));
}

export function mergeAsuraListing(fresh: Series, previous?: Series): Series {
  return {
    ...previous, ...fresh,
    slug: previous?.slug || fresh.slug,
    genres: fresh.genres?.length ? fresh.genres : previous?.genres || fresh.genres,
    summary: previous?.detailsCached || previous?.metadataSyncedAt ? previous.summary || fresh.summary : fresh.summary || previous?.summary || "",
    localCover: previous?.localCover, syncedAt: previous?.syncedAt,
    rank: fresh.rank ?? previous?.rank,
    popularRanks: fresh.popularRanks ? { ...previous?.popularRanks, ...fresh.popularRanks } : previous?.popularRanks,
  };
}

export const asura: Provider<Cursor> = {
  id: "asura",
  cursor(value) {
    const data = cursorObject(value);
    for (const key of ["comicDone", "novelDone"]) if (data[key] !== undefined && typeof data[key] !== "boolean") throw new Error("Invalid Asura cursor.");
    return { comic: cursorNumber(data.comic, 0), novel: cursorNumber(data.novel, 0), comicDone: data.comicDone === true, novelDone: data.novelDone === true };
  },
  matches: (previous, fresh) => sourceOf(previous) === "asura" && kindOf(previous) === kindOf(fresh) && (previous.url === fresh.url || previous.title.toLowerCase() === fresh.title.toLowerCase()),
  merge: mergeAsuraListing,
  async browse(options, cursor, context) {
    const next = { ...cursor }, items: Series[] = [];
    for (const kind of ["comic", "novel"] as const) {
      const done = kind === "comic" ? "comicDone" : "novelDone";
      if (next[done]) continue;
      if (options.mode !== "all" && kind !== (options.mode === "novels" ? "novel" : "comic")) { next[done] = true; continue; }
      const offset = next[kind];
      let data: unknown[], more: boolean;
      if (kind === "comic" && options.sort === "trending" && !options.query) {
        let ranking = rankingCache.get(options.period, options.refresh && offset === 0);
        if (!ranking) {
          const result = await context.json(`${API}/trending/${options.period}?limit=100`) as { data?: unknown };
          if (!Array.isArray(result.data)) throw new Error("Popularity rankings are unavailable.");
          ranking = rankingCache.set(options.period, result.data);
        }
        data = ranking.slice(offset, offset + 20); more = offset + data.length < ranking.length;
      } else {
        const sorts = { smart: "popular", trending: "popular", rating: "rating", updated: "latest", title: "title", chapters: "latest" };
        const params = new URLSearchParams({ limit: "20", offset: String(offset), sort: sorts[options.sort], order: options.sort === "title" ? "asc" : "desc" });
        if (options.query) params.set("search", options.query);
        if (options.sort === "trending") params.set("period", options.period);
        const result = await context.json(`${API}/${kind === "comic" ? "series" : "novel-series"}?${params}`) as { data?: unknown; meta?: { total?: number; has_more?: boolean } };
        if (!Array.isArray(result.data)) throw new Error("The next page is unavailable. Tap to retry.");
        data = result.data;
        more = result.meta?.has_more ?? (typeof result.meta?.total === "number" ? offset + data.length < result.meta.total : data.length === 20);
      }
      next[kind] += data.length; next[done] = !data.length || !more;
      for (const [index, raw] of data.entries()) {
        const item = parseApiSeries(raw, kind); if (!item) continue;
        if (options.sort === "trending" && !options.query) { item.popularRanks = { [options.period]: offset + index + 1 }; if (options.period === "week") item.rank = offset + index + 1; }
        items.push(item);
      }
    }
    return { items, cursor: next, hasMore: !next.comicDone || !next.novelDone, rankings: options.sort === "trending" && !options.query };
  },
  async details(item, context) {
    let fresh: Series;
    if (kindOf(item) === "novel") {
      const result = await context.json(`${API}/novel-series/${encodeURIComponent(siteSlug(item))}`) as { series?: unknown; chapters?: unknown };
      const parsed = parseApiSeries(result.series, "novel");
      if (!parsed) throw new Error("Novel details are unavailable.");
      const chapters = parseNovelChapters(result.chapters, item.url);
      fresh = { ...parsed, chapterIds: chapters.filter(chapter => !chapter.locked).map(chapter => chapter.id), chapterUrls: Object.fromEntries(chapters.filter(chapter => !chapter.locked).map(chapter => [chapter.id, chapter.url])), lockedChapterIds: chapters.filter(chapter => chapter.locked).map(chapter => chapter.id), chapterCount: chapters.length || parsed.chapterCount, latestChapter: chapters.at(-1)?.id || parsed.latestChapter };
    } else {
      const result = await context.json(`${API}/series/${encodeURIComponent(siteSlug(item))}`) as { series?: unknown };
      const parsed = parseApiSeries(result?.series, "comic");
      if (!parsed) throw new Error("Story details are unavailable.");
      fresh = parsed;
    }
    return { ...item, ...fresh, genres: fresh.genres?.length ? fresh.genres : item.genres || fresh.genres, summary: fresh.summary || item.summary, slug: item.slug, popularRanks: item.popularRanks, rank: item.rank, localCover: item.localCover, metadataSyncedAt: new Date().toISOString() };
  },
  async chapters(item, context) {
    if (kindOf(item) !== "novel") {
      const slug = siteSlug(item);
      const result = await context.json(`${API}/series/${encodeURIComponent(slug)}/chapters`) as { data?: unknown };
      if (!Array.isArray(result?.data)) throw new Error("Asura chapter list is unavailable.");
      const chapters = result.data.map(raw => comicChapter(raw, slug));
      const ids = chapters.map(chapter => String(chapter.number));
      if (new Set(ids).size !== ids.length || ids.length < item.chapterCount) throw new Error("Asura returned an incomplete chapter list. Pull down to retry.");
      const publicChapters = chapters.filter(chapter => !restricted(chapter));
      const chapterIds = publicChapters.map(chapter => String(chapter.number)).sort(chapterSort);
      return { ...item, chapterIds, chapterUrls: Object.fromEntries(publicChapters.map(chapter => [String(chapter.number), `${item.url}/chapter/${chapter.number}`])), chapterTitles: Object.fromEntries(chapters.map(chapter => [String(chapter.number), `Chapter ${chapter.number}${chapter.title ? ` · ${chapter.title}` : ""}`])), lockedChapterIds: chapters.filter(restricted).map(chapter => String(chapter.number)).sort(chapterSort), chapterCount: chapters.length, latestChapter: [...ids].sort(chapterSort).at(-1) || "", chapterListComplete: true, detailsCached: true, syncedAt: new Date().toISOString() };
    }
    const chapterIds = [...(item.chapterIds || [])].sort(chapterSort);
    return { ...item, chapterIds, detailsCached: true, syncedAt: new Date().toISOString() };
  },
  async content(item, chapter, context) {
    if (kindOf(item) === "novel") return { kind: "novel", text: parseNovelText(await context.json(`${API}/novel-series/${encodeURIComponent(siteSlug(item))}/chapter/${chapter.id}`)) };
    if (!/^\d+(?:\.\d+)?$/.test(chapter.id)) throw new Error("Invalid chapter number.");
    const slug = siteSlug(item);
    const result = await context.json(`${API}/series/${encodeURIComponent(slug)}/chapters/${chapter.id}`) as { data?: { is_locked?: boolean; access_gate?: string; chapter?: ComicChapter } };
    const data = result?.data;
    if (data?.is_locked !== false || data.access_gate) throw new Error("This chapter is locked or requires website access.");
    const detail = comicChapter(data.chapter, slug);
    if (String(detail.number) !== chapter.id || restricted(detail)) throw new Error("This public chapter is unavailable.");
    if (!Array.isArray(detail.pages) || !detail.pages.length || detail.page_count !== detail.pages.length) throw new Error("Asura returned an incomplete panel list. Retry the chapter.");
    const urls = detail.pages.map(page => {
      if (typeof page?.url !== "string") throw new Error("Asura returned an invalid panel address.");
      const url = new URL(page.url);
      if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Asura returned an invalid panel address.");
      return url.toString();
    });
    return { kind: "images", assets: urls.map(url => ({ url, referer: chapter.url, agent: MOBILE_AGENT })) };
  },
  async rankings(kind, period, context) {
    const url = kind === "comic" ? `${API}/trending/${period}?limit=10` : `${API}/novel-series?limit=10&sort=popular&period=${period}`;
    const result = await context.json(url) as { data?: unknown };
    if (!Array.isArray(result.data) || !result.data.length) throw new Error("Rankings unavailable.");
    return result.data.map(raw => parseApiSeries(raw, kind)).filter((item): item is Series => Boolean(item));
  },
};
