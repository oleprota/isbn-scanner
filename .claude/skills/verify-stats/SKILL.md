---
name: verify-stats
description: Verify the ISBN Reader's anonymous usage stats in a browser: stats note, event batching, no personal data, Do Not Track. Use after changes to stats.js, worker/events.js or the stats note.
---

# Verify usage stats

Read `../verify-app/common.md` first (setup, closing check, report). Mock `**/event` with `page.route` (answer 204, record the bodies) so nothing reaches the real worker.

1. **Note and id.** Clean `localStorage`, load: `#stats-note` is visible and equals `S.page.statsNote(id, true)` (`S` = `src/strings.js`, see `common.md` step 8) with an 8-hex-digit id; `dev` is true on localhost. The id is the same after a reload.
2. **Events.** Do a search, a scan (fake camera, see `../verify-app/fake-camera.js`) and a star, then hide the page (`Object.defineProperty(document, 'visibilityState', { value: 'hidden' })` + dispatch `visibilitychange`): one POST with `text/plain`, the id, `dev: 1` and a body that has at least the events `session`, `search`, `lookup` (when the lookup is mocked, see verify-lookup), `scan_start`, `scan_ok`, `star`, in the order the actions were done (a scanned book also counts as a `search` and a `lookup`). Set `LOOKUP_URL` to a mock address as in verify-lookup, since stats are sent to that address.
3. **Privacy.** No body holds an ISBN, a title or a name.
4. **Do Not Track.** With `Object.defineProperty(navigator, 'doNotTrack', { value: '1' })` in an init script nothing is sent and `#stats-note` is hidden.
5. **Dev flag.** Loading `/#dev` keeps the flag and removes the hash from the address.
6. **Title pick.** Pick a candidate (mocks as in verify-lookup): `title_pick` is sent at click time with only `isbn` (`0` for a new book, `1` when its ISBN was already stored). When the edition request ends, one `isbn_found` follows with `found` (1/0), `result` (`found`, `missing`, `timeout`, ...), `reason` for a 404, `ms`, `retry` (0 automatic, 1 the card's retry button) and `details`; no ISBN, title or name in it. A card built later for a book that still has no ISBN sends another `isbn_found` with `retry` 0.

Finish with the closing check from `common.md`.
