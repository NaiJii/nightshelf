import { fetch } from "expo/fetch";
import { Directory, File } from "expo-file-system";
import { chapterSort, kindOf, sourceOf, mergeDiscovery, parseApiSeries, parseChapters, parseDiscovery, parseNovelChapters, parseNovelText, parsePageImages, parseSeries, selectChapters } from "./parser";
import type { ContentMode, Period, Series, SortOrder, SourceId } from "./parser";
import { chapterDirectory, chapterIntact, COVERS, initializeStorage, loadCatalog, loadPreferences, savedStories, mergeCatalog, loadDownloads, saveDownloads, novelChapter } from "./storage";
import { parseWebtoonCards, parseWebtoonDetails, parseWebtoonEpisodes, parseWebtoonImages, webtoonLanguage, webtoonSearchHasNext } from "./webtoon";
import { NetworkPaused } from "./network";
import { throwIfAborted, withAbort } from "./request-control";
import { directoryHasMore, directoryUrl, imageReferer, parseKakalotCards, parseKakalotChapters, parseKakalotDetails, parseReaderSiteImages, parseVortexCards, parseVortexDetails, parseVortexMetadata } from "./reader-sites";
import type { ReaderSite } from "./reader-sites";
import { isVerificationHost, requireSourceVerification, SOURCE_AGENT, verificationCookies, verificationUserAgent } from "./source-session";
import { backgroundTransfers, waitForTransfer } from "./background-downloads";
import { recordSourceHealth, sourceForRequest } from "./library-tools";
import type { NativeChapter } from "./background-downloads";
import NetInfo from "@react-native-community/netinfo";

