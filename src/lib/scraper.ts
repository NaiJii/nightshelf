import { fetch } from "expo/fetch";
import { Directory, File } from "expo-file-system";
import { kindOf, sourceOf, selectChapters } from "./parser";
import type { Chapter, ContentMode, Series, SourceId } from "./parser";
import { getProvider, storyProvider } from "./providers/registry";
import { MOBILE_AGENT } from "./providers/assets";
import { ProviderError } from "./provider-errors";
import { providerInfo, sourceIdForUrl } from "./provider-info";
import type { BrowseCursor, BrowseOptions, RequestContext } from "./providers/types";
import { catalogMetadata, chapterDirectory, chapterIntact, COVERS, initializeStorage, loadCatalog, loadCatalogAsync, loadPreferences, savedStories, mergeCatalog, loadDownloads, saveDownloads, novelChapter } from "./storage";
import { NetworkPaused } from "./network";
import { throwIfAborted, withAbort, yieldToForeground } from "./request-control";
import { isVerificationHost, requireSourceVerification, SOURCE_AGENT, verificationCookies, verificationUserAgent } from "./source-session";
import { backgroundTransfers, waitForTransfer } from "./background-downloads";
import { recordSourceHealth, sourceForRequest } from "./library-tools";
import type { NativeChapter } from "./background-downloads";
import NetInfo from "@react-native-community/netinfo";

const HEADERS = { "User-Agent": MOBILE_AGENT };
type Guard = () => Promise<void>;

async function request<T>(url: string, guard: Guard, read: (response: Awaited<ReturnType<typeof fetch>>) => Promise<T>, referer?: string, signal?: AbortSignal, timeout = 30_000, assetAgent?: string): Promise<T> {
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
    const requestSource = sourceIdForUrl(url, true);
    const agentPolicy = requestSource ? providerInfo(requestSource).requestAgent : "mobile";
    const agent = assetAgent || (agentPolicy === "webview" ? await withAbort(verificationUserAgent, controller.signal) : agentPolicy === "desktop" ? SOURCE_AGENT : undefined);
    const headers = { ...HEADERS, ...(agent ? { "User-Agent": agent } : {}), ...(referer ? { Referer: referer } : {}), ...(cookie ? { Cookie: cookie } : {}) };
    const response = await withAbort(() => fetch(url, { signal: controller.signal, headers }), controller.signal);
    if (!response.ok) {
      const source = sourceForRequest(url);
      if (source) recordSourceHealth(source, response.status === 403 && isVerificationHost(url) ? "verification" : "unavailable", response.status === 403 && isVerificationHost(url) ? "Browser verification required" : `Website returned HTTP ${response.status}`);
      throw response.status === 403 && isVerificationHost(url) ? requireSourceVerification(url) : source ? new ProviderError("unavailable", source, `Request failed (${response.status})`) : new Error(`Request failed (${response.status})`);
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
  if (isVerificationHost(url) && /<title\b[^>]*>\s*(?:Just a moment|Attention Required)/i.test(text)) { recordSourceHealth(sourceIdForUrl(url)!, "verification", "Browser verification required"); throw requireSourceVerification(url); }
  return text;
}
export async function verifySourceSession(url: string, guard: Guard, signal?: AbortSignal): Promise<void> {
  const source = sourceIdForUrl(url);
  if (!source || !isVerificationHost(url)) throw new Error("Unsupported source verification URL.");
  const provider = getProvider(source);
  if (!provider.verify) throw new Error("Unsupported source verification URL.");
  await provider.verify(url, requestContext(source, guard, signal));
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
  const provider = storyProvider(series);
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
    }, provider.assetReferer?.(series.cover, series.url) || series.url, signal);
    throwIfAborted(signal);
    const temporary = new File(COVERS, `${file.name}.${Date.now()}-${Math.random().toString(36).slice(2)}.part`);
    temporary.write(bytes);
    if (file.exists) temporary.delete(); else temporary.move(file);
  }
  return file.uri;
}
async function getJson(url: string, guard: Guard, signal?: AbortSignal): Promise<unknown> {
  const text = await getText(url, guard, undefined, signal);
  try { return JSON.parse(text); }
  catch {
    const source = sourceForRequest(url);
    const message = "Source returned invalid JSON; its parser may need updating.";
    if (source) {
      recordSourceHealth(source, "parser", "Website returned an unexpected API response");
      throw new ProviderError("parser", source, message);
    }
    throw new Error(message);
  }
}

