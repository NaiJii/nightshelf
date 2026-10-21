import { chapterSort, mergeDiscovery, sourceOf } from "../parser";
import type { Series } from "../parser";
import { directoryHasMore, directoryUrl, imageReferer, parseKakalotCards, parseKakalotChapters, parseKakalotDetails, parseReaderSiteImages, parseVortexCards, parseVortexChapterPayload, parseVortexPostPayload } from "../reader-sites";
import type { ReaderSite } from "../reader-sites";
import type { Provider, RequestContext } from "./types";
import { cursorNumber, cursorObject } from "./types";
import { PageCache } from "./cache";
import { DESKTOP_AGENT } from "./assets";
import { ProviderError } from "../provider-errors";

type Cursor = { page: number; offset: number; loaded: number };
const siteSlug = (item: Series) => new URL(item.url).pathname.split("/").filter(Boolean).at(-1)!;
const cache = new PageCache<string, { items: Series[]; hasNext: boolean }>();

async function vortexDetails(item: Series, context: RequestContext): Promise<Series> {
  const id = item.vortexId || item.slug.match(/^vortex-(\d+)$/)?.[1];
  const query = id ? `postId=${encodeURIComponent(id)}` : `postSlug=${encodeURIComponent(siteSlug(item))}`;
  return parseVortexPostPayload(await context.json(`https://api.vortexscans.org/api/post?${query}`), item);
}
async function kakalotChapters(item: Series, context: RequestContext): Promise<Series> {
  const urls: Record<string, string> = {}, titles: Record<string, string> = {}, lockedChapterIds: string[] = [];
  let offset: number | undefined = 0, pages = 0, updatedAt: string | undefined;
  while (offset !== undefined) {
    if (pages++ >= 2000) throw new Error("MangaKakalot chapter pagination could not finish. Pull down to retry.");
    const chapters = parseKakalotChapters(await context.json(`https://www.mangakakalot.gg/api/manga/${encodeURIComponent(siteSlug(item))}/chapters?limit=500&offset=${offset}`), item.url, offset);
    lockedChapterIds.push(...chapters.lockedChapterIds);
    Object.assign(urls, chapters.chapterUrls); Object.assign(titles, chapters.chapterTitles);
    if (chapters.updatedAt && (!updatedAt || chapters.updatedAt > updatedAt)) updatedAt = chapters.updatedAt;
    offset = chapters.nextOffset;
  }
  const ids = Object.keys(urls).sort(chapterSort);
  return { ...item, chapterUrls: urls, chapterTitles: titles, chapterIds: ids, lockedChapterIds, detailsCached: true, chapterListComplete: true, chapterCount: ids.length + lockedChapterIds.length, latestChapter: ids.at(-1) || "", updatedAt, sourceDates: Boolean(updatedAt) };
}

function readerSite(source: ReaderSite): Provider<Cursor> {
  return {
    id: source,
    cursor(value) { const data = cursorObject(value); return { page: cursorNumber(data.page, 1), offset: cursorNumber(data.offset, 0), loaded: cursorNumber(data.loaded, 0) }; },
    matches: (previous, fresh) => previous.slug === fresh.slug || (sourceOf(previous) === source && previous.url === fresh.url),
    merge: mergeDiscovery,
    assetReferer: imageReferer,
    async browse(options, cursor, context) {
      const { page, offset, loaded } = cursor;
      const popular = !options.query && (options.sort === "smart" || options.sort === "trending");
      const url = directoryUrl(source, options.sort, options.query, page);
      let entry = cache.get(url, options.refresh && page === 1 && offset === 0);
      if (!entry) {
        const html = await context.text(url);
        const items = source === "vortex" ? parseVortexCards(html, popular) : parseKakalotCards(html);
        if (!items.length && !options.query && !(source === "vortex" && /initialPosts:/.test(html))) throw new ProviderError("parser", source, `${source === "vortex" ? "Vortex" : "MangaKakalot"} discovery is unavailable. Pull down to retry.`);
        entry = cache.set(url, { items, hasNext: directoryHasMore(html, source, url, items.length, popular) });
      }
      const items = entry.items.slice(offset, offset + 20).map((item, index) => popular ? { ...item, sourceRank: loaded + index + 1 } : item);
      const more = offset + items.length < entry.items.length;
      return {
        items, cursor: { offset: more ? offset + items.length : 0, page: more ? page : page + 1, loaded: loaded + items.length }, hasMore: more || entry.hasNext,
        resetSourceRanks: popular && page === 1 && offset === 0 ? item => sourceOf(item) === source : undefined,
      };
    },
    details: source === "vortex" ? vortexDetails : async (item, context) => parseKakalotDetails(await context.text(item.url), item),
    chapters: source === "vortex"
      ? async (item, context) => parseVortexChapterPayload(await context.json(`https://api.vortexscans.org/api/chapters?postId=${item.vortexId}&skip=0&take=all&order=asc`), item)
      : kakalotChapters,
    async content(item, chapter, context) {
      const images = parseReaderSiteImages(await context.text(chapter.url, item.url), source);
      return { kind: "images", assets: images.map(url => ({ url, referer: imageReferer(url, chapter.url), agent: DESKTOP_AGENT })) };
    },
    verify: source === "mangakakalot" ? async (url, context) => {
      const html = await context.text(url, undefined, 12_000);
      const ready = parseKakalotCards(html).length > 0 || /class=["'][^"']*\b(?:manga-info-top|container-chapter-reader)\b/i.test(html);
      if (!ready) throw new Error("The app still cannot read this source. Reload the verification page, complete its check, then retry.");
    } : undefined,
  };
}
export const vortex = readerSite("vortex");
export const mangakakalot = readerSite("mangakakalot");
