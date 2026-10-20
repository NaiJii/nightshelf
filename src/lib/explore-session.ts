import type { BrowseCursor } from "./scraper";

export type ExploreSession = { ids: string[]; cursor: BrowseCursor; hasMore: boolean; offset: number };
const sessions = new Map<string, ExploreSession>();
const queries = new Map<string, string>();
export function exploreQuery(provider: string): string { return queries.get(provider) || ""; }
export function rememberExploreQuery(provider: string, query: string): void { queries.set(provider, query); }
export function exploreSession(key: string): ExploreSession | undefined { return sessions.get(key); }
export function rememberExplore(key: string, session: ExploreSession): void {
  sessions.delete(key); sessions.set(key, session);
  if (sessions.size > 40) sessions.delete(sessions.keys().next().value!);
}
