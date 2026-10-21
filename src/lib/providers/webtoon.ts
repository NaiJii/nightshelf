import { chapterSort, mergeDiscovery, sourceOf } from "../parser";
import type { Series } from "../parser";
import { parseWebtoonCards, parseWebtoonDetails, parseWebtoonEpisodes, parseWebtoonImages, webtoonLanguage, webtoonSearchHasNext } from "../webtoon";
import type { Provider } from "./types";
import { cursorNumber, cursorObject } from "./types";
import { PageCache } from "./cache";
import { DESKTOP_AGENT } from "./assets";
import { ProviderError } from "../provider-errors";

type Cursor = { page: number; offset: number };
const cache = new PageCache<string, { items: Series[]; hasNext: boolean }>();
export const webtoon: Provider<Cursor> = {
  id: "webtoon",
  cursor(value) { const data = cursorObject(value); return { page: cursorNumber(data.page, 1), offset: cursorNumber(data.offset, 0) }; },
  needsDetails: item => !item.chapterCount,
  matches: (previous, fresh) => previous.slug === fresh.slug,
  merge: mergeDiscovery,
  async browse(options, cursor, context) {
    const language = webtoonLanguage(options.language);
    const { page, offset } = cursor;
    const url = options.query
      ? `https://www.webtoons.com/${language}/search/${options.collection === "canvas" ? "canvas" : "originals"}?keyword=${encodeURIComponent(options.query)}&page=${page}`
      : `https://www.webtoons.com/${language}/ranking/${options.collection === "canvas" ? "canvas" : options.sort === "trending" ? "trending" : "popular"}`;
    let entry = cache.get(url, options.refresh && offset === 0 && page === 1);
    if (!entry) {
      const html = await context.text(url), items = parseWebtoonCards(html, language);
      if (!items.length && !options.query) throw new ProviderError("parser", "webtoon", "WEBTOON discovery is unavailable. Pull down to retry.");
      entry = cache.set(url, { items, hasNext: Boolean(options.query && webtoonSearchHasNext(html, url)) });
    }
    const popular = !options.query && (options.collection === "canvas" || options.sort !== "trending");
    const items = entry.items.slice(offset, offset + 20).map((item, index) => popular ? { ...item, sourceRank: offset + index + 1 } : item);
    const more = offset + items.length < entry.items.length;
    return {
      items, cursor: { offset: more ? offset + items.length : 0, page: more ? page : page + 1 }, hasMore: more || entry.hasNext,
      resetSourceRanks: popular && offset === 0 ? item => sourceOf(item) === "webtoon" && item.language === language && item.url.includes("/canvas/") === (options.collection === "canvas") : undefined,
    };
  },
  async details(item, context) { return parseWebtoonDetails(await context.text(item.url), item); },
  async chapters(item, context) {
    const known = new Set(item.chapterIds || []);
    const urls = { ...item.chapterUrls }, titles = { ...item.chapterTitles };
    const locked = new Set(item.lockedChapterIds || []);
    let page: string | undefined = item.url, count = 0;
    const visited = new Set<string>();
    let updatedAt = item.updatedAt, sourceDates = item.sourceDates;
    while (page) {
      if (visited.has(page) || count++ >= 2000) throw new Error("WEBTOON episode pagination could not finish. Pull down to retry.");
      visited.add(page);
      const parsed = parseWebtoonEpisodes(await context.text(page, page === item.url ? undefined : item.url), page);
      for (const id of parsed.locked) { locked.add(id); delete urls[id]; }
      for (const id of parsed.ids) locked.delete(id);
      Object.assign(urls, parsed.urls); Object.assign(titles, parsed.titles);
      if (page === item.url) { updatedAt = parsed.updatedAt; sourceDates = Boolean(parsed.updatedAt); }
      if (item.detailsCached && item.chapterUrls && parsed.ids.some(id => known.has(id))) break;
      page = parsed.next;
      if (page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    const ids = Object.keys(urls).sort(chapterSort);
    return { ...item, updatedAt, sourceDates, detailsCached: true, chapterUrls: urls, chapterTitles: titles, chapterIds: ids, lockedChapterIds: [...locked], chapterCount: Math.max(item.chapterCount, ids.length + locked.size), latestChapter: item.latestChapter || ids.at(-1) || "", syncedAt: new Date().toISOString() };
  },
  async content(item, chapter, context) {
    const images = parseWebtoonImages(await context.text(chapter.url, item.url));
    return { kind: "images", assets: images.map(url => ({ url, referer: chapter.url, agent: DESKTOP_AGENT })) };
  },
};