function requestContext(source: SourceId, guard: Guard, signal?: AbortSignal): RequestContext {
  // Reuse the details page when chapter enumeration starts there, without
  // retaining every HTML page of a large series in memory.
  let lastText: { key: string; promise: Promise<string> } | undefined;
  const validate = (url: string) => {
    throwIfAborted(signal);
    if (sourceIdForUrl(url, true) !== source) throw new Error("Provider request outside its declared hosts.");
  };
  return {
    signal,
    text(url, referer, timeout) {
      validate(url);
      const key = JSON.stringify([url, referer, timeout]);
      if (lastText?.key !== key) lastText = { key, promise: getText(url, guard, referer, signal, timeout) };
      return lastText.promise;
    },
    json(url) { validate(url); return getJson(url, guard, signal); },
  };
}

export async function refreshSeries(item: Series, guard: Guard, signal?: AbortSignal, loadChapters = true): Promise<Series> {
  const provider = storyProvider(item), info = providerInfo(provider.id);
  const context = requestContext(provider.id, guard, signal);
  let fresh = await provider.details(item, context);
  if (loadChapters) fresh = await provider.chapters(fresh, context);
  else if (info.chapterCache === "inline") {
    delete fresh.chapterIds; delete fresh.chapterUrls; delete fresh.chapterTitles; delete fresh.lockedChapterIds;
  }
  throwIfAborted(signal);
  if (info.refreshCover === "details" || (info.refreshCover === "chapters" && loadChapters)) {
    try { fresh.localCover = await cacheCover(fresh, guard, signal); }
    catch (error) { throwIfAborted(signal); if (error instanceof NetworkPaused) throw error; if (info.refreshCover === "chapters") fresh.localCover = item.localCover; }
  }
  return { ...fresh, detailsCached: loadChapters || item.detailsCached };
}

async function chapterContent(series: Series, chapter: Chapter, guard: Guard, signal?: AbortSignal) {
  if (!series.chapterIds?.includes(chapter.id) || series.lockedChapterIds?.includes(chapter.id)) throw new Error("This public chapter is unavailable.");
  const provider = storyProvider(series);
  const content = await provider.content(series, chapter, requestContext(provider.id, guard, signal));
  throwIfAborted(signal);
  return content;
}

async function novelContent(series: Series, chapter: Chapter, guard: Guard, signal?: AbortSignal) {
  const content = await chapterContent(series, chapter, guard, signal);
  if (content.kind !== "novel") throw new Error("Expected novel text.");
  return content.text;
}

async function enrichDiscovery(items: Series[], guard: Guard, signal?: AbortSignal, changed = () => {}) {
  // Yield between small batches so cached responses and catalog writes cannot monopolize the UI thread.
  for (let start = 0; start < items.length; start += 3) {
    await new Promise(resolve => setTimeout(resolve, 0));
    await yieldToForeground(signal);
    throwIfAborted(signal);
    const batch = await Promise.all(items.slice(start, start + 3).map(async item => {
      throwIfAborted(signal);
      let fresh = item;
      try {
        if (!item.summary || !Array.isArray(item.genres) || getProvider(sourceOf(item)).needsDetails?.(item) || !(Date.now() - Date.parse(item.metadataSyncedAt || "") <= 6 * 3600_000)) fresh = await refreshSeries(item, guard, signal, false);
      } catch (error) { throwIfAborted(signal); if (error instanceof NetworkPaused) throw error; }
      try { fresh.localCover = await cacheCover(fresh, guard, signal); } catch (error) { throwIfAborted(signal); if (error instanceof NetworkPaused) throw error; }
      throwIfAborted(signal);
      return fresh;
    }));
    throwIfAborted(signal);
    items.splice(start, batch.length, ...batch); mergeCatalog(batch); changed();
  }
}

export async function enrichCatalogIds(ids: string[], guard: Guard, signal?: AbortSignal, changed = () => {}) {
  await yieldToForeground(signal);
  const stored = new Map(catalogMetadata().map(item => [item.slug, item]));
  await enrichDiscovery(ids.map(id => stored.get(id)).filter((item): item is Series => Boolean(item)), guard, signal, changed);
}