const HOME = "https://asurascans.com/";
const HEADERS = { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36" };
type Guard = () => Promise<void>;

async function request<T>(url: string, guard: Guard, read: (response: Awaited<ReturnType<typeof fetch>>) => Promise<T>, referer?: string, signal?: AbortSignal, timeout = 30_000): Promise<T> {
  throwIfAborted(signal);
  await withAbort(guard, signal);
  throwIfAborted(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeout);
  try {
    // WEBTOON redirects mobile agents to a different HTML layout; use its public desktop pages consistently.
    const cookie = await withAbort(() => verificationCookies(url), controller.signal);
    const agent = isVerificationHost(url) ? await withAbort(verificationUserAgent, controller.signal) : ["www.webtoons.com", "vortexscans.org", "www.vortexscans.org"].includes(new URL(url).hostname) ? SOURCE_AGENT : undefined;
    const headers = { ...HEADERS, ...(agent ? { "User-Agent": agent } : {}), ...(referer ? { Referer: imageReferer(url, referer) } : {}), ...(cookie ? { Cookie: cookie } : {}) };
    const response = await withAbort(() => fetch(url, { signal: controller.signal, headers }), controller.signal);
    if (!response.ok) {
      const source = sourceForRequest(url);
      if (source) recordSourceHealth(source, response.status === 403 && isVerificationHost(url) ? "verification" : "unavailable", response.status === 403 && isVerificationHost(url) ? "Browser verification required" : `Website returned HTTP ${response.status}`);
      throw response.status === 403 && isVerificationHost(url) ? requireSourceVerification(url) : new Error(`Request failed (${response.status})`);
    }
    const result = await withAbort(() => read(response), controller.signal);
    throwIfAborted(signal);
    const source = sourceForRequest(url); if (source) recordSourceHealth(source, "ok", "Source responded successfully");
    return result;
  } catch (error) { if (!signal?.aborted && (timedOut || !(error instanceof Error) || !/Request failed|verification/i.test(error.message))) { const source = sourceForRequest(url); if (source) recordSourceHealth(source, "network", timedOut ? "Connection timed out" : "Connection failed"); } if (timedOut && !signal?.aborted) throw new Error("Request timed out. Retry when the connection is stable."); throw error; }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
async function getText(url: string, guard: Guard, referer?: string, signal?: AbortSignal, timeout = 30_000): Promise<string> {
  const text = await request(url, guard, response => response.text(), referer, signal, timeout);
  if (isVerificationHost(url) && /<title\b[^>]*>\s*(?:Just a moment|Attention Required)/i.test(text)) { recordSourceHealth("mangakakalot", "verification", "Browser verification required"); throw requireSourceVerification(url); }
  return text;
}
export async function verifySourceSession(url: string, guard: Guard, signal?: AbortSignal): Promise<void> {
  if (!isVerificationHost(url)) throw new Error("Unsupported source verification URL.");
  const html = await getText(url, guard, undefined, signal, 12_000);
  const ready = parseKakalotCards(html).length > 0 || /class=["'][^"']*\b(?:manga-info-top|container-chapter-reader)\b/i.test(html);
  if (!ready) throw new Error("The app still cannot read this source. Reload the verification page, complete its check, then retry.");
}
function extension(url: string): string {
  return new URL(url).pathname.match(/\.(avif|gif|jpe?g|png|webp)$/i)?.[0].toLowerCase() ?? ".webp";
}
function imageHeader(bytes: Uint8Array): boolean {
  const text = String.fromCharCode(...bytes.slice(0, 12));
  return (bytes[0] === 0xff && bytes[1] === 0xd8) || text.startsWith("\x89PNG\r\n\x1a\n") || /^GIF8[79]a/.test(text) || (text.startsWith("RIFF") && text.slice(8) === "WEBP") || /^....ftyp(?:avif|avis|mif1|msf1)/.test(text);
}
async function cacheCover(series: Series, guard: Guard, signal?: AbortSignal): Promise<string | undefined> {
  if (!series.cover) return undefined;
  initializeStorage();
  const file = new File(COVERS, `${series.slug}${extension(series.cover)}`);
  if (file.exists) {
    const handle = file.open();
    let valid = false;
    try { valid = imageHeader(handle.readBytes(Math.min(12, file.size))); } finally { handle.close(); }
    if (!valid) file.delete();
  }
  if (!file.exists) {
    const bytes = await request(series.cover, guard, async response => {
      if (!response.headers.get("content-type")?.startsWith("image/")) throw new Error("Cover request did not return an image.");
      const bytes = await response.bytes();
      if (!imageHeader(bytes)) throw new Error("Cover image is invalid.");
      return bytes;
    }, series.url, signal);
    throwIfAborted(signal);
    const temporary = new File(COVERS, `${file.name}.${Date.now()}-${Math.random().toString(36).slice(2)}.part`);
    temporary.write(bytes);
    if (file.exists) temporary.delete(); else temporary.move(file);
  }
  return file.uri;
}
const API = "https://api.asurascans.com/api";
async function getJson(url: string, guard: Guard, signal?: AbortSignal): Promise<unknown> { const text = await getText(url, guard, undefined, signal); try { return JSON.parse(text); } catch { const source = sourceForRequest(url); if (source) recordSourceHealth(source, "parser", "Website returned an unexpected API response"); throw new Error("Source returned invalid JSON; its parser may need updating."); } }
function siteSlug(item: Series): string { return new URL(item.url).pathname.split("/").filter(Boolean).at(-1)!; }

export async function refreshSeries(item: Series, guard: Guard, signal?: AbortSignal, loadChapters = true): Promise<Series> {
  const source = sourceOf(item);
  if (source === "vortex" || source === "mangakakalot") {
    const html = await getText(item.url, guard, undefined, signal);
    let fresh = source === "vortex" ? (loadChapters ? parseVortexDetails(html, item) : parseVortexMetadata(html, item)) : parseKakalotDetails(html, item);
    if (source === "mangakakalot" && loadChapters) {
      const chapters = parseKakalotChapters(await getJson(`https://www.mangakakalot.gg/api/manga/${encodeURIComponent(siteSlug(item))}/chapters`, guard, signal), item.url);
      fresh = { ...fresh, ...chapters, chapterCount: chapters.chapterIds.length, latestChapter: chapters.chapterIds.at(-1) || "" };
    }
    try { fresh.localCover = await cacheCover(fresh, guard, signal); } catch (error) { throwIfAborted(signal); if (error instanceof NetworkPaused) throw error; }
    return { ...fresh, detailsCached: loadChapters || item.detailsCached };
  }
  if (sourceOf(item) === "webtoon") {
    const html = await getText(item.url, guard, undefined, signal);
    const fresh = parseWebtoonDetails(html, item);
    if (!loadChapters) return fresh;
    const known = new Set(item.chapterIds || []);
    const urls = { ...item.chapterUrls }, titles = { ...item.chapterTitles };
    let page: string | undefined = item.url, text = html, count = 0;
    const visited = new Set<string>();
    while (page) {
      if (visited.has(page) || count++ >= 2000) throw new Error("WEBTOON episode pagination could not finish. Pull down to retry.");
      visited.add(page);
      const parsed = parseWebtoonEpisodes(text, page);
      Object.assign(urls, parsed.urls); Object.assign(titles, parsed.titles);
      if (page === item.url) { fresh.updatedAt = parsed.updatedAt; fresh.sourceDates = Boolean(parsed.updatedAt); }
      // Once a cached episode is reached, older pages are already on this phone.
      if (item.detailsCached && item.chapterUrls && parsed.ids.some(id => known.has(id))) break;
      page = parsed.next;
      if (page) { await new Promise(resolve => setTimeout(resolve, 100)); text = await getText(page, guard, item.url, signal); }
    }
    const ids = Object.keys(urls).sort(chapterSort);
    fresh.localCover = await cacheCover(fresh, guard, signal).catch(error => { throwIfAborted(signal); if (error instanceof NetworkPaused) throw error; return item.localCover; });
    return { ...fresh, detailsCached: true, chapterUrls: urls, chapterTitles: titles, chapterIds: ids, chapterCount: Math.max(fresh.chapterCount, ids.length), latestChapter: fresh.latestChapter || ids.at(-1) || "", syncedAt: new Date().toISOString() };
  }
  let fresh: Series;
  if (kindOf(item) === "novel") {
    const result = await getJson(`${API}/novel-series/${encodeURIComponent(siteSlug(item))}`, guard, signal) as { series?: unknown; chapters?: unknown };
    const parsed = parseApiSeries(result.series, "novel");
    if (!parsed) throw new Error("Novel details are unavailable.");
    const chapters = parseNovelChapters(result.chapters, item.url);
    fresh = { ...parsed, chapterIds: chapters.filter(chapter => !chapter.locked).map(chapter => chapter.id), chapterCount: chapters.length || parsed.chapterCount, latestChapter: chapters.at(-1)?.id || parsed.latestChapter };
  } else {
    const html = await getText(item.url, guard, undefined, signal);
    fresh = { ...parseSeries(html, item.url), chapterIds: parseChapters(html, item.url).map(chapter => chapter.id) };
    if (!fresh.chapterCount || !fresh.cover) throw new Error("Story details are unavailable.");
  }
  if (!loadChapters) { delete fresh.chapterIds; delete fresh.chapterUrls; delete fresh.chapterTitles; }
  return { ...item, ...fresh, summary: fresh.summary || item.summary, detailsCached: loadChapters || item.detailsCached, slug: item.slug, popularRanks: item.popularRanks, rank: item.rank, localCover: item.localCover, metadataSyncedAt: new Date().toISOString(), syncedAt: loadChapters ? new Date().toISOString() : item.syncedAt };
}

async function enrichDiscovery(items: Series[], guard: Guard, signal?: AbortSignal, changed = () => {}) {
  let next = 0;
  // Three metadata requests at a time; chapter APIs/pagination are reserved for opening or syncing a saved story.
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (next < items.length) {
      const index = next++, item = items[index];
      throwIfAborted(signal);
      let fresh = item;
      try {
        if (!item.metadataSyncedAt || Date.now() - Date.parse(item.metadataSyncedAt) > 6 * 3600_000) fresh = await refreshSeries(item, guard, signal, false);
      } catch (error) { throwIfAborted(signal); if (error instanceof NetworkPaused) throw error; }
      try { fresh.localCover = await cacheCover(fresh, guard, signal); } catch (error) { throwIfAborted(signal); if (error instanceof NetworkPaused) throw error; }
      throwIfAborted(signal);
      items[index] = fresh; mergeCatalog([fresh]); changed();
    }
  }));
}

