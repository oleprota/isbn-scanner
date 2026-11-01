# The only network calls go to our own worker

The optional book name and cover come from a small lookup service (`worker/`) that reads the Goodreads page's JSON-LD. The browser talks only to that worker, so the app works fully without it (empty `LOOKUP_URL`) and every failure can stay silent. Open Library and Google Books were left out, and there is no API key or `config.js`.

## Consequences

- The lookup answer has a shape version (`v` in the request, `DETAILS_VERSION` in the code for the stored entry) so the browser's HTTP cache and `localStorage` never serve an older shape as current.
- Every field of an answer is validated in `cleanAnswer` before it is stored or rendered.
- The worker has a test-only cache bypass, not a public feature: `NO_CACHE=1` in `worker/.dev.vars` (local `wrangler dev`) or `?nocache=<secret>` matching the `NOCACHE_TOKEN` secret on the deployed worker. A bypassed request neither reads nor writes the worker's edge cache and is answered with `cache-control: no-store`; the rate limiter still applies. A missing, empty or wrong token is an ordinary request, and an unset secret never matches. The secret is deleted when the work that needed it is done.