export async function syncCatalog(onProgress: (message: string) => void, guard: Guard, force = false, onWarning: (message: string) => void = () => {}, signal?: AbortSignal): Promise<Series[]> {
  throwIfAborted(signal);
  const existing = await loadCatalogAsync();
  const saved = savedStories();
  const items = new Map(existing.map(item => [item.slug, { ...item }]));
  let successful = 0;
  let discoveryError: unknown;
  const preferences = loadPreferences();
  const provider = getProvider(preferences.source), info = providerInfo(provider.id);
  const context = requestContext(provider.id, guard, signal);
  if (!provider.rankings) {
    onProgress(`Refreshing ${info.name} discoveries`);
    try {
      const page = await browseCatalog({ source: provider.id, language: preferences.webtoonLanguage, collection: preferences.webtoonCollection, mode: "comics", sort: "smart", period: "week", query: "", refresh: force }, FIRST_PAGE, guard, signal);
      for (const item of loadCatalog()) items.set(item.slug, item);
      if (page.ids.length) successful++;
    } catch (error) { throwIfAborted(signal); if (error instanceof NetworkPaused) throw error; discoveryError = error; onWarning(error instanceof Error ? error.message : "Source discovery could not refresh."); }
  } else {
    for (const kind of info.formats) for (const period of info.periods) {
      await yieldToForeground(signal);
      onProgress(`Refreshing ${kind} rankings`);
      try {
        const ranked = await provider.rankings(kind, period, context);
        for (const [key, value] of items) if (sourceOf(value) === provider.id && kindOf(value) === kind) items.set(key, { ...value, rank: period === "week" ? undefined : value.rank, popularRanks: { ...value.popularRanks, [period]: undefined } });
        ranked.forEach((fresh, index) => {
          const previous = [...items.values()].find(item => provider.matches(item, fresh));
          const item = { ...provider.merge(fresh, previous), rank: period === "week" ? index + 1 : previous?.rank, popularRanks: { ...previous?.popularRanks, [period]: index + 1 } };
          items.set(item.slug, item);
        });
        successful++;
      } catch (error) { throwIfAborted(signal); if (error instanceof NetworkPaused) throw error; }
    }
  }
  const urls = existing.filter(item => item.localChapters?.length || saved[item.slug]?.bookmarked).map(item => item.url);
  urls.push(...[...items.values()].filter(item => sourceOf(item) === provider.id && Object.values(item.popularRanks || {}).some(Boolean)).map(item => item.url));
  const discovered = new Map<string, Series>();
  if (provider.discover) {
    try { for (const item of await provider.discover(context)) { discovered.set(item.url, item); urls.push(item.url); } }
    catch (error) { throwIfAborted(signal); if (error instanceof NetworkPaused) throw error; }
  }
  let newDetails = 0;
  for (const url of [...new Set(urls)]) {
    await new Promise(resolve => setTimeout(resolve, 0));
    await yieldToForeground(signal);
    throwIfAborted(signal);
    const old = [...items.values()].find(item => item.url === url);
    const owned = old && (old.localChapters?.length || saved[old.slug]?.bookmarked);
    const priority = owned || (old && Object.values(old.popularRanks || {}).some(Boolean));
    if (old?.summary && (old.detailsCached || old.metadataSyncedAt) && !force && !owned && Date.now() - Date.parse(old.metadataSyncedAt || old.syncedAt || "") < 6 * 3600_000) continue;
    if (!priority && newDetails >= 12) continue;
    try {
      onProgress("Refreshing story details");
      let item: Series;
      if (old) item = await refreshSeries(old, guard, signal, Boolean(owned || old.detailsCached));
      else {
        const stub = discovered.get(url);
        if (!stub) continue;
        const fresh = await provider.details(stub, context);
        delete fresh.chapterIds; delete fresh.chapterUrls; delete fresh.chapterTitles; delete fresh.lockedChapterIds;
        const previous = [...items.values()].find(value => provider.matches(value, fresh));
        item = { ...previous, ...fresh, slug: previous?.slug || fresh.slug };
      }
      items.set(item.slug, item);
      if (!priority) newDetails++;
      successful++;
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) { throwIfAborted(signal); if (error instanceof NetworkPaused) { mergeCatalog([...items.values()], true); throw error; } }
  }
  for (const [slug, item] of items) {
    await new Promise(resolve => setTimeout(resolve, 0));
    await yieldToForeground(signal);
    throwIfAborted(signal);
    try { items.set(slug, { ...item, localCover: await cacheCover(item, guard, signal) }); }
    catch (error) { throwIfAborted(signal); if (error instanceof NetworkPaused) { mergeCatalog([...items.values()], true); throw error; } }
  }
  throwIfAborted(signal);
  if (!successful) throw discoveryError || new Error("Could not refresh stories. Pull down to retry.");
  mergeCatalog([...items.values()], true);
  return loadCatalog();
}
export async function searchCatalog(query: string, mode: ContentMode, guard: Guard): Promise<string[]> {
  if (query.trim().length < 2) return [];
  const settings = loadPreferences();
  const page = await browseCatalog({ source: settings.source, language: settings.webtoonLanguage, collection: settings.webtoonCollection, mode, sort: "smart", period: "week", query: query.trim() }, FIRST_PAGE, guard);
  return page.ids;
}