export async function syncCatalog(onProgress: (message: string) => void, guard: Guard, force = false, onWarning: (message: string) => void = () => {}): Promise<Series[]> {
  const existing = loadCatalog();
  const saved = savedStories();
  const items = new Map(existing.map(item => [item.slug, { ...item }]));
  let successful = 0;
  let discoveryError: unknown;
  const preferences = loadPreferences();
  if (preferences.source === "vortex" || preferences.source === "mangakakalot") {
    onProgress("Refreshing source discoveries");
    try {
      const page = await browseReaderSite(preferences.source, { mode: "comics", sort: "smart", period: "week", query: "", refresh: force }, FIRST_PAGE, guard);
      for (const item of loadCatalog()) items.set(item.slug, item);
      if (page.ids.length) successful++;
    } catch (error) { if (error instanceof NetworkPaused) throw error; discoveryError = error; onWarning(error instanceof Error ? error.message : "Source discovery could not refresh."); }
  }
  if (preferences.source === "webtoon") {
    onProgress("Refreshing WEBTOON discoveries");
    try {
      const page = await browseWebtoon({ source: "webtoon", language: preferences.webtoonLanguage, collection: preferences.webtoonCollection, mode: "comics", sort: "smart", period: "week", query: "", refresh: force }, FIRST_PAGE, guard);
      for (const item of loadCatalog()) items.set(item.slug, item);
      if (page.ids.length) successful++;
    } catch (error) { if (error instanceof NetworkPaused) throw error; discoveryError = error; onWarning(error instanceof Error ? error.message : "WEBTOON discovery could not refresh."); }
  }
  for (const kind of (!preferences.source || preferences.source === "asura" ? ["comic", "novel"] : []) as ("comic" | "novel")[]) {
    for (const period of ["week", "month", "all"] as Period[]) {
      onProgress(`Refreshing ${kind} rankings`);
      try {
        const url = kind === "comic" ? `${API}/trending/${period}?limit=10` : `${API}/novel-series?limit=10&sort=popular&period=${period}`;
        const result = await getJson(url, guard) as { data?: unknown };
        if (!Array.isArray(result.data) || !result.data.length) throw new Error("Rankings unavailable.");
        for (const [key, value] of items) if (sourceOf(value) === "asura" && kindOf(value) === kind) items.set(key, { ...value, rank: period === "week" ? undefined : value.rank, popularRanks: { ...value.popularRanks, [period]: undefined } });
        result.data.forEach((raw, index) => {
          const fresh = parseApiSeries(raw, kind);
          if (!fresh) return;
          const previous = [...items.values()].find(item => sourceOf(item) === "asura" && kindOf(item) === kind && (item.url === fresh.url || item.title.toLowerCase() === fresh.title.toLowerCase()));
          const item = { ...previous, ...fresh, slug: previous?.slug || fresh.slug, summary: previous?.detailsCached || previous?.metadataSyncedAt ? previous.summary || fresh.summary : fresh.summary || previous?.summary || "", localCover: previous?.localCover, syncedAt: previous?.syncedAt,
            rank: period === "week" ? index + 1 : previous?.rank, popularRanks: { ...previous?.popularRanks, [period]: index + 1 } };
          items.set(item.slug, item);
        });
        successful++;
      } catch (error) { if (error instanceof NetworkPaused) throw error; }
    }
  }
  const urls = existing.filter(item => item.localChapters?.length || saved[item.slug]?.bookmarked).map(item => item.url);
  urls.push(...[...items.values()].filter(item => sourceOf(item) === "asura" && (!preferences.source || preferences.source === "asura") && Object.values(item.popularRanks || {}).some(Boolean)).map(item => item.url));
  for (const home of !preferences.source || preferences.source === "asura" ? [HOME, `${HOME}novels`] : []) {
    try { urls.push(...parseDiscovery(await getText(home, guard))); } catch (error) { if (error instanceof NetworkPaused) throw error; }
  }
  let newDetails = 0;
  for (const url of [...new Set(urls)]) {
    const old = [...items.values()].find(item => item.url === url);
    const owned = old && (old.localChapters?.length || saved[old.slug]?.bookmarked);
    const priority = owned || (old && Object.values(old.popularRanks || {}).some(Boolean));
    if (old?.summary && (old.detailsCached || old.metadataSyncedAt) && !force && !owned && Date.now() - Date.parse(old.metadataSyncedAt || old.syncedAt || "") < 6 * 3600_000) continue;
    if (!priority && newDetails >= 12) continue;
    try {
      onProgress("Refreshing story details");
      let item: Series;
      if (old) item = await refreshSeries(old, guard, undefined, Boolean(owned || old.detailsCached));
      else if (url.includes("/novels/")) {
        const stub = { url } as Series;
        const result = await getJson(`${API}/novel-series/${encodeURIComponent(siteSlug(stub))}`, guard) as { series?: unknown; chapters?: unknown };
        const parsed = parseApiSeries(result.series, "novel");
        if (!parsed) continue;
        item = { ...parsed, metadataSyncedAt: new Date().toISOString() };
      } else {
        item = parseSeries(await getText(url, guard), url);
        if (!item.chapterCount || !item.cover) continue;
        const previous = [...items.values()].find(value => sourceOf(value) === "asura" && kindOf(value) === "comic" && value.title.toLowerCase() === item.title.toLowerCase());
        delete item.chapterIds;
        item = { ...previous, ...item, slug: previous?.slug || item.slug, metadataSyncedAt: new Date().toISOString() };
      }
      items.set(item.slug, item);
      if (!priority) newDetails++;
      successful++;
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) { if (error instanceof NetworkPaused) { mergeCatalog([...items.values()], true); throw error; } }
  }
  for (const [slug, item] of items) {
    try { items.set(slug, { ...item, localCover: await cacheCover(item, guard) }); }
    catch (error) { if (error instanceof NetworkPaused) { mergeCatalog([...items.values()], true); throw error; } }
  }
  if (!successful) throw discoveryError || new Error("Could not refresh stories. Pull down to retry.");
  mergeCatalog([...items.values()], true);
  return loadCatalog();
}
export async function searchCatalog(query: string, mode: ContentMode, guard: Guard): Promise<string[]> {
  if (query.trim().length < 2) return [];
  const found: Series[] = [];
  for (const kind of ["comic", "novel"] as const) {
    if (mode !== "all" && kind !== (mode === "novels" ? "novel" : "comic")) continue;
    const url = kind === "comic" ? `${API}/search?q=${encodeURIComponent(query.trim())}` : `${API}/novel-series?search=${encodeURIComponent(query.trim())}&limit=30`;
    const result = await getJson(url, guard) as { data?: unknown };
    if (!Array.isArray(result.data)) throw new Error("Search is temporarily unavailable.");
    for (const raw of result.data.slice(0, 30)) { const item = parseApiSeries(raw, kind); if (item) found.push(item); }
  }
  const latest = loadCatalog();
  const items = new Map(latest.map(item => [item.slug, item]));
  const ids: string[] = [];
  for (const fresh of found) {
    const previous = [...items.values()].find(item => sourceOf(item) === "asura" && kindOf(item) === kindOf(fresh) && (item.url === fresh.url || item.title.toLowerCase() === fresh.title.toLowerCase()));
    const item = { ...previous, ...fresh, slug: previous?.slug || fresh.slug, summary: previous?.detailsCached || previous?.metadataSyncedAt ? previous.summary || fresh.summary : fresh.summary || previous?.summary || "", cover: fresh.cover || previous?.cover || "", localCover: previous?.localCover, rank: previous?.rank, popularRanks: previous?.popularRanks, syncedAt: previous?.syncedAt };
    try { item.localCover = await cacheCover(item, guard); } catch (error) { if (error instanceof NetworkPaused) throw error; }
    items.set(item.slug, item);
    ids.push(item.slug);
  }
  mergeCatalog(ids.map(id => items.get(id)!));
  return ids;
}

