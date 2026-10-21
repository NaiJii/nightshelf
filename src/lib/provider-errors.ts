import type { SourceId } from "./provider-info";

export class ProviderError extends Error {
  readonly code: "verification" | "parser" | "unavailable";
  readonly source: SourceId;
  constructor(code: ProviderError["code"], source: SourceId, message: string) {
    super(message);
    this.code = code;
    this.source = source;
    this.name = "ProviderError";
  }
}

export function needsVerification(error: unknown): boolean {
  if (error instanceof ProviderError) return error.code === "verification";
  // Old persisted queue messages and old native builds do not carry error codes.
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return /(?:verification|verify source|verify the source)/i.test(message);
}
