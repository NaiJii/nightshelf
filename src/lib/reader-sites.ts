import { chapterSort, decodeHtml, plainText, parseGenreLinks } from "./parser";
import type { Series, SortOrder } from "./parser";

export type ReaderSite = "vortex" | "mangakakalot";
export const SITE_HOME = { vortex: "https://vortexscans.org", mangakakalot: "https://www.mangakakalot.gg" };
export function imageReferer(url: string, referer: string): string { return /(?:^|\.)2xstorage\.com$/.test(new URL(url).hostname) || new URL(url).hostname === "storage.waitst.com" ? SITE_HOME.mangakakalot + "/" : referer; }
export function attribute(tag: string, key: string): string {
  const match = tag.match(new RegExp(`(?:^|\\s)${key}\\s*=\\s*(?:"([^"<>]*)"|'([^'<>]*)')`, "i"));
  return decodeHtml(match?.[1] ?? match?.[2] ?? "");
}
function metadata(html: string, key: string): string { return attribute([...html.matchAll(/<meta\b[^>]*>/gi)].find(([tag]) => attribute(tag, "property") === key || attribute(tag, "name") === key)?.[0] || "", "content"); }
function safeUrl(value: string, base: string): string {
  if (!value) return "";
  try { const url = new URL(decodeHtml(value), base); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}
export function section(html: string, key: string, value: string): string {
  const tags = [...html.matchAll(/<div\b[^>]*>/gi)];
  const start = tags.find(match => key === "class" ? attribute(match[0], key).split(/\s+/).includes(value) : attribute(match[0], key) === value);
  if (!start) return "";
  const from = start.index! + start[0].length;
  let depth = 1;
  for (const match of html.slice(from).matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += /^<\//.test(match[0]) ? -1 : 1;
    if (!depth) return html.slice(from, from + match.index!);
  }
  return "";
}
function scalar(block: string, name: string): string {
  const literal = block.match(new RegExp(`(?:^|[,{}])\\s*"?${name}"?\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`))?.[1];
  if (!literal) return "";
  // Decode a string literal only. Never execute the site's hydration JavaScript.
  try { return JSON.parse(literal.replace(/\\x([\da-f]{2})/gi, "\\u00$1")); } catch { return ""; }
}
function hydrationRecords(html: string): { at: number; block: string }[] {
  const starts = [...html.matchAll(/\$[A-Za-z_][\w$]*\[\d+\]\s*=\s*\{/g)];
  return starts.map((match, index) => ({ at: match.index!, block: html.slice(match.index! + match[0].length - 1, starts[index + 1]?.index ?? html.length) }));
}
function numericField(block: string, name: string): string { return block.match(new RegExp(`(?:^|[,{}])\\s*"?${name}"?\\s*:\\s*(\\d+(?:\\.\\d+)?)`))?.[1] || ""; }
export function vortexPostId(html: string, url: string): string {
  const route = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1)!);
  // Read the public identity without depending on the hydration variable or record boundaries.
  for (const match of html.matchAll(/\b"?id"?\s*:\s*(\d+)\s*,\s*"?slug"?\s*:\s*("[^"\\]*")/g)) {
    try { if (JSON.parse(match[2]) === route) return match[1]; } catch { /* unrelated record */ }
  }
  return "";
}
function date(value: string): string | undefined { const parsed = Date.parse(value); return Number.isFinite(parsed) && parsed <= Date.now() ? new Date(parsed).toISOString() : undefined; }
function siteStoryUrl(value: string, source: ReaderSite): string {
  const url = safeUrl(value, SITE_HOME[source]);
  if (!url) return "";
  const parsed = new URL(url);
  if (parsed.origin !== SITE_HOME[source]) return "";
  return (source === "vortex" ? /^\/series\/[^/]+\/?$/ : /^\/manga\/[a-z\d_-]+\/?$/i).test(parsed.pathname) ? parsed.origin + parsed.pathname.replace(/\/$/, "") : "";
}
export function directoryUrl(source: ReaderSite, sort: SortOrder, query: string, page: number): string {
  if (source === "vortex") {
    if (!query && (sort === "smart" || sort === "trending")) return SITE_HOME.vortex + "/";
    return `${SITE_HOME.vortex}/series/?${new URLSearchParams({ page: String(page), searchTerm: query, sortBy: "latest_chapters", sortDirection: "desc" })}`;
  }
  const path = query ? `/search/story/${encodeURIComponent(query.trim().toLowerCase().replace(/\s+/g, "_"))}` : `/manga-list/${sort === "updated" ? "latest-manga" : "hot-manga"}`;
  return `${SITE_HOME.mangakakalot}${path}?page=${page}`;
}
export function parseVortexCards(html: string, popular = false, metadataOnly = false): Series[] {
  const matches = hydrationRecords(html).filter(record => scalar(record.block, "postTitle") && scalar(record.block, "slug") && numericField(record.block, "id"));
  const items = new Map<string, Series>();
  for (const [index, match] of matches.entries()) {
    const block = html.slice(match.at, matches[index + 1]?.at ?? html.length);
    const route = scalar(match.block, "slug");
    const title = scalar(match.block, "postTitle");
    const url = siteStoryUrl(`/series/${route}`, "vortex");
    if (!url || !title || /(?:^|,)\s*isNovel\s*:\s*(?:!0|true)/.test(match.block)) continue;
    const updatedAt = date(scalar(block, "lastChapterAddedAt") || scalar(block, "createdAt"));
    const rating = numericField(block, "averageRating");
    const counts = block.slice(block.indexOf("_count:"));
    const chapterCount = block.includes("_count:") ? Number(numericField(counts, "chapters")) : 0;
    const numbers = [...block.matchAll(/(?:^|[,{}])\s*"?number"?\s*:\s*(\d+(?:\.\d+)?)/g)].map(value => value[1]).sort(chapterSort);
    items.set(url, { source: "vortex", slug: `vortex-${numericField(match.block, "id")}`, url, title, summary: plainText(scalar(match.block, "postContent")), cover: safeUrl(scalar(match.block, "featuredImage"), SITE_HOME.vortex), rating, bookmarks: block.includes("_count:") ? numericField(counts, "bookmarks") : "", status: scalar(match.block, "seriesStatus"), type: scalar(match.block, "seriesType") || "Comic", kind: "comic", chapterCount, latestChapter: numbers.at(-1) || "", updatedAt, sourceDates: Boolean(updatedAt) });
  }
  if (metadataOnly) return [...items.values()];
  let body = html.slice(html.indexOf("<body"));
  if (popular) {
    const headings = [...body.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
    const first = headings.find(match => /^popular\s+today$/i.test(plainText(match[1])));
    const last = headings.find(match => match.index! > (first?.index ?? Infinity) && /^latest\s+releases$/i.test(plainText(match[1])));
    body = first ? body.slice(first.index, last?.index) : "";
  }
  const ordered = new Map<string, Series>();
  for (const [, tag, content] of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const url = siteStoryUrl(attribute(tag, "href"), "vortex");
    if (!url) continue;
    if (items.has(url)) { ordered.set(url, items.get(url)!); continue; }
    const image = content.match(/<img\b[^>]*>/i)?.[0] || "";
    const title = (attribute(image, "alt") || attribute(tag, "aria-label").replace(/^Open\s+/i, "")).replace(/^Cover of\s+/i, "");
    const cover = safeUrl(attribute(image, "data-fallback-src") || attribute(image, "data-src") || attribute(image, "src"), SITE_HOME.vortex);
    if (!title || !cover || ordered.has(url)) continue;
    // Keep identity deterministic if the site omits or rearranges its hydration data.
    const route = new URL(url).pathname;
    let left = 2166136261, right = 5381;
    for (let i = 0; i < route.length; i++) { left = Math.imul(left ^ route.charCodeAt(i), 16777619); right = Math.imul(right, 33) ^ route.charCodeAt(i); }
    ordered.set(url, { source: "vortex", slug: `vortex-url-${(left >>> 0).toString(16)}${(right >>> 0).toString(16)}`, url, title: plainText(title), cover, summary: "", rating: "", bookmarks: "", status: "Unknown", type: "Comic", kind: "comic", chapterCount: 0, latestChapter: "" });
  }
  return [...ordered.values()];
}
export function parseKakalotCards(html: string): Series[] {
  const body = section(html, "class", "comic-list") || section(html, "class", "panel_story_list") || html;
  const starts = [...body.matchAll(/<div\b[^>]*class=["'][^"']*\b(?:list-comic-item-wrap|story_item)\b[^"']*["'][^>]*>/gi)];
  const items = new Map<string, Series>();
  for (const [index, start] of starts.entries()) {
    const block = body.slice(start.index!, starts[index + 1]?.index ?? body.length);
    const anchors = [...block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
    const first = anchors.find(match => siteStoryUrl(attribute(match[1], "href"), "mangakakalot"));
    if (!first) continue;
    const url = siteStoryUrl(attribute(first[1], "href"), "mangakakalot");
    const heading = block.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "";
    const image = block.match(/<img\b[^>]*>/i)?.[0] || "";
    const title = plainText(heading) || attribute(first[1], "title") || attribute(image, "alt");
    if (!title) continue;
    const slug = new URL(url).pathname.split("/").at(-1)!;
    const latestChapter = anchors.map(match => attribute(match[1], "href").match(/\/chapter-([\d.]+)/)?.[1]).find(Boolean) || "";
    const summary = plainText(block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");
    items.set(url, { source: "mangakakalot", slug: `mangakakalot-${slug}`, url, title, cover: safeUrl(attribute(image, "data-src") || attribute(image, "src"), url), summary, rating: "", bookmarks: "", status: "", type: "Manga", kind: "comic", chapterCount: 0, latestChapter });
  }
  return [...items.values()];
}
export function directoryHasMore(html: string, source: ReaderSite, url: string, count: number, popular: boolean): boolean {
  if (source === "vortex") {
    if (popular) return false;
    const total = Number(html.match(/initialTotalCount:(\d+)/)?.[1]);
    const perPage = Number(html.match(/itemsPerPage:(\d+)/)?.[1]);
    const page = Number(new URL(url).searchParams.get("page") || 1);
    return Number.isFinite(total) && perPage > 0 && page * perPage < total;
  }
  const current = new URL(url), page = Number(current.searchParams.get("page") || 1);
  return [...html.matchAll(/<a\b[^>]*>/gi)].some(([tag]) => {
    const href = safeUrl(attribute(tag, "href"), url);
    if (!href) return false;
    const next = new URL(href);
    return next.origin === current.origin && next.pathname === current.pathname && Number(next.searchParams.get("page")) === page + 1;
  });
}
export function parseVortexMetadata(html: string, item: Series): Series {
  let own: Series | undefined;
  try { own = parseVortexCards(html, false, true).find(value => value.url === item.url.replace(/\/$/, "")); } catch { /* visible HTML remains usable without hydration */ }
  const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, "").split(/<h[1-6]\b[^>]*>\s*Similar Series/i)[0];
  const title = plainText(body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "") || own?.title;
  if (!title) throw new Error("Vortex story details are unavailable. Pull down to retry.");
  const fields = new Map([...body.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)].map(match => [plainText(match[1]).toLowerCase(), plainText(match[2])]));
  if (!own && !fields.has("chapters") && !fields.has("status")) throw new Error("Vortex returned a page without story details. Pull down to retry.");
  const text = plainText(body);
  const coverImage = [...body.matchAll(/<img\b[^>]*>/gi)].find(([tag]) => attribute(tag, "alt").replace(/^Cover of\s+/i, "") === title)?.[0] || "";
  const cover = safeUrl(attribute(coverImage, "data-fallback-src") || attribute(coverImage, "data-src") || attribute(coverImage, "src"), item.url);
  const summary = own?.summary || plainText(section(html, "itemProp", "description")) || plainText(metadata(html, "description"));
  const updatedAt = own?.updatedAt || date(metadata(html, "og:updated_time"));
  return { ...item, ...own, slug: item.slug, title, summary, genres: parseGenreLinks(body), cover: own?.cover || cover || item.cover, rating: own?.rating || text.match(/([\d.]+)\s+Ratings?\b/i)?.[1] || "", bookmarks: own?.bookmarks || text.match(/([\d.,]+[KM]?)\s+Favorites\b/i)?.[1] || "", status: own?.status || fields.get("status") || "Unknown", type: own?.type || fields.get("type") || "Comic", chapterCount: own?.chapterCount || Number(fields.get("chapters")?.replace(/,/g, "")) || 0, updatedAt, sourceDates: Boolean(updatedAt), metadataSyncedAt: new Date().toISOString() };
}
export function parseVortexChapterPayload(raw: unknown, item: Series): Series {
  const payload = raw as { post?: { chapters?: unknown }; totalChapterCount?: number };
  if (!Array.isArray(payload?.post?.chapters) || (payload.totalChapterCount !== undefined && (!Number.isSafeInteger(payload.totalChapterCount) || payload.totalChapterCount < 0 || payload.post.chapters.length < payload.totalChapterCount))) throw new Error("Vortex returned an incomplete chapter list. Pull down to retry.");
  const chapterUrls: Record<string, string> = {}, chapterTitles: Record<string, string> = {};
  let updatedAt: string | undefined;
  const route = decodeURIComponent(new URL(item.url).pathname.split("/").filter(Boolean).at(-1)!);
  for (const chapter of payload.post.chapters) {
    if (!chapter || chapter.isLocked !== false || chapter.isAccessible === false || chapter.isPermanentlyLocked || chapter.isLockedByCoins || chapter.isShortLinkLocked) continue;
    if (chapter.mangaPost?.slug && chapter.mangaPost.slug !== route) continue;
    const id = String(chapter.number);
    if (!/^\d+(?:\.\d+)?$/.test(id) || typeof chapter.slug !== "string" || !/^chapter-[\w.-]+$/.test(chapter.slug)) continue;
    chapterUrls[id] = `${item.url.replace(/\/$/, "")}/${encodeURIComponent(chapter.slug)}`;
    chapterTitles[id] = `Chapter ${id}${chapter.title ? ` · ${plainText(String(chapter.title))}` : ""}`;
    const published = date(chapter.createdAt); if (published && (!updatedAt || published > updatedAt)) updatedAt = published;
  }
  const chapterIds = Object.keys(chapterUrls).sort(chapterSort);
  return { ...item, chapterUrls, chapterTitles, chapterIds, chapterCount: payload.totalChapterCount ?? payload.post.chapters.length, latestChapter: chapterIds.at(-1) || "", updatedAt: updatedAt || item.updatedAt, sourceDates: Boolean(updatedAt || item.updatedAt), detailsCached: true, syncedAt: new Date().toISOString() };
}
export function parseVortexDetails(html: string, item: Series): Series {
  const urls: Record<string, string> = {}, titles: Record<string, string> = {};
  const matches = hydrationRecords(html).filter(record => scalar(record.block, "slug").startsWith("chapter-") && numericField(record.block, "number"));
  let updatedAt: string | undefined;
  for (const match of matches) {
    const block = match.block;
    if (!/(?:^|,)\s*"?isLocked"?\s*:\s*(?:!1|false)(?:\s*[,}])/.test(block) || /(?:^|,)\s*"?(?:isLockedByCoins|isShortLinkLocked|isPermanentlyLocked)"?\s*:\s*(?:!0|true)/.test(block)) continue;
    const number = numericField(block, "number");
    const slug = scalar(block, "slug");
    if (!number || !/^\d+(?:\.\d+)?$/.test(number) || !/^chapter-[\w.-]+$/.test(slug)) continue;
    urls[number] = `${item.url}/${encodeURIComponent(slug)}`;
    const title = scalar(block, "title"); titles[number] = `Chapter ${number}${title ? ` · ${plainText(title)}` : ""}`;
    const published = date(scalar(block, "createdAt")); if (published && (!updatedAt || published > updatedAt)) updatedAt = published;
  }
  const ids = Object.keys(urls).sort(chapterSort);
  const own = parseVortexMetadata(html, item);
  if (matches.length && own.chapterCount > matches.length) throw new Error("Vortex returned only part of the chapter list. Pull down to retry.");
  if (!ids.length && own.chapterCount > 0 && !matches.length) throw new Error("Vortex chapter list could not be read. Pull down to retry.");
  return { ...own, detailsCached: true, chapterUrls: urls, chapterTitles: titles, chapterIds: ids, chapterCount: own.chapterCount || ids.length, latestChapter: own.latestChapter || ids.at(-1) || "", updatedAt: updatedAt || own.updatedAt, sourceDates: Boolean(updatedAt || own.updatedAt), syncedAt: new Date().toISOString() };
}
export function parseKakalotChapters(raw: unknown, seriesUrl: string, offset = 0) {
  const payload = raw as { success?: boolean; data?: { chapters?: unknown; pagination?: { total: number; offset: number; has_more: boolean } } };
  if (payload?.success !== true || !Array.isArray(payload.data?.chapters)) throw new Error("MangaKakalot chapter list is unavailable. Verify the source and retry.");
  const pagination = payload.data.pagination;
  const received = payload.data.chapters.length;
  if (pagination && (!Number.isSafeInteger(pagination.total) || pagination.total < 0 || pagination.offset !== offset || typeof pagination.has_more !== "boolean" || ((pagination.has_more || offset < pagination.total) && !received))) throw new Error("MangaKakalot chapter pagination is incomplete. Pull down to retry.");
  const more = pagination && (pagination.has_more || offset + received < pagination.total);
  const urls: Record<string, string> = {}, titles: Record<string, string> = {};
  let updatedAt: string | undefined;
  for (const chapter of payload.data.chapters) {
    if (!chapter || !/^\d+(?:\.\d+)?$/.test(String(chapter.chapter_num)) || !/^chapter-[\w.-]+$/.test(chapter.chapter_slug) || chapter.is_locked === true) continue;
    const id = String(chapter.chapter_num);
    urls[id] = `${seriesUrl}/${chapter.chapter_slug}`; titles[id] = typeof chapter.chapter_name === "string" ? chapter.chapter_name : `Chapter ${id}`;
    const published = date(chapter.updated_at); if (published && (!updatedAt || published > updatedAt)) updatedAt = published;
  }
  return { chapterUrls: urls, chapterTitles: titles, chapterIds: Object.keys(urls).sort(chapterSort), updatedAt, sourceDates: Boolean(updatedAt), nextOffset: more ? offset + received : undefined };
}
export function parseKakalotDetails(html: string, item: Series): Series {
  const data: Record<string, unknown>[] = [];
  for (const [, text] of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const parsed = JSON.parse(text.replace(/[\u0000-\u001f]/g, " ")); for (const value of [parsed, parsed.mainEntity, ...(parsed["@graph"] || [])]) if (value?.["@type"] === "Book") data.push(value); } catch { /* ignore unrelated invalid structured metadata */ }
  }
  const book = Object.assign({}, ...data) as { name?: string; description?: string; image?: string; genre?: string[]; numberOfPages?: string; aggregateRating?: { ratingValue?: string; bestRating?: string } };
  const content = section(html, "class", "manga-info-top");
  const canonical = metadata(html, "og:url");
  if (canonical && siteStoryUrl(canonical, "mangakakalot") !== item.url.replace(/\/$/, "")) throw new Error("MangaKakalot redirected to another page. Verify the source and retry.");
  const title = plainText(content.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || book?.name || "");
  if (!title) throw new Error("MangaKakalot story details are unavailable. Verify the source and retry.");
  const text = plainText(content);
  const summary = book?.description || plainText(section(html, "id", "contentBox").replace(/<h2\b[\s\S]*?<\/h2>/i, ""));
  const visibleRating = text.match(/rate\s*:\s*([\d.]+)\s*\/\s*([\d.]+)/i);
  const rating = Number(book?.aggregateRating?.ratingValue || visibleRating?.[1]), scale = Number(book?.aggregateRating?.bestRating || visibleRating?.[2] || 5);
  const genres = parseGenreLinks(content);
  return { ...item, title, genres: genres.length ? genres : Array.isArray(book.genre) ? book.genre.filter(value => typeof value === "string").map(plainText).filter(Boolean) : item.genres || [], summary: summary === "N/A" ? "" : plainText(summary), cover: safeUrl(book?.image || metadata(html, "og:image"), item.url) || item.cover, rating: rating > 0 && scale > 0 ? `${rating.toFixed(2)}/${scale}` : "", chapterCount: item.chapterListComplete && item.chapterIds ? item.chapterIds.length : Number(book?.numberOfPages) || item.chapterCount, status: text.match(/Status\s*:\s*(Ongoing|Completed|Hiatus|Dropped)/i)?.[1] || "Unknown", metadataSyncedAt: new Date().toISOString() };
}
export function parseReaderSiteImages(html: string, source: ReaderSite): string[] {
  const body = source === "vortex" ? html : section(html, "class", "container-chapter-reader");
  return [...new Set([...body.matchAll(/<img\b[^>]*>/gi)].filter(([tag]) => source !== "vortex" || attribute(tag, "data-reader-page-image") === "true").map(([tag]) => safeUrl(attribute(tag, "data-src") || attribute(tag, "src"), SITE_HOME[source])).filter(value => value && (source === "vortex" ? new URL(value).hostname === "storage.vortexscans.org" : /(?:^|\.)2xstorage\.com$/.test(new URL(value).hostname))))];
}