export type BrowseOptions = { source?: SourceId; language?: string; collection?: "originals" | "canvas"; mode: ContentMode; sort: SortOrder; period: Period; query: string; refresh?: boolean };
export type BrowseCursor = { comic: number; novel: number; comicDone: boolean; novelDone: boolean; webtoonPage?: number; webtoonOffset?: number; sitePage?: number; siteOffset?: number; siteLoaded?: number };
export const FIRST_PAGE: BrowseCursor = { comic: 0, novel: 0, comicDone: false, novelDone: false };
const rankingCache = new Map<Period, { at: number; data: unknown[] }>();
const webtoonCache = new Map<string, { at: number; items: Series[]; hasNext: boolean }>();
const siteCache = new Map<string, { at: number; items: Series[]; hasNext: boolean }>();

async function browseReaderSite(source: ReaderSite, options: BrowseOptions, cursor: BrowseCursor, guard: Guard, signal?: AbortSignal, changed = () => {}) {
  const page = cursor.sitePage || 1, offset = cursor.siteOffset || 0;
  const popular = !options.query && (options.sort === "smart" || options.sort === "trending");
  const url = directoryUrl(source, options.sort, options.query, page);
  let entry = siteCache.get(url);
  if (!entry || Date.now() - entry.at > 10 * 60_000 || (options.refresh && page === 1 && offset === 0)) {
    const html = await getText(url, guard, undefined, signal);
    const items = source === "vortex" ? parseVortexCards(html, popular) : parseKakalotCards(html);
    if (!items.length && !options.query && !(source === "vortex" && /initialPosts:/.test(html))) { recordSourceHealth(source, "parser", "Website opened, but no catalog entries were recognized. Source parser may need updating."); throw new Error(`${source === "vortex" ? "Vortex" : "MangaKakalot"} discovery is unavailable. Pull down to retry.`); }
    entry = { at: Date.now(), items, hasNext: directoryHasMore(html, source, url, items.length, popular) };
    siteCache.set(url, entry); if (siteCache.size > 30) siteCache.delete(siteCache.keys().next().value!);
  }
  const batch = entry.items.slice(offset, offset + 20);
  const stored = loadCatalog(), updates: Series[] = [], ids: string[] = [];
  if (popular && page === 1 && offset === 0) for (const item of stored) if (sourceOf(item) === source) updates.push({ ...item, sourceRank: undefined });
  for (const [index, fresh] of batch.entries()) {
    const previous = stored.find(item => item.slug === fresh.slug || (sourceOf(item) === source && item.url === fresh.url));
    const item = { ...mergeDiscovery(fresh, previous), sourceRank: popular ? (cursor.siteLoaded || 0) + index + 1 : previous?.sourceRank };
    updates.push(item); ids.push(item.slug);
  }
  throwIfAborted(signal); mergeCatalog(updates); changed();
  if (batch.length) await enrichDiscovery(updates.slice(-batch.length), guard, signal, changed);
  const more = offset + batch.length < entry.items.length;
  return { ids, cursor: { ...cursor, siteOffset: more ? offset + batch.length : 0, sitePage: more ? page : page + 1, siteLoaded: (cursor.siteLoaded || 0) + batch.length }, hasMore: more || entry.hasNext };
}

