// The first observation establishes a baseline; old chapters never cause a catch-up flood.
export function newReleases(previous: string[] | undefined, current: string[]): string[] {
  if (!previous) return [];
  const known = new Set(previous);
  return [...new Set(current)].filter(id => !known.has(id));
}

export function unreadReleases(updates: string[] = [], read: Record<string, string> = {}, available?: string[]): string[] {
  return [...new Set(updates)].filter(chapter => !read[chapter] && (!available || available.includes(chapter)));
}

