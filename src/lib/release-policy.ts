import type { SavedStory, Series } from "./parser";
// The first observation establishes a baseline; old chapters never cause a catch-up flood.
export function newReleases(previous: string[] | undefined, current: string[]): string[] {
  if (!previous) return [];
  const known = new Set(previous);
  return [...new Set(current)].filter(id => !known.has(id));
}

export function unreadReleases(updates: string[] = [], read: Record<string, string> = {}, available?: string[]): string[] {
  return [...new Set(updates)].filter(chapter => !read[chapter] && (!available || available.includes(chapter)));
}

export function automaticReleaseIds(story: SavedStory | undefined, item: Series, updates: string[] = [], read: Record<string, string> = {}): string[] {
  if (!story?.bookmarked || !story.autoDownload || !Array.isArray(story.autoDownloadBaseline)) return [];
  const baseline = new Set(story.autoDownloadBaseline), saved = new Set(item.localChapters || []);
  return unreadReleases(updates, read, item.chapterIds).filter(id => !baseline.has(id) && !saved.has(id));
}