async function browseWebtoon(options: BrowseOptions, cursor: BrowseCursor, guard: Guard, signal?: AbortSignal, changed = () => {}) {
  const language = webtoonLanguage(options.language);
  const offset = cursor.webtoonOffset || 0;
  const page = cursor.webtoonPage || 1;
  const url = options.query
    ? `https://www.webtoons.com/${language}/search/${options.collection === "canvas" ? "canvas" : "originals"}?keyword=${encodeURIComponent(options.query)}&page=${page}`
    : `https://www.webtoons.com/${language}/ranking/${options.collection === "canvas" ? "canvas" : options.sort === "trending" ? "trending" : "popular"}`;
  let entry = webtoonCache.get(url);
  if (!entry || Date.now() - entry.at > 10 * 60_000 || (options.refresh && offset === 0 && page === 1)) {
    const html = await getText(url, guard, undefined, signal);
    const items = parseWebtoonCards(html, language);
    if (!items.length && !options.query) throw new Error("WEBTOON discovery is unavailable. Pull down to retry.");
    entry = { at: Date.now(), items, hasNext: Boolean(options.query && webtoonSearchHasNext(html, url)) }; webtoonCache.set(url, entry);
    if (webtoonCache.size > 30) webtoonCache.delete(webtoonCache.keys().next().value!);
  }
  const selected = entry.items.slice(offset, offset + 20);
  const updates: Series[] = [];
  const popular = !options.query && (options.collection === "canvas" || options.sort !== "trending");
  if (popular && offset === 0) for (const item of loadCatalog()) if (sourceOf(item) === "webtoon" && item.language === language && item.url.includes("/canvas/") === (options.collection === "canvas")) updates.push({ ...item, sourceRank: undefined });
  const ids: string[] = [];
  for (const [index, fresh] of selected.entries()) {
    const previous = loadCatalog().find(item => item.slug === fresh.slug);
    const item = { ...mergeDiscovery(fresh, previous), sourceRank: popular ? offset + index + 1 : previous?.sourceRank };
    updates.push(item); ids.push(item.slug);
  }
  throwIfAborted(signal); mergeCatalog(updates); changed();
  if (selected.length) await enrichDiscovery(updates.slice(-selected.length), guard, signal, changed);
  const more = offset + selected.length < entry.items.length;
  // Search pages use real source pagination; rankings are finite and sliced locally.
  const next = { ...cursor, webtoonOffset: more ? offset + selected.length : 0, webtoonPage: more ? page : page + 1 };
  return { ids, cursor: next, hasMore: more || entry.hasNext };
}

