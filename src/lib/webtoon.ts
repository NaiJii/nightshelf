import { chapterSort, decodeHtml, plainText } from "./parser";
import type { Series } from "./parser";

export const WEBTOON_LANGUAGES = [["en", "English"], ["fr", "Français"], ["es", "Español"], ["de", "Deutsch"], ["id", "Indonesia"], ["th", "ภาษาไทย"], ["zh-hant", "中文 (繁體)"]] as const;
export function webtoonLanguage(value = "en"): string { return WEBTOON_LANGUAGES.some(([id]) => id === value) ? value : "en"; }
function attr(tag: string, name: string): string { return decodeHtml(tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] || ""); }
function meta(html: string, name: string): string { return attr([...html.matchAll(/<meta\b[^>]*>/gi)].find(([tag]) => attr(tag, "property") === name || attr(tag, "name") === name)?.[0] || "", "content"); }
function classText(html: string, name: string): string { return plainText(html.match(new RegExp(`<([a-z][\\w]*)\\b[^>]*class=["'][^"']*\\b${name}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i"))?.[2] || ""); }
export function webtoonUrl(value: string, base = "https://www.webtoons.com/"): URL | null {
  try {
    const url = new URL(decodeHtml(value), base);
    return url.protocol === "https:" && url.hostname === "www.webtoons.com" && WEBTOON_LANGUAGES.some(([id]) => url.pathname.startsWith(`/${id}/`)) && /^\d+$/.test(url.searchParams.get("title_no") || "") ? url : null;
  } catch { return null; }
}
export function parseWebtoonCards(html: string, language: string): Series[] {
  const items = new Map<string, Series>();
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const url = webtoonUrl(attr(match[1], "href"));
    if (!url || !url.pathname.endsWith("/list") || !url.pathname.startsWith(`/${language}/`)) continue;
    const title = classText(match[2], "title") || classText(match[2], "subj") || attr(match[2].match(/<img\b[^>]*>/i)?.[0] || "", "alt");
    if (!title) continue;
    const slug = `webtoon-${language}-${url.searchParams.get("title_no")}`;
    if (items.has(slug)) continue;
    const image = match[2].match(/<img\b[^>]*>/i)?.[0] || "";
    url.searchParams.delete("page");
    items.set(slug, { source: "webtoon", language, slug, url: url.href, title, summary: "", cover: attr(image, "data-src") || attr(image, "src"), rating: "", bookmarks: "", status: "", type: url.pathname.includes("/canvas/") ? "WEBTOON CANVAS" : "WEBTOON", kind: "comic", chapterCount: 0, latestChapter: "", genres: [classText(match[2], "genre")].filter(Boolean) });
  }
  return [...items.values()];
}
export function parseWebtoonEpisodes(html: string, seriesUrl: string): { ids: string[]; urls: Record<string, string>; titles: Record<string, string>; next?: string; updatedAt?: string } {
  const series = webtoonUrl(seriesUrl);
  if (!series) throw new Error("Invalid WEBTOON story URL.");
  const urls: Record<string, string> = {}, titles: Record<string, string> = {};
  const list = html.match(/<ul\b[^>]*id=["']_listUl["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1] || "";
  for (const [row, block] of list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const anchor = block.match(/<a\b[^>]*>/i)?.[0] || "";
    const url = webtoonUrl(attr(anchor, "href"), seriesUrl);
    const id = url?.searchParams.get("episode_no");
    if (!url || !id || !/^\d+$/.test(id) || !url.pathname.endsWith("/viewer") || url.searchParams.get("title_no") !== series.searchParams.get("title_no") || /ico_(?:lock|fastpass)|data-locked=["']true/i.test(row)) continue;
    urls[id] = url.href; titles[id] = classText(block, "subj") || `Episode ${id}`;
  }
  const page = Number(series.searchParams.get("page") || 1);
  const pages = [...html.matchAll(/<a\b[^>]*>/gi)].map(([tag]) => webtoonUrl(attr(tag, "href"), seriesUrl)).filter((url): url is URL => Boolean(url && url.pathname === series.pathname && url.searchParams.get("title_no") === series.searchParams.get("title_no") && Number(url.searchParams.get("page")) === page + 1));
  const rawDate = classText(list, "date");
  const language = series.pathname.split("/")[1];
  let date = Date.parse(rawDate);
  if (!Number.isFinite(date)) {
    const normalized = rawDate.toLocaleLowerCase().replace(/\./g, "");
    const year = normalized.match(/\b(20\d{2})\b/)?.[1];
    for (let month = 0; year && month < 12; month++) {
      const name = new Intl.DateTimeFormat(language, { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2020, month, 15))).toLocaleLowerCase().replace(/\./g, "");
      if (!normalized.includes(name)) continue;
      const day = normalized.replace(year, "").replace(name, "").match(/\d{1,2}/)?.[0];
      if (day) date = Date.UTC(Number(year), month, Number(day));
    }
  }
  return { ids: Object.keys(urls).sort(chapterSort), urls, titles, next: pages[0]?.href, updatedAt: Number.isFinite(date) && date <= Date.now() ? new Date(date).toISOString() : undefined };
}
export function parseWebtoonDetails(html: string, item: Series): Series {
  const canonical = webtoonUrl(meta(html, "og:url"));
  if (!canonical || canonical.searchParams.get("title_no") !== webtoonUrl(item.url)?.searchParams.get("title_no") || canonical.pathname.split("/")[1] !== item.language) throw new Error("This WEBTOON story is unavailable in the selected language.");
  const day = classText(html, "day_info");
  const subscribers = html.match(/class=["']ico_subscribe["'][\s\S]*?<em\b[^>]*>([^<]+)/i)?.[1] || "";
  const listed = parseWebtoonEpisodes(html, item.url);
  const episodes = [...html.matchAll(/data-episode-no=["'](\d+)["']/gi)].map(value => Number(value[1])).concat(listed.ids.map(Number));
  const rating = classText(html, "star_score") || html.match(/id=["']_starScore["'][^>]*>([\d.]+)/i)?.[1] || item.rating;
  const genre = classText(html, "genre");
  return { ...item, genres: genre ? [genre] : item.genres || [], title: meta(html, "og:title") || item.title, summary: classText(html, "summary") || meta(html, "og:description"), cover: meta(html, "og:image") || item.cover, rating, chapterCount: episodes.length ? Math.max(...episodes, item.chapterCount) : item.chapterCount, latestChapter: episodes.length ? String(Math.max(...episodes)) : item.latestChapter, bookmarks: plainText(subscribers), status: /completed|terminé|finalizado|abgeschlossen|จบแล้ว|完結|完结/i.test(day) ? "Completed" : day ? "Ongoing" : "Unknown", updatedAt: listed.updatedAt || item.updatedAt, sourceDates: Boolean(listed.updatedAt || item.sourceDates), metadataSyncedAt: new Date().toISOString() };
}
export function parseWebtoonImages(html: string): string[] {
  return [...new Set([...html.matchAll(/<img\b[^>]*>/gi)].filter(([tag]) => /(?:^|\s)_images(?:\s|$)/.test(attr(tag, "class"))).map(([tag]) => attr(tag, "data-url")).filter(value => {
    try { const url = new URL(value); return url.protocol === "https:" && /^(?:webtoon|swebtoon)-phinf\.pstatic\.net$/.test(url.hostname); } catch { return false; }
  }))];
}
export function webtoonSearchHasNext(html: string, pageUrl: string): boolean {
  const current = new URL(pageUrl);
  return [...html.matchAll(/<(?:a|button)\b[^>]*>/gi)].some(([tag]) => {
    try {
      const next = new URL(attr(tag, "href") || attr(tag, "data-url-to"), current);
      return next.origin === current.origin && next.pathname === current.pathname && next.searchParams.get("keyword") === current.searchParams.get("keyword") && Number(next.searchParams.get("page")) === Number(current.searchParams.get("page") || 1) + 1;
    } catch { return false; }
  });
}
