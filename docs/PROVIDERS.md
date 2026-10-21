# Provider adapters

All four sources use the same remote-data boundary. The implementation deliberately retains the existing `Series` storage model, story slugs, chapter IDs and preference keys; updating does not migrate or rename downloaded files.

## File map

- `src/lib/provider-info.ts`: lightweight declarations used by routing, UI and backup validation. Defines IDs, names, story/API hosts, supported formats, sorts, local sort limitations, ranking periods, languages, collections and verification availability.
- `src/lib/providers/types.ts`: adapter, request context, page, opaque cursor envelope and chapter-content types.
- `src/lib/providers/registry.ts`: typed static registration and validation of story/provider identity. Unknown or mismatched sources fail explicitly.
- `src/lib/providers/asura.ts`, `webtoon.ts`, `reader-sites.ts`: implementations. Vortex and MangaKakalot share directory mechanics but supply their own details, chapter enumeration, content and verification logic.
- `src/lib/scraper.ts`: shared service. Owns transport, consent, cancellation/timeouts, catalog/cache commits, cover files, download preparation, repair and native handoff. It contains no provider endpoint strings or provider content parsers.
- `scripts/provider-contract-check.mjs`: contract fixtures. Existing scraper/storage tests continue to exercise all sources through the shared service.

## Contract

Implement `Provider<Cursor>`, where the cursor type is private to that adapter:

```ts
interface Provider<Cursor> {
  id: SourceId;
  cursor(value: unknown): Cursor;
  browse(query: BrowseOptions, cursor: Cursor,
    context: RequestContext): Promise<ProviderPage<Cursor>>;
  details(story: Series, context: RequestContext): Promise<Series>;
  chapters(story: Series, context: RequestContext): Promise<Series>;
  content(story: Series, chapter: Chapter,
    context: RequestContext): Promise<ChapterContent>;
  matches(previous: Series, fresh: Series): boolean;
  merge(fresh: Series, previous?: Series): Series;
}
```

`cursor(undefined)` starts browsing. Other cursor values must be validated, including nonnegative offsets and valid page numbers. The service wraps returned state as `{source, state}` and rejects reuse with another provider. Cursors are held in memory only and are never restored from backups.

`browse` returns remote entries and an explicit `hasMore`. The optional page fields `rankings` and `resetSourceRanks` preserve the existing two ranking models. The service applies identity matching and merge policy against the latest catalog. Adapters do not read or write catalog files.

`details` returns overview metadata. The service invokes `chapters` afterwards only when a complete list is required. `chapters` must produce the complete public `chapterIds` and `chapterUrls`, retain source-reported `lockedChapterIds`, and set the appropriate completeness flags. A partial list must throw rather than be marked complete. Asura reuses the list from its details response; WEBTOON retains its existing incremental traversal once it reaches known episodes. API counts must not substitute for actual chapter enumeration.

`content` returns either `{kind: "images", assets}` or `{kind: "novel", text}`. Each image asset has a URL, referer and user agent. Novel text must be sanitized by its parser. Public chapter addresses come from adapters; the shared service checks availability and does not fabricate missing addresses. JS and native transfers use the emitted asset headers. The shared downloader owns files, completion markers, checksums and the queue.

Optional `assetReferer` supplies cover request headers without embedding CDN rules in the shared transport. Other optional methods provide `rankings`, homepage `discover`, additional overview completeness checks (`needsDetails`), and a verification probe (`verify`). Notification grouping, automatic-release baselines and storage limits remain shared services.

## Transport and errors

Use the injected `context.text` and `context.json`, never raw fetch. Metadata/API requests must remain on declared HTTPS hosts; story hosts and API-only hosts are distinct. The context carries the caller's abort signal and uses the existing network guard and timeouts. It reuses only the last text response, allowing details/chapter enumeration to share a first page without retaining every page of a large series.

Use `ProviderError` for actionable verification, parser or unavailable errors. Verification detection uses its code; legacy persisted text messages remain supported for existing queues. Human verification is only shown for providers that declare it. Request-to-browser URL mapping and ready selectors are declared with provider metadata; the actual access probe belongs to the adapter.

Asset host checks remain in each source's existing image parser and the existing native transfer protections. Declaring a metadata host does not authorize arbitrary image sources or access to restricted chapters. A future provider needing WebView cookies must also explicitly extend the native cookie host policy; challenge cookies are currently restricted to MangaKakalot. There is no arbitrary account/session-cookie forwarding.

## Add a source

1. Extend `SourceId` and add a declaration in `provider-info.ts`. Declare only capabilities the source actually supports; mark sorts that apply to loaded titles. Add optional parser code separately.
2. Implement a `Provider<Cursor>` using the injected context. Preserve a deterministic source-specific storage slug and use explicit full-list and availability semantics. Keep filesystem, React/native APIs, notifications and queue code out of the adapter.
3. Register it in `providers/registry.ts`. The registry's exhaustive type check requires an implementation for each source ID. Ordinary providers do not require edits to the shared downloader, provider picker, language/collection/sort controls, source routing or backup host allowlist.
4. Add fixtures for identity stability, sparse metadata, every chapter page, restricted entries, content/headers, cancellation and malformed payloads. Run `npm test`, `npm run typecheck` and `npm run lint`; then check the actual site and phone behavior.

## Compatibility and deliberate limits

- Existing slugs, local file names, markers, read history, bookmarks and automatic-release baselines stay compatible.
- The old `BrowseCursor` provider-specific fields are removed. Only runtime callers see the new envelope; no saved library data contains those cursors.
- `searchCatalog` uses the same provider-aware browse/search path as Explore instead of its former Asura-only endpoint path.
- Existing `webtoonLanguage` / `webtoonCollection` preference names remain as compatibility keys; the adapter query uses generic `language` / `collection` fields.
- `Series` still mixes remote and local optional fields and retains `vortexId` for old cached entries. Adapters receive the existing DTO so no data migration is required. A separate persisted-model migration is outside this extraction.
- Current chapter ordering/range/jump controls assume numeric episode/chapter labels; rating strings retain their current scales. A provider with UUID identities, volume ordering or another rating format needs an explicit compatible model/UI extension. The new boundary isolates that future work; it does not pretend those cases already work.
- This change adds no plugin loader, dynamic source execution, authentication bypass, dependency, native module or APK build.