export async function browseCatalog(options: BrowseOptions, cursor: BrowseCursor, guard: Guard, signal?: AbortSignal, changed = () => {}): Promise<{ ids: string[]; cursor: BrowseCursor; hasMore: boolean }> {
  if (options.source === "vortex" || options.source === "mangakakalot") return browseReaderSite(options.source, options, cursor, guard, signal, changed);
  if (options.source === "webtoon") return browseWebtoon(options, cursor, guard, signal, changed);
  const next = { ...cursor };
  const updates: Series[] = [];
  const existing = loadCatalog();
  for (const kind of ["comic", "novel"] as const) {
    const done = kind === "comic" ? "comicDone" : "novelDone";
    if (next[done]) continue;
    if (options.mode !== "all" && kind !== (options.mode === "novels" ? "novel" : "comic")) { next[done] = true; continue; }
    const offset = next[kind];
    let data: unknown[], more: boolean;
    if (kind === "comic" && options.sort === "trending" && !options.query) {
      // The ranking endpoint ignores offsets. Fetch its top 100 once, then page that ranking locally.
      let ranking = rankingCache.get(options.period);
      if (!ranking || (options.refresh && offset === 0) || Date.now() - ranking.at > 10 * 60_000) {
        const result = await getJson(`${API}/trending/${options.period}?limit=100`, guard, signal) as { data?: unknown };
        if (!Array.isArray(result.data)) throw new Error("Popularity rankings are unavailable.");
        ranking = { at: Date.now(), data: result.data }; rankingCache.set(options.period, ranking);
      }
      data = ranking.data.slice(offset, offset + 20); more = offset + data.length < ranking.data.length;
    } else {
      const sorts = { smart: "popular", trending: "popular", rating: "rating", updated: "latest", title: "title", chapters: "latest" };
      const params = new URLSearchParams({ limit: "20", offset: String(offset), sort: sorts[options.sort], order: options.sort === "title" ? "asc" : "desc" });
      if (options.query) params.set("search", options.query);
      if (options.sort === "trending") params.set("period", options.period);
      const result = await getJson(`${API}/${kind === "comic" ? "series" : "novel-series"}?${params}`, guard, signal) as { data?: unknown; meta?: { total?: number; has_more?: boolean } };
      if (!Array.isArray(result.data)) throw new Error("The next page is unavailable. Tap to retry.");
      data = result.data;
      more = result.meta?.has_more ?? (typeof result.meta?.total === "number" ? offset + data.length < result.meta.total : data.length === 20);
    }
    next[kind] += data.length; next[done] = !data.length || !more;
    for (const [index, raw] of data.entries()) {
      const fresh = parseApiSeries(raw, kind); if (!fresh) continue;
      const previous = existing.find(item => sourceOf(item) === "asura" && kindOf(item) === kind && (item.url === fresh.url || item.title.toLowerCase() === fresh.title.toLowerCase()));
      const item = { ...previous, ...fresh, slug: previous?.slug || fresh.slug, summary: previous?.detailsCached || previous?.metadataSyncedAt ? previous.summary || fresh.summary : fresh.summary || previous?.summary || "", localCover: previous?.localCover, syncedAt: previous?.syncedAt, rank: previous?.rank, popularRanks: previous?.popularRanks };
      if (options.sort === "trending" && !options.query) { item.popularRanks = { ...item.popularRanks, [options.period]: offset + index + 1 }; if (options.period === "week") item.rank = offset + index + 1; }
      try { item.localCover = await cacheCover(item, guard, signal); }
      catch (error) { throwIfAborted(signal); if (error instanceof NetworkPaused) throw error; }
      updates.push(item);
    }
  }
  throwIfAborted(signal); mergeCatalog(updates, options.sort === "trending" && !options.query);
  changed();
  await enrichDiscovery(updates.filter(item => !item.summary || !item.cover || !item.rating), guard, signal, changed);
  return { ids: updates.map(item => item.slug), cursor: next, hasMore: !next.comicDone || !next.novelDone };
}

