import { sourceIdForUrl } from "../provider-info";
import type { SourceId } from "../provider-info";
import type { Series } from "../parser";
import type { Provider } from "./types";
import { asura } from "./asura";
import { webtoon } from "./webtoon";
import { mangakakalot, vortex } from "./reader-sites";

// Adapt the cursor once at the boundary; concrete adapters keep their own type.
function register<Cursor>(provider: Provider<Cursor>): Provider<unknown> {
  return { ...provider, browse: (options: Parameters<typeof provider.browse>[0], cursor: unknown, context: Parameters<typeof provider.browse>[2]) => provider.browse(options, provider.cursor(cursor), context) };
}
const registry = { asura: register(asura), webtoon: register(webtoon), vortex: register(vortex), mangakakalot: register(mangakakalot) } satisfies Record<SourceId, unknown>;

export function getProvider(id: SourceId = "asura") {
  if (!Object.hasOwn(registry, id)) throw new Error(`Unsupported provider: ${id}`);
  return registry[id];
}
export function storyProvider(story: Pick<Series, "url" | "source">) {
  const id = sourceIdForUrl(story.url);
  if (!id || (story.source && story.source !== id)) throw new Error("Unsupported or mismatched story source.");
  return getProvider(id);
}
