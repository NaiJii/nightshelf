import type { Chapter, ContentMode, NovelText, Period, Series, SortOrder } from "../parser";
import type { SourceId } from "../provider-info";

export type BrowseOptions = { source?: SourceId; language?: string; collection?: string; mode: ContentMode; sort: SortOrder; period: Period; query: string; refresh?: boolean };
// Cursors are runtime-only. Each adapter validates its own state; screens only
// return this envelope to the service that produced it.
export type BrowseCursor = { source?: SourceId; state?: unknown };
export type RequestContext = {
  signal?: AbortSignal;
  text(url: string, referer?: string, timeout?: number): Promise<string>;
  json(url: string): Promise<unknown>;
};
export type ProviderPage<Cursor> = {
  items: Series[];
  cursor: Cursor;
  hasMore: boolean;
  rankings?: boolean;
  resetSourceRanks?: (item: Series) => boolean;
};
export type ImageAsset = { url: string; referer: string; agent: string };
export type ChapterContent = { kind: "images"; assets: ImageAsset[] } | { kind: "novel"; text: NovelText };

// Providers describe remote data only: no filesystem, UI, queue or notification
// imports. The existing Series DTO is retained to keep persisted IDs compatible.
export interface Provider<Cursor> {
  id: SourceId;
  cursor(value: unknown): Cursor;
  browse(options: BrowseOptions, cursor: Cursor, context: RequestContext): Promise<ProviderPage<Cursor>>;
  details(story: Series, context: RequestContext): Promise<Series>;
  chapters(story: Series, context: RequestContext): Promise<Series>;
  content(story: Series, chapter: Chapter, context: RequestContext): Promise<ChapterContent>;
  assetReferer?(url: string, referer: string): string;
  needsDetails?(story: Series): boolean;
  matches(previous: Series, fresh: Series): boolean;
  merge(fresh: Series, previous?: Series): Series;
  rankings?(kind: "comic" | "novel", period: Period, context: RequestContext): Promise<Series[]>;
  discover?(context: RequestContext): Promise<Series[]>;
  verify?(url: string, context: RequestContext): Promise<void>;
}

export function cursorObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid provider cursor. Refresh to restart discovery.");
  return value as Record<string, unknown>;
}
export function cursorNumber(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < fallback) throw new Error("Invalid provider cursor. Refresh to restart discovery.");
  return value as number;
}