export async function downloadChapters(series: Series, selector: string, onProgress: (message: string, fraction: number) => void, guard: Guard, signal?: AbortSignal, planned?: string[], onPlan: (chapters: string[]) => void = () => {}, onChapterSaved: () => void = () => {}, automaticBookmark = false, detachAutomatic = false): Promise<void> {
  onProgress("Saving story details…", 0);
  const fresh = await refreshSeries(series, guard, signal);
  throwIfAborted(signal);
  mergeCatalog([fresh]);
  const novel = kindOf(series) === "novel";
  const webtoon = sourceOf(series) === "webtoon";
  const readerSite = sourceOf(series) === "vortex" || sourceOf(series) === "mangakakalot";
  const available = webtoon || readerSite ? (fresh.chapterIds || []).map(id => ({ id, url: fresh.chapterUrls![id] })) : novel
    ? parseNovelChapters((await getJson(`${API}/novel-series/${encodeURIComponent(siteSlug(series))}`, guard, signal) as { chapters?: unknown }).chapters, series.url).filter(chapter => !chapter.locked)
    : parseChapters(await getText(series.url, guard, undefined, signal), series.url);
  const chapters = planned ? available.filter(chapter => planned.includes(chapter.id)) : selectChapters(available, selector);
  if (planned && chapters.length !== planned.length) throw new Error("Some queued chapters are no longer available. Cancel this job and choose chapters again.");
  if (!chapters.length) throw new Error("No chapters match that selection");
  onPlan(chapters.map(chapter => chapter.id));
  if (backgroundTransfers) {
    const batch: NativeChapter[] = [];
    for (const [index, chapter] of chapters.entries()) {
      throwIfAborted(signal);
      onProgress(`Preparing chapter ${index + 1}/${chapters.length}…`, 0);
      const folder = chapterDirectory(series.slug, chapter.id); folder.create({ intermediates: true, idempotent: true });
      const marker = new File(folder, ".complete");
      if (novel) {
        const data = chapterIntact(series.slug, chapter.id) ? novelChapter(series.slug, chapter.id)! : parseNovelText(await getJson(`${API}/novel-series/${encodeURIComponent(siteSlug(series))}/chapter/${chapter.id}`, guard, signal));
        batch.push({ id: chapter.id, marker: marker.uri, files: [], text: JSON.stringify(data), textTarget: new File(folder, "text.json").uri });
      } else {
        const html = await getText(chapter.url, guard, series.url, signal);
        const images = webtoon ? parseWebtoonImages(html) : readerSite ? parseReaderSiteImages(html, sourceOf(series) as ReaderSite) : parsePageImages(html, chapter.url);
        if (!images.length) throw new Error(`No public images found for chapter ${chapter.id}`);
        let previous: { urls?: string[]; hashes?: string[] } = {}; try { previous = JSON.parse(marker.textSync()); } catch { /* first download */ }
        batch.push({ id: chapter.id, marker: marker.uri, files: images.map((url, page) => ({ url, target: new File(folder, `${String(page + 1).padStart(3, "0")}${extension(url)}`).uri, original: new File(folder, `.original-${page + 1}`).uri, referer: imageReferer(url, chapter.url), agent: webtoon || readerSite ? SOURCE_AGENT : HEADERS["User-Agent"], hash: previous.urls?.[page] === url ? previous.hashes?.[page] : undefined })) });
      }
    }
    await guard(); throwIfAborted(signal);
    const network = await NetInfo.fetch();
    const settings = loadPreferences();
    const meteredNow = network.type !== "wifi" || Boolean(network.details?.isConnectionExpensive);
    const allowMetered = !automaticBookmark && settings.mobileData !== "never" && (settings.mobileData === "allow" || meteredNow);
    await backgroundTransfers.enqueue(JSON.stringify({ id: series.slug, title: series.title, chapters: batch, allowMetered, automatic: automaticBookmark, limitBytes: automaticBookmark ? settings.autoDownloadLimitMB * 1024 ** 2 : 0 }));
    if (detachAutomatic) {
      const jobs = loadDownloads();
      if (automaticBookmark && !jobs.some(job => job.series.slug === series.slug)) saveDownloads([...jobs, { series: fresh, selection: chapters.map(chapter => chapter.id).join(","), chapters: chapters.map(chapter => chapter.id), native: true, autoBookmark: true, status: "waiting", progress: 0, message: "Android queued new releases · Wi-Fi only" }]);
      return;
    }
    await waitForTransfer(series.slug, onProgress, onChapterSaved, signal);
    return;
  }
  for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
    throwIfAborted(signal);
    const chapter = chapters[chapterIndex];
    if (novel) {
      const folder = chapterDirectory(series.slug, chapter.id);
      folder.create({ idempotent: true, intermediates: true });
      const textFile = new File(folder, "text.json");
      if (!chapterIntact(series.slug, chapter.id)) {
        const marker = new File(folder, ".complete"); if (marker.exists) marker.delete();
        const data = parseNovelText(await getJson(`${API}/novel-series/${encodeURIComponent(siteSlug(series))}/chapter/${chapter.id}`, guard, signal));
        throwIfAborted(signal);
        const temporary = new File(folder, "text.json.part");
        temporary.write(JSON.stringify(data));
        if (textFile.exists) textFile.delete();
        temporary.move(textFile);
        new File(folder, ".complete").write(JSON.stringify({ kind: "novel", hash: textFile.md5 }));
      }
      onProgress(`Chapter ${chapter.id} saved`, (chapterIndex + 1) / chapters.length);
      onChapterSaved();
      await new Promise(resolve => setTimeout(resolve, 100));
      continue;
    }
    const html = await getText(chapter.url, guard, series.url, signal);
    const images = webtoon ? parseWebtoonImages(html) : readerSite ? parseReaderSiteImages(html, sourceOf(series) as ReaderSite) : parsePageImages(html, chapter.url);
    if (!images.length) throw new Error(webtoon ? `Episode ${chapter.id} is unavailable on the public website. It may require WEBTOON’s app or access permission.` : `No images found for chapter ${chapter.id}`);
    const folder: Directory = chapterDirectory(series.slug, chapter.id);
    folder.create({ idempotent: true, intermediates: true });
    const marker = new File(folder, ".complete");
    let current = false; let savedHashes: (string | undefined)[] = [];
    try { const saved = JSON.parse(marker.textSync()); savedHashes = saved.hashes || []; current = saved.quality === 2 && JSON.stringify(saved.urls) === JSON.stringify(images); } catch { /* legacy chapter */ }
    if (marker.exists && (!current || !chapterIntact(series.slug, chapter.id))) marker.delete();
    for (let page = 0; page < images.length; page++) {
      throwIfAborted(signal);
      const target = new File(folder, `${String(page + 1).padStart(3, "0")}${extension(images[page])}`);
      const pageMarker = new File(folder, `.original-${page + 1}`);
      let original = current;
      try { original ||= pageMarker.textSync() === images[page]; } catch { /* page has not finished downloading */ }
      if (!original || !target.exists || !target.size || (savedHashes[page] && target.md5 !== savedHashes[page])) {
        const bytes = await request(images[page], guard, async response => {
          if (!response.headers.get("content-type")?.startsWith("image/")) throw new Error(`Page ${page + 1} failed`);
          return response.bytes();
        }, chapter.url, signal, 60_000);
        throwIfAborted(signal);
        const temporary = new File(folder, `${target.name}.part`);
        temporary.write(bytes);
        if (target.exists) target.delete();
        temporary.move(target);
        pageMarker.write(images[page]);
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      onProgress(`Chapter ${chapter.id} · ${page + 1}/${images.length} pages`, (chapterIndex + (page + 1) / images.length) / chapters.length);
    }
    throwIfAborted(signal); marker.write(JSON.stringify({ quality: 2, urls: images, hashes: images.map((url, page) => new File(folder, `${String(page + 1).padStart(3, "0")}${extension(url)}`).md5) }));
    onChapterSaved();
  }
  throwIfAborted(signal);
}