export type { BrowseOptions, BrowseCursor } from "./providers/types";
export const FIRST_PAGE: BrowseCursor = {};

export async function browseCatalog(options: BrowseOptions, cursor: BrowseCursor, guard: Guard, signal?: AbortSignal, changed = () => {}, enrich = true): Promise<{ ids: string[]; cursor: BrowseCursor; hasMore: boolean }> {
  const provider = getProvider(options.source), info = providerInfo(provider.id);
  const language = info.languages?.find(([id]) => id === options.language)?.[0] || info.languages?.[0]?.[0];
  const collection = info.collections?.find(([id]) => id === options.collection)?.[0] || info.collections?.[0]?.[0];
  const mode = info.formats.length === 1 ? info.formats[0] === "novel" ? "novels" : "comics" : options.mode;
  if (cursor.source && cursor.source !== provider.id) throw new Error("Discovery cursor belongs to a different provider. Refresh to restart.");
  let page;
  try { page = await provider.browse({ ...options, language, collection, mode }, cursor.state, requestContext(provider.id, guard, signal)); }
  catch (error) { throwIfAborted(signal); if (!(error instanceof NetworkPaused) && error instanceof ProviderError && error.code === "parser") recordSourceHealth(provider.id, "parser", "Website opened, but no catalog entries were recognized. Source parser may need updating."); throw error; }
  const stored = catalogMetadata(), updates: Series[] = [], selected: Series[] = [];
  if (page.resetSourceRanks) for (const item of stored) if (page.resetSourceRanks(item)) updates.push({ ...item, sourceRank: undefined });
  for (const fresh of page.items) {
    const item = provider.merge(fresh, stored.find(previous => provider.matches(previous, fresh)));
    if (enrich && providerInfo(provider.id).rankOrder === "period") {
      try { item.localCover = await cacheCover(item, guard, signal); }
      catch (error) { throwIfAborted(signal); if (error instanceof NetworkPaused) throw error; }
    }
    selected.push(item); updates.push(item);
  }
  throwIfAborted(signal); mergeCatalog(updates, page.rankings); changed();
  if (enrich) await enrichDiscovery(providerInfo(provider.id).rankOrder === "period" ? selected.filter(item => !item.summary || !item.cover || !item.rating) : selected, guard, signal, changed);
  return { ids: selected.map(item => item.slug), cursor: { source: provider.id, state: page.cursor }, hasMore: page.hasMore };
}

export async function repairSavedPanel(series: Series, chapter: string, page: number, guard: Guard, signal?: AbortSignal): Promise<void> {
  if (!Number.isInteger(page) || page < 0 || kindOf(series) === "novel") throw new Error("Invalid panel.");
  const fresh = await refreshSeries(series, guard, signal);
  if (!fresh.chapterIds?.includes(chapter)) throw new Error("This chapter is no longer publicly available. Existing saved pages remain readable.");
  const chapterUrl = fresh.chapterUrls?.[chapter];
  if (!chapterUrl) throw new Error("Provider did not return a public chapter address.");
  const content = await chapterContent(fresh, { id: chapter, url: chapterUrl }, guard, signal);
  if (content.kind !== "images") throw new Error("Invalid panel.");
  const images = content.assets.map(asset => asset.url);
  const folder = chapterDirectory(series.slug, chapter), marker = new File(folder, ".complete");
  const manifest = JSON.parse(marker.textSync());
  if (manifest.quality !== 2 || JSON.stringify(manifest.urls) !== JSON.stringify(images) || !images[page]) throw new Error("The provider changed this chapter. Re-download it from the series page.");
  const bytes = await request(images[page], guard, async response => {
    if (!response.headers.get("content-type")?.startsWith("image/")) throw new Error("The provider did not return an image.");
    const value = await response.bytes();
    if (!imageHeader(value)) throw new Error("The provider returned a damaged image. Try again later.");
    return value;
  }, content.assets[page].referer, signal, 60_000, content.assets[page].agent);
  throwIfAborted(signal);
  const target = new File(folder, `${String(page + 1).padStart(3,"0")}${extension(images[page])}`), temporary = new File(folder, `${target.name}.part`);
  temporary.write(bytes);
  if (target.exists) target.delete();
  temporary.move(target);
  new File(folder, `.original-${page + 1}`).write(images[page]);
  if (!Array.isArray(manifest.hashes)) manifest.hashes = [];
  manifest.hashes[page] = target.md5;
  marker.write(JSON.stringify(manifest));
  mergeCatalog([fresh]);
}

