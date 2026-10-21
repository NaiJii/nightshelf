# Provider API audit — 2026-10-21

**Implementation update:** the provider extraction below has now been carried out for all four sources. See [PROVIDERS.md](PROVIDERS.md) for the current contract, migration compatibility and remaining model limits. The rest of this document records the pre-change audit and design rationale.

## Verdict

The application has a useful common model and mostly separate parsers, but it does **not yet have a clean provider extension API**. Adding a fifth source currently requires editing shared orchestration and UI code. The current design supports its four known sources; it is not universal enough to add unfamiliar pagination, authentication, chapter identities or content formats without special cases.

Keep the current implementations working. Introduce a small static adapter registry when the next provider is added, rather than a plugin loader, inheritance tree, scripting engine or speculative framework.

## Current extension points and gaps

| Concern | Current implementation | Limitation |
| --- | --- | --- |
| Identity | `SourceId`, `Series`, `SOURCES`, `sourceOf`, `kindOf` in `parser.ts`; slug prefixes in source parsers. | `sourceOf` infers URL hosts and falls back to Asura for every unknown host, ignoring `Series.source`. `Series` also contains the provider-specific `vortexId`. Storage IDs, source IDs and source routing are not separated. |
| Discovery/search | `browseCatalog`, `browseReaderSite`, `browseWebtoon`, `searchCatalog` in `scraper.ts`. | Search has two entry paths; `searchCatalog` is Asura-only, while active Explore uses `browseCatalog`. `BrowseCursor` exposes every provider's fields at once. Caches are separate but repeat expiry/eviction rules. |
| Metadata/chapters | `refreshSeries(item, guard, signal, loadChapters)` plus `chapterListCached`. | A boolean controls two different operations. Completeness rules are provider branches; WEBTOON incremental traversal and API completeness mean different things. Some summaries/counts need extra detail requests because listing pages do not provide them. A universal API cannot promise unavailable fields. |
| Chapter identity/order | String IDs, numeric `chapterSort`, numeric range selection/jump, separate URL/title/locked maps. | Episode IDs happen to be numeric for the current providers. A future source may have UUIDs, volumes, specials or separate ordering keys. Numeric range/jump UI needs capabilities; identity must not imply order. Parallel maps can disagree. |
| Public/restricted content | Provider parsers omit/reject restricted content; `lockedChapterIds` retains status. | Availability is implicit across arrays and maps. It should be an explicit adapter result; the shared downloader must never invent a public URL for restricted content. |
| Content loading | `downloadChapters` re-fetches details and, for Asura, chapter lists; `chapterImages` selects the image parser; novel endpoints are hardcoded. | Transport, parsing, local storage, queue planning and source logic live together. Adding a novel source or required image headers affects the shared downloader. |
| Capabilities | UI checks `source === ...` in Home, Explore, discovery controls, series cards/details and verification. | Supported sorts, ranking periods, formats, collections, languages, tags and verification are not declared by the provider. Some sorts are local-only and already need explanatory text. |
| Verification/health | MangaKakalot-specific host/cookie policy, screen observer and message regex matching; source health maintained by request URL. | A fifth source should not need to add error-message regexes or modify a MangaKakalot observer. Authentication/verification availability must be typed and explicit, with host-restricted credentials. |
| Persistence/backup | `Preferences`, backup host/enum allowlists, `Series` local/source fields, source checks in storage/merge. | New sources require additional hardcoded lists and safe identity validation. A registry may supply declarations, but backup validation must remain explicit and bounded; never trust arbitrary persisted request hosts. |
| Releases/downloads | Shared queue, read ledger, feed, network consent, automatic release baseline. | These are strong shared services and should remain outside adapters. Providers should return data, not trigger notifications, write library files, prompt for data or run their own queues. |

## Minimal proposed contract

This is a design proposal, not an implemented or promised runtime API:

