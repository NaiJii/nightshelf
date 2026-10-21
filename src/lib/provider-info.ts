import type { Period, SortOrder } from "./parser";

export type SourceId = "asura" | "webtoon" | "vortex" | "mangakakalot";
export type ProviderInfo = {
  id: SourceId;
  name: string;
  requestAgent: "mobile" | "desktop" | "webview";
  chapterNoun: "chapters" | "episodes";
  audienceNoun: "saves" | "subscribers";
  hosts: readonly string[];
  requestHosts?: readonly string[];
  formats: readonly ("comic" | "novel")[];
  sorts: readonly (readonly [SortOrder, string])[];
  periods: readonly Period[];
  localSorts: readonly SortOrder[];
  languages?: readonly (readonly [string, string])[];
  collections?: readonly (readonly [string, string])[];
  collectionSorts?: Readonly<Record<string, readonly SortOrder[]>>;
  collectionFromUrl?: (url: string) => string;
  verification?: { readySelector: string; url: string; pageUrl?: (url: string) => string };
  chapterCache: "inline" | "explicit" | "urls";
  rankOrder: "period" | "source";
  refreshCover: "discovery" | "details" | "chapters";
};

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: "asura", name: "Asura", requestAgent: "mobile", chapterNoun: "chapters", audienceNoun: "saves",
    hosts: ["asurascans.com"], requestHosts: ["api.asurascans.com"],
    formats: ["comic", "novel"],
    sorts: [["smart", "For you"], ["trending", "Popular"], ["rating", "Top rated"], ["updated", "Latest updates"], ["chapters", "Long reads"], ["title", "A–Z"]],
    periods: ["week", "month", "all"], localSorts: ["smart", "chapters"],
    chapterCache: "inline",
    rankOrder: "period",
    refreshCover: "discovery",
  },
  {
    id: "webtoon", name: "WEBTOON", requestAgent: "desktop", chapterNoun: "episodes", audienceNoun: "subscribers",
    hosts: ["www.webtoons.com"],
    formats: ["comic"],
    sorts: [["smart", "Popular"], ["trending", "Trending"], ["title", "A–Z"]],
    periods: [], localSorts: ["title"],
    languages: [["en", "English"], ["fr", "Français"], ["es", "Español"], ["de", "Deutsch"], ["id", "Indonesia"], ["th", "ภาษาไทย"], ["zh-hant", "中文 (繁體)"]],
    collections: [["originals", "Originals"], ["canvas", "Canvas"]], collectionSorts: { canvas: ["smart", "title"] }, collectionFromUrl: url => url.includes("/canvas/") ? "canvas" : "originals",
    chapterCache: "urls",
    rankOrder: "source",
    refreshCover: "chapters",
  },
  {
    id: "vortex", name: "Vortex", requestAgent: "desktop", chapterNoun: "chapters", audienceNoun: "saves",
    hosts: ["vortexscans.org", "www.vortexscans.org"], requestHosts: ["api.vortexscans.org"],
    formats: ["comic"],
    sorts: [["smart", "Popular"], ["updated", "Latest updates"], ["title", "A–Z"]],
    periods: [], localSorts: ["title"],
    chapterCache: "explicit",
    rankOrder: "source",
    refreshCover: "details",
  },
  {
    id: "mangakakalot", name: "MangaKakalot", requestAgent: "webview", chapterNoun: "chapters", audienceNoun: "saves",
    hosts: ["www.mangakakalot.gg", "mangakakalot.gg"],
    formats: ["comic"],
    sorts: [["smart", "Popular"], ["updated", "Latest updates"], ["title", "A–Z"]],
    periods: [], localSorts: ["title"],
    verification: { readySelector: ".comic-list, .panel_story_list, .manga-info-top, .container-chapter-reader", url: "https://www.mangakakalot.gg/manga-list/hot-manga", pageUrl: value => {
      const url = new URL(value), manga = url.pathname.match(/^\/api\/manga\/([^/]+)\/chapters\/?$/);
      return manga ? `${url.origin}/manga/${manga[1]}` : value;
    } },
    chapterCache: "explicit",
    rankOrder: "source",
    refreshCover: "details",
  },
];

export function providerInfo(id: SourceId = "asura"): ProviderInfo {
  const info = PROVIDERS.find(item => item.id === id);
  if (!info) throw new Error(`Unsupported provider: ${id}`);
  return info;
}

export function sourceIdForUrl(value: string, request = false): SourceId | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return;
    return PROVIDERS.find(info => info.hosts.includes(url.hostname) || (request && info.requestHosts?.includes(url.hostname)))?.id;
  } catch { return; }
}

export function providerSorts(info: ProviderInfo, collection?: string) {
  const supported = collection ? info.collectionSorts?.[collection] : undefined;
  return supported ? info.sorts.filter(([sort]) => supported.includes(sort)) : info.sorts;
}

export function effectiveProviderSort(info: ProviderInfo, sort: SortOrder, collection?: string): SortOrder {
  return providerSorts(info, collection).some(([key]) => key === sort) ? sort : "smart";
}
