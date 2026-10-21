import { chapterSort, kindOf, parseApiSeries, parseChapters, parseDiscovery, parseNovelChapters, parseNovelText, parsePageImages, parseSeries, sourceOf } from "../parser";
import type { Period, Series } from "../parser";
import type { Provider, RequestContext } from "./types";
import { cursorNumber, cursorObject } from "./types";
import { PageCache } from "./cache";
import { MOBILE_AGENT } from "./assets";
import { throwIfAborted } from "../request-control";

const HOME = "https://asurascans.com/";
const API = "https://api.asurascans.com/api";
type Cursor = { comic: number; novel: number; comicDone: boolean; novelDone: boolean };
const rankingCache = new PageCache<Period, unknown[]>();
const siteSlug = (item: Series) => new URL(item.url).pathname.split("/").filter(Boolean).at(-1)!;

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
      const html = await context.text(item.url);
      const chapters = parseChapters(html, item.url);
      fresh = parseSeries(html, item.url, chapters);
      fresh.chapterUrls = Object.fromEntries(chapters.filter(chapter => !chapter.locked).map(chapter => [chapter.id, chapter.url]));
      if (!fresh.chapterCount || !fresh.cover) throw new Error("Story details are unavailable.");
    }
    return { ...item, ...fresh, genres: fresh.genres?.length ? fresh.genres : item.genres || fresh.genres, summary: fresh.summary || item.summary, slug: item.slug, popularRanks: item.popularRanks, rank: item.rank, localCover: item.localCover, metadataSyncedAt: new Date().toISOString() };
  },
  async chapters(item) {
    if (kindOf(item) !== "novel" && (item.chapterIds?.length || 0) + (item.lockedChapterIds?.length || 0) < item.chapterCount) throw new Error("The website returned an incomplete chapter list. Pull down to retry; older chapters have not all loaded yet.");
    const chapterIds = [...(item.chapterIds || [])].sort(chapterSort);
    return { ...item, chapterIds, detailsCached: true, syncedAt: new Date().toISOString() };
  },
  async content(item, chapter, context) {
    if (kindOf(item) === "novel") return { kind: "novel", text: parseNovelText(await context.json(`${API}/novel-series/${encodeURIComponent(siteSlug(item))}/chapter/${chapter.id}`)) };
    const images = parsePageImages(await context.text(chapter.url, item.url), chapter.url);
    return { kind: "images", assets: images.map(url => ({ url, referer: chapter.url, agent: MOBILE_AGENT })) };
  },
  async rankings(kind, period, context) {
    const url = kind === "comic" ? `${API}/trending/${period}?limit=10` : `${API}/novel-series?limit=10&sort=popular&period=${period}`;
    const result = await context.json(url) as { data?: unknown };
    if (!Array.isArray(result.data) || !result.data.length) throw new Error("Rankings unavailable.");
    return result.data.map(raw => parseApiSeries(raw, kind)).filter((item): item is Series => Boolean(item));
  },
  async discover(context: RequestContext) {
    const urls: string[] = [];
    for (const url of [HOME, `${HOME}novels`]) {
      try { urls.push(...parseDiscovery(await context.text(url))); }
      catch (error) {
        throwIfAborted(context.signal);
        if (error instanceof Error && error.name === "NetworkPaused") throw error;
        // An optional homepage failure must not discard the other discovery page.
      }
    }
    return urls.map(url => {
      const route = new URL(url).pathname.split("/").filter(Boolean).at(-1)!;
      const novel = new URL(url).pathname.startsWith("/novels/");
      return { url, slug: novel ? `novel--${route}` : route, title: route, summary: "", cover: "", rating: "", bookmarks: "", status: "", type: novel ? "Novel" : "Comic", chapterCount: 0, latestChapter: "", kind: novel ? "novel" as const : "comic" as const };
    });
  },
};
