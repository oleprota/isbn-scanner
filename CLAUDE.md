# ISBN Reader

Minimal web page: enter or scan (camera) an ISBN, or type a title, get a card with links to look it up on Ereadian and Goodreads. Every ISBN lands in a "Scanned" list, and the ones the user stars go to a "Marked" list (a shopping companion). The only book data is an optional name and cover from a tiny lookup service (`worker/`, reads Goodreads); without it a book is its ISBN or the name the user typed. Vanilla JS ES modules, no build step.

## Commands

- Run: `node scripts/serve.mjs` (port 8000; `python3 -m http.server 8000` resets connections under load), then open http://localhost:8000 (ES modules don't load over `file://`)
- Verify UI changes in a real browser (needs the Playwright MCP from `.mcp.json`) with the `/verify-*` skills; `/verify-app` lists and runs all of them. Report failed checks, do not fix them unasked.
- Lookup service: `worker/` (Cloudflare Worker, deploy steps in `worker/README.md`); its address goes in `LOOKUP_URL` in `src/lookup.js`, empty = lookup off
- Test: `npm test` (Node's built-in `node:test`, no network; covers `worker/` too); one file: `node --test test/bookId.test.js`
- Check: `npm run check` (syntax check on all tracked .js/.mjs, then tests; CI and the hook run exactly this)
- Tests and browser checks that need several ISBNs use `test/fixtures/isbns.json` (valid real ISBNs and invalid ones); add new ones there instead of inventing them

## Workflow

- Keep the matching `/verify-*` skill up to date whenever you change the app's logic or UI (new behaviour, a changed rule, a removed feature); skip it for fine-tuning of values (colours, sizes, timings, texts).
- Before committing a sizeable chunk of work, remind the user which `/verify-*` skills cover it and recommend running them. Whether to run them is the user's call only: never run them, or hold a commit back, on your own.

Ideas that are not in the current work go to `BACKLOG.md`.

## Constraints

Before changing scanning, lookup or search, site links or usage stats, read the matching ADR in `docs/adr/`. Domain terms are in `GLOSSARY.md`.

- The interface is Ukrainian only (no language toggle): every text is in `src/strings.js`. Keep new texts concise.
- Render user-supplied text (typed names, stored lists) only via `textContent`, never `innerHTML`.
- Keep it minimal: be very frugal about dependencies, frameworks and build tooling. Suggest one only when the gain is clear, and ask before adding it.
- The camera must never start automatically, and the manual ISBN field must keep working when the camera is denied or unavailable.

## Agent skills

### Issue tracker

GitHub Issues on `oleprota/isbn-scanner`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
