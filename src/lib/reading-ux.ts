import type { SavedStory, Series } from "./parser";

export function unreadFromHere(ascending: string[], chapter: string, read: Record<string, string>): string[] {
  const index = ascending.indexOf(chapter);
  return index < 0 ? [] : ascending.slice(index).filter(id => id === chapter || !read[id]);
}

export type LibraryScope = "downloads" | "bookmarked" | "liked" | "lists" | "autoDownload";
export function inLibraryScope(item: Series, saved: SavedStory | undefined, scope: LibraryScope): boolean {
  return Boolean(scope === "downloads" ? item.hasLocalFiles : scope === "lists" ? saved?.list : scope === "autoDownload" ? saved?.bookmarked && saved.autoDownload : saved?.[scope]);
}

export function libraryScopeCounts(items: Series[], saved: Record<string, SavedStory>): Record<LibraryScope, number> {
  const counts = { downloads: 0, bookmarked: 0, liked: 0, lists: 0, autoDownload: 0 };
  const scopes = Object.keys(counts) as LibraryScope[];
  for (const item of items) for (const scope of scopes) if (inLibraryScope(item, saved[item.slug], scope)) counts[scope]++;
  return counts;
}

export function unavailableChapter(options: { locked?: boolean; offline?: boolean; damaged?: boolean; failed?: boolean }): string | undefined {
  if (options.locked) return "This chapter requires access through the provider. Public chapters and chapters already saved on your phone remain readable.";
  if (options.offline) return "This chapter is not saved on your phone. Connect to the internet to download it; saved chapters remain readable offline.";
  if (options.damaged) return "This chapter is incomplete or has missing files. Download it again to repair it; your reading progress will stay.";
  if (options.failed) return "This chapter has not finished downloading. Retry the download, or choose Read now to save this chapter first.";
  return undefined;
}

export function matchesStoryQuery(item: Pick<Series, "title" | "alternativeTitles">, query: string): boolean {
  const normalize = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim();
  const term = normalize(query);
  const alternatives = Array.isArray(item.alternativeTitles) ? item.alternativeTitles.filter((title): title is string => typeof title === "string") : [];
  return !term || [item.title, ...alternatives].some(title => normalize(title).includes(term));
}

export function readingActionLabel(chapter: string, saved: boolean, fraction: number, read = false): string {
  if (!saved) return `Download chapter ${chapter}`;
  if (read) return `Read chapter ${chapter} again`;
  return fraction > 0 ? `Resume chapter ${chapter}` : `Start chapter ${chapter}`;
}
