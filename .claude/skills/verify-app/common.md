# Shared setup for the verify-* skills

Run checks with the Playwright MCP (`mcp__playwright__*` tools; if deferred, load them with ToolSearch) and report pass/fail. Do not edit app code: report failures instead. Use `browser_run_code_unsafe` for anything that needs timing, request counting or page overrides.

## Setup
1. Confirm the Playwright MCP is connected. If not, stop and tell the user to register it (`.mcp.json`) and check `/mcp`.
2. App server on http://localhost:8000. Note first whether it is already up: `curl -s http://localhost:8000/ | grep '<title data-s="page.title"'` matches when the app is served (the title text is filled in by the app, so the raw HTML has an empty `<title>`).
   - Already up: use it, and leave it running when you finish (the user may be using it).
   - Port free: start `node scripts/serve.mjs` in the background from the project root, and stop that process when you finish.
   - Port serves something else: stop and report.
3. Screenshots go to `.playwright-mcp/` (gitignored), named `verify-<check>.png`. A check that asks for a screenshot is not done until you have opened it with `Read` and judged it; report what you saw.
4. Start clean: on the app origin run `localStorage.clear()` (Scanned, Marked and theme persist between runs), then reload.
5. ISBNs: read them from `test/fixtures/isbns.json` (`found` / `notFoundInOpenLibrary` are valid, `invalid` must fail) instead of inventing any.
6. `LOOKUP_URL` in `src/lookup.js` is the deployed worker, so by default the app would call the real service. Every skill except `verify-lookup` turns the lookup off (`verify-card` check 11 and its ↻ button need the lookup on: it uses the mock address like `verify-lookup`, since the ↻ is hidden when `LOOKUP_URL` is empty): before the first navigation register `page.route('**/src/lookup.js', async (r) => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace(/LOOKUP_URL = '[^']*'/, "LOOKUP_URL = ''") }); })` (`verify-lookup` substitutes a mock address instead). The app then requests only its own files (and `vendor/zxing-browser.min.js` after Scan). Record every request with `page.on('request', …)` for the whole run: any other host is a failure, apart from links a test opens on purpose and the mocked worker (`/lookup`, `/search`, `/book`, `/event`).
7. A `python3 -m http.server` already running on the port drops module requests under load (`ERR_CONNECTION_RESET`) and leaves the app dead on that load; `node scripts/serve.mjs` does not. If the page does nothing, reload and retry before reporting a failure.

8. **UI texts come from `src/strings.js`, never from the skills.** A check that names `S.group.key` (or `S.fn(args)`) means the expected text is that value from the app's own module. In the page, load it with `const S = await import('/src/strings.js')` inside the same `page.evaluate` (the app already loaded that module, so it is the same instance, nothing is fetched twice), then compare the DOM text, tooltip or `aria-label` with it. Editing a text in `strings.js` therefore never breaks a check, while a text hardcoded outside `strings.js` (or a broken `data-s*` path in `index.html`) does. This proves the browser shows what `strings.js` says, not that the wording is right.

9. **Clipboard.** Headless Chromium has no clipboard permission, so `navigator.clipboard.writeText` hangs and the copy status never appears. Before a check that uses Copy, run `page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8000' })`.

## Closing check (every skill ends with this)
Collect console errors for the whole run (`browser_console_messages`, `all: true`, level error). The only expected one is `Could not start the scanner: NotAllowedError` (verify-scan, camera denied). Anything else, or a request to an unexpected host, is a failure.

## Report
Close the browser (`browser_close`), stop the server only if you started it, commit nothing. State plainly what could not run and why (a check that could not run counts as partial).

**Default (short)**: only this, nothing else, no table:
```
A checks: B passed, C partial, D failed
```
(A = B + C + D), then one line per partial or failed check: `<number>. <name>: <partial|failed>`. Passed checks get no line of their own.

**Verbose** (only when the user asks for it): one table: check, result (pass / partial / fail / not run), notes, screenshot path.
