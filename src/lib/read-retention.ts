export const READ_RETENTION_MS = 24 * 60 * 60_000;
export function readDeletionDue(readAt: string | undefined, now = Date.now()): boolean {
  if (typeof readAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(readAt)) return false;
  const at = Date.parse(readAt || "");
  return Number.isFinite(at) && at > 0 && now - at >= READ_RETENTION_MS;
}