```ts
interface Provider<Cursor, StoryRef> {
  id: string;
  name: string;
  capabilities: ProviderCapabilities;
  parseStoryUrl(url: string): StoryRef | null;
  browse(query: BrowseQuery, cursor: Cursor | undefined,
    context: RequestContext): Promise<Page<StorySummary, Cursor>>;
  details(story: StoryRef, context: RequestContext): Promise<StoryDetails>;
  chapters(story: StoryRef, cursor: Cursor | undefined,
    context: RequestContext): Promise<Page<Chapter, Cursor>>;
  content(chapter: Chapter, context: RequestContext): Promise<ChapterContent>;
}
```

- **RequestContext** supplies a shared, abortable, timeout-controlled HTTP client. That client enforces network consent, allowed source/asset hosts, headers and verified cookie scope. Providers do not call raw fetch behind it. It returns typed transport/verification/parser failures; UI wording belongs to shared presentation code.
- **Capabilities** declares formats, language choices, optional collections, discovery sorts, remote versus local sorting, supported ranking periods, tag filtering and verification support. Unsupported capabilities are absent, not silently approximated. Keep language/collection in the query, without WEBTOON-specific field names in the core contract.
- **StoryRef** holds provider-owned identity. Shared persistence uses an explicit provider ID plus an opaque source key and a validated stable storage key. Keep current persisted slugs through a compatibility layer; do not rename library folders during extraction.
- **StorySummary/StoryDetails** separate common metadata from local fields. Unknown rating, count or update date is explicitly absent. A rating has value and scale. Local cover paths, file inventory, bookmarks and read history stay outside provider DTOs.
- **Chapter** contains opaque ID, display label, explicit order, URL/reference and public/restricted/unavailable status. Display numbers are optional. Completion is a property of a chapter-page result, not inferred from the largest numeric ID or metadata count.
- **Page** contains items and an optional next cursor. Cursor types are owned by adapters; no common union of every source's fields. Keep pages runtime-only unless a cursor has explicit versioned validation. The service can walk all pages for full chapter selection, cancellation and release baselines.
- **ChapterContent** is a discriminated union of ordered image assets and sanitized novel text. An image asset carries its URL and permitted request headers/referer; shared download code owns validation, file names, checksums and native handoff. No provider-specific code goes into the native transfer engine.

Use a concrete discriminated registry to retain cursor/reference type safety internally. The illustrative `string` IDs above are not a recommendation to replace today's closed `SourceId` type with arbitrary persisted strings. Do not add generic parameters to screens or make them understand source cursors.

## Suggested migration, keeping behavior stable

1. Add a registry with today's IDs, labels, host validation and capabilities. Test that each existing UI option maps to the same source request/local sort as before.
2. Extract one adapter at a time behind existing `browseCatalog` and `refreshSeries` exports. Leave cache ownership, catalog commits, network guard, cancellation and release baseline logic in the existing shared service. Preserve current IDs and metadata merge semantics.
3. Move chapter enumeration and content resolution into adapters. Reuse the full result for download planning to eliminate redundant Asura fetches, but treat that request-count change as a separately tested optimization.
4. Replace UI source comparisons with capability declarations. Keep a dedicated verification screen only for providers that declare it; use typed errors rather than matching English text.
5. Revisit chapter DTO/order and numeric-only affordances only when a provider actually needs them. That requires backward-compatible saved-state handling, not a mass rename during cleanup.

## Required adapter contract tests

- The same identity survives discovery → details → full chapter traversal → refresh and backup restore; equal titles from different providers remain separate.
- Sparse listings cannot erase cached details; unknown values remain unknown rather than fabricated zeros/counts.
- Pagination terminates, never loops/repeats indefinitely, and does not certify a partial list as complete. Restricted chapters remain restricted.
- Source/asset URLs, redirects, referers and cookie hosts remain constrained; no credentials leak to another source.
- Cancellation stops pending work before cache/catalog commits, and one failed story does not prevent other bookmarks updating.
- The existing queue, Wi-Fi consent, saved-file validation and first-observation release baseline work unchanged with the adapter.

The behavior-preserving changes in this audit only centralize existing Asura listing merges and image-parser dispatch. They do not introduce this proposed API or change provider behavior.
