# UX audit — NightShelf 2.0.2

Code audit of discovery, library, series pages, download controls and the reader. Layout and gesture behavior still need physical-phone review.

## Implemented

- Explain whether downloads are preparing, queued, active, waiting, paused or need attention. Waiting jobs can be paused to stop automatic retries.
- Keep per-story progress on series pages; reserve overall queue averages for the full queue. State how overall percentages are calculated.
- Label cancellation as Stop, with explicit keep-files and delete-all choices. Explain that delete-all also removes earlier saved chapters.
- Provide a direct Verify source action when MangaKakalot discovery reports a verification error, and retain the actual failure message.
- State that Wi-Fi only also affects running transfers.
- Keep delete-after-reading in reader settings, removing the duplicate general-settings control.
- Distinguish filtered-empty libraries from libraries with no saved stories, with Clear filters to recover.
- Allow library categories to scroll horizontally on narrow screens or with larger text.
- Use Read again when every saved chapter is read.
- Rename Select visible to Select filtered: this action selects all chapters matching the filters, including rows outside the viewport.
- Announce download status changes rather than announcing every page-progress update to screen readers.

## Recommended next

1. **Avoid silently skipping unavailable chapters in reader navigation.** Previous/next navigation currently follows saved chapters. If there is a gap, show the target chapter and missing interval before jumping, with a way to return to the series page. Keep ordinary consecutive navigation immediate.
2. **Make large libraries cheaper to render.** The library currently maps every story into the page ScrollView. Move to a virtualized list when addressing large-library performance; preserve the filter/header and download controls.
3. **Improve long preparation feedback.** Preparing large downloads can take time before panel transfer begins. Show the number of chapters prepared alongside the existing Preparing state, and keep Stop/Pause available.

## Phone acceptance checks

- On mobile data, approve a download, then switch to Wi-Fi only: it must stop transferring, show a waiting state and recover on Wi-Fi.
- Background a queued download, reopen the existing app process, and confirm progress and controls return without duplicate jobs.
- Pause a waiting download, reconnect, and confirm it stays paused until explicitly resumed.
- Block one source and sync bookmarks from another: unaffected stories should update while the source error remains actionable.
- Check library tabs and actions with Android large text and TalkBack; check the reader's existing tap/zoom gestures for regressions.