export async function downloadChapters(series: Series, selector: string, onProgress: (message: string, fraction: number) => void, guard: Guard, signal?: AbortSignal, planned?: string[], onPlan: (chapters: string[]) => void = () => {}, onChapterSaved: () => void = () => {}, automaticBookmark = false, detachAutomatic = false, nativeTransfer = true): Promise<void> {
  onProgress("Saving story details…", 0);
  const fresh = await refreshSeries(series, guard, signal);
  throwIfAborted(signal);
  mergeCatalog([fresh]);
  const novel = kindOf(series) === "novel";
  const available = (fresh.chapterIds || []).map(id => {
    const url = fresh.chapterUrls?.[id];
    if (!url) throw new Error("Provider did not return a public chapter address.");
    return { id, url };
  });
  const plannedIds = planned ? new Set(planned) : undefined;
  const chapters = plannedIds ? available.filter(chapter => plannedIds.has(chapter.id)) : selectChapters(available, selector);
  if (planned && chapters.length !== planned.length) throw new Error("Some queued chapters are no longer available. Cancel this job and choose chapters again.");
  if (!chapters.length) throw new Error("No chapters match that selection");
  onPlan(chapters.map(chapter => chapter.id));
  if (backgroundTransfers && nativeTransfer) {
    const batch: NativeChapter[] = [];
    onProgress(`Preparing chapters · 0/${chapters.length} prepared`, 0);
    for (const [index, chapter] of chapters.entries()) {
      throwIfAborted(signal);
      const folder = chapterDirectory(series.slug, chapter.id); folder.create({ intermediates: true, idempotent: true });
      const marker = new File(folder, ".complete");
      if (novel) {
        const data = chapterIntact(series.slug, chapter.id) ? novelChapter(series.slug, chapter.id)! : await novelContent(fresh, chapter, guard, signal);
        batch.push({ id: chapter.id, marker: marker.uri, files: [], text: JSON.stringify(data), textTarget: new File(folder, "text.json").uri });
      } else {
        const content = await chapterContent(fresh, chapter, guard, signal);
        if (content.kind !== "images") throw new Error("Expected comic panels.");
        const images = content.assets.map(asset => asset.url);
        if (!images.length) throw new Error(`No public images found for chapter ${chapter.id}`);
        let previous: { urls?: string[]; hashes?: string[] } = {}; try { previous = JSON.parse(marker.textSync()); } catch { /* first download */ }
        batch.push({ id: chapter.id, marker: marker.uri, files: images.map((url, page) => ({ url, target: new File(folder, `${String(page + 1).padStart(3, "0")}${extension(url)}`).uri, original: new File(folder, `.original-${page + 1}`).uri, referer: content.assets[page].referer, agent: content.assets[page].agent, hash: previous.urls?.[page] === url ? previous.hashes?.[page] : undefined })) });
      }
      onProgress(`Preparing chapters · ${index + 1}/${chapters.length} prepared`, 0);
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
        const data = await novelContent(fresh, chapter, guard, signal);
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
    const content = await chapterContent(fresh, chapter, guard, signal);
    if (content.kind !== "images") throw new Error("Expected comic panels.");
    const images = content.assets.map(asset => asset.url);
    if (!images.length) throw new Error(`No public images found for chapter ${chapter.id}`);
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
        }, content.assets[page].referer, signal, 60_000, content.assets[page].agent);
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
