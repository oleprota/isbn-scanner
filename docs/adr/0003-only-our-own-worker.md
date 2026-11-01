# The only network calls go to our own worker

The optional book name and cover come from a small lookup service (`worker/`) that reads the Goodreads page's JSON-LD. The browser talks only to that worker, so the app works fully without it (empty `LOOKUP_URL`) and every failure can stay silent. Open Library and Google Books were left out, and there is no API key or `config.js`.

## Consequences

- The lookup answer has a shape version (`v` in the request, `DETAILS_VERSION` in the code for the stored entry) so the browser's HTTP cache and `localStorage` never serve an older shape as current.
- Every field of an answer is validated in `cleanAnswer` before it is stored or rendered.
- The worker has a test-only cache bypass, not a public feature: `?nocache=1` makes a request neither read nor write the worker's edge cache and be answered with `cache-control: no-store`; the rate limiter still applies. There is no secret: it only costs a Goodreads fetch, which the limiter bounds. The page offers it to the `dev` flag only (an open frame under the stats line with a checkbox, ticked on every load).
