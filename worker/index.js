// ISBN lookup service, for the app (a browser page can't read Goodreads: no CORS headers there):
//   GET /lookup?isbn=<isbn>  -> {title, series, author, rating, image} or 404 {reason}
//   GET /search?q=<title>    -> {results: [{id, title, author, image}]} (up to 5)
//   GET /book?id=<book id>   -> {isbn, title, series, author, rating, image} of that Goodreads edition, or 404 {reason}
//   POST /event              -> 204; a batch of anonymous usage events, kept in D1 when it is set up (events.js)
// Runs as a Cloudflare Worker, see README.md in this folder.
import { isValidIsbn, normalizeIsbn } from '../src/isbn.js';
import { parseBook, parseCandidates, parseEdition } from './goodreads.js';
import { MAX_BYTES as MAX_EVENT_BYTES, cleanBatch, pruneEvents, saveBatch } from './events.js';

// the last one is the browser extension (extension/), whose ID the manifest's `key` pins
export const ALLOWED_ORIGINS = ['https://oleprota.github.io', 'http://localhost:8000', 'chrome-extension://pklepflaloonoobdekhhkhllcclcgipm'];
const FOUND_SECONDS = 7 * 24 * 3600;
const MISSING_SECONDS = 24 * 3600; // Goodreads said 404: it really doesn't know the book
const SEARCH_SECONDS = 24 * 3600; // a title search with results
const UNSURE_SECONDS = 60; // anything else (an empty 202, a block, an error): ask again soon
const QUERY_WORD_DROP_TRIES = 3;
const RETRY_202_TRIES = 4;
const RETRY_DELAY_MS = 1500;
const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 400_000; // the JSON-LD block is near the top of a ~1 MB page
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Reads the page only until the JSON-LD block is complete, then drops the rest.
async function readHead(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  let bytes = 0;
  while (bytes < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    html += decoder.decode(value, { stream: true });
    const marker = html.indexOf('application/ld+json');
    if (marker !== -1 && html.indexOf('</script>', marker) !== -1) break;
  }
  reader.cancel().catch(() => {});
  return html;
}

// Goodreads sometimes answers an empty 202 for a page it has not built yet and serves the full page
// a moment later, so a 202 is asked again, up to RETRY_202_TRIES times in all, RETRY_DELAY_MS apart. Returns { found } (what `parse` made of the page) or
// { miss, certain, why }: `certain` only when Goodreads answered 404, so that a hiccup is never remembered as "no such book". `why` is the reason the
// app words (src/strings.js): page-404, page-empty (an empty 202), page-refused (403/429), page-down (timeout, network, other status), page-no-book (a page without book data).
async function fromGoodreads(pageUrl, parse, fetchFn, wait) {
  let miss = 'no answer';
  let why = 'page-down';
  for (let attempt = 0; attempt < RETRY_202_TRIES; attempt++) {
    try {
      const response = await fetchFn(pageUrl, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.status === 404) return { miss: 'status 404', certain: true, why: 'page-404' };
      miss = `status ${response.status}`;
      why = response.status === 202 ? 'page-empty' : response.status === 403 || response.status === 429 ? 'page-refused' : 'page-down';
      if (response.status === 200 && response.body) {
        const found = parse(await readHead(response));
        if (found) return { found };
        miss = 'no book data in page';
        why = 'page-no-book';
      }
      if (response.status !== 202) break;
      if (attempt === RETRY_202_TRIES - 1) break; // no pause after the last try
    } catch {
      miss = 'timeout or network error';
      why = 'page-down';
      break;
    }
    await wait(RETRY_DELAY_MS);
  }
  return { miss, certain: false, why };
}

// Goodreads' search-as-you-type JSON (at most 5 books): the candidates, or null when it could not be read.
async function suggestions(query, fetchFn) {
  try {
    const response = await fetchFn(`https://www.goodreads.com/book/auto_complete?format=json&q=${encodeURIComponent(query)}`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return response.ok ? parseCandidates(await response.json()) : null;
  } catch {
    return null;
  }
}

// Goodreads matches every word against the book's title and the names of all authors it lists, and one
// word that matches nothing (an author spelled in a way Goodreads doesn't have) leaves no results at all.
// So when the whole query finds nothing, the last word is dropped and it is asked again (the title comes
// first, the author after it), down to one word, at most QUERY_WORD_DROP_TRIES times. Returns { results: the candidates, [] or null (failure), tries: how many times Goodreads was asked }.
async function searchGoodreads(query, fetchFn) {
  const words = query.split(' ');
  let tries = 0;
  for (; tries < QUERY_WORD_DROP_TRIES && words.length > 0; words.pop()) {
    const results = await suggestions(words.join(' '), fetchFn);
    tries++;
    if (!results || results.length) return { results, tries };
  }
  return { results: [], tries };
}

const json = (body, status, seconds, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${seconds}`, ...extra },
  });

// Usage events: dropped silently without a database (DB is optional, like the limiter), saved after the answer is sent.
async function record(request, env, ctx, cors) {
  if (request.method !== 'POST') return json({}, 404, 0, cors);
  // a body without a length (streamed) would be read whole before it could be refused; sendBeacon always sends the length
  const length = Number(request.headers.get('content-length'));
  if (!(length > 0 && length <= MAX_EVENT_BYTES)) return json({ error: 'too big' }, 413, 0, cors);
  const limited = await env.EVENT_LIMITER?.limit({ key: request.headers.get('cf-connecting-ip') ?? 'anonymous' });
  if (limited && !limited.success) return json({ error: 'slow down' }, 429, 0, cors);
  const batch = cleanBatch(await request.text());
  if (!batch) return json({ error: 'invalid' }, 400, 0, cors);
  if (env.DB && batch.rows.length) {
    const saving = saveBatch(env.DB, batch).catch(() => {}); // a failed save loses a few counters, nothing else
    ctx?.waitUntil(saving);
  }
  return new Response(null, { status: 204, headers: cors });
}

// `fetchFn` and `cache` are parameters so that tests don't touch the network.
export function createHandler({ fetchFn, cache, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  return async function handle(request, env = {}, ctx) {
    const origin = request.headers.get('origin');
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403 });
    const cors = origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET' } });

    const url = new URL(request.url);
    if (url.pathname === '/event') return record(request, env, ctx, cors);
    if (request.method !== 'GET') return json({}, 404, 0, cors);
    const param = (name) => (url.searchParams.get(name) ?? '').trim().replace(/\s+/g, ' ');
    // what each path asks: its cache key (the version changes with the answer's shape, or when old cached answers must go)
    // and the work that makes the answer
    let key;
    let work;
    // Stats rows written by the worker itself (not in EVENTS, so a client can't forge them): `upstream` = one real Goodreads fetch, `cache_hit` = answered from the cache.
    // `kind` is lookup, book or search. Nothing without a database. The nocache bypass is dev's own use.
    const note = (name, data) => env.DB && ctx?.waitUntil(saveBatch(env.DB, { id: 'worker', dev: bypass ? 1 : 0, rows: [{ ts: Date.now(), name, data: JSON.stringify(data) }] }).catch(() => {}));
    let kind;
    if (url.pathname === '/lookup') {
      const isbn = normalizeIsbn(param('isbn'));
      if (!isValidIsbn(isbn)) return json({ error: 'invalid isbn' }, 400, 0, cors);
      kind = 'lookup';
      key = `v7/${isbn}`; // v7: 404s carry a reason // v6: the first author, as listed
      work = () => pageAnswer(`https://www.goodreads.com/book/isbn/${isbn}`, parseBook);
    } else if (url.pathname === '/book') {
      const id = param('id');
      if (!/^\d{1,12}$/.test(id)) return json({ error: 'invalid id' }, 400, 0, cors);
      kind = 'book';
      key = `book3/${id}`; // book3: 404s carry a reason // book2: the whole answer with the ISBN, not the ISBN alone
      work = () => pageAnswer(`https://www.goodreads.com/book/show/${id}`, parseEdition);
    } else if (url.pathname === '/search') {
      const query = param('q').slice(0, 100);
      if (query.length < 2) return json({ error: 'query too short' }, 400, 0, cors);
      kind = 'search';
      key = `search1/${encodeURIComponent(query.toLowerCase())}`;
      work = async () => {
        const started = Date.now();
        const { results, tries } = await searchGoodreads(query, fetchFn);
        note('upstream', { kind, result: !results ? 'failed' : results.length ? 'found' : 'empty', tries, ms: Date.now() - started });
        return results ? json({ results }, 200, results.length ? SEARCH_SECONDS : UNSURE_SECONDS) : json({}, 502, UNSURE_SECONDS);
      };
    } else return json({}, 404, 0, cors);

    async function pageAnswer(pageUrl, parse) {
      const started = Date.now();
      const { found, miss, certain, why } = await fromGoodreads(pageUrl, parse, fetchFn, wait);
      note('upstream', { kind, result: found ? 'found' : why, ms: Date.now() - started });
      return found
        ? json(found, 200, FOUND_SECONDS)
        : json({ reason: why }, 404, certain ? MISSING_SECONDS : UNSURE_SECONDS, { 'x-miss-reason': miss }); // `miss` is for curl, when debugging
    }

    // test-only bypass (ADR-0003): ?nocache=1 skips the edge cache, read and write
    const bypass = url.searchParams.get('nocache') === '1';
    const cacheKey = new Request(`https://lookup.invalid/${key}`);
    const cached = bypass ? null : await cache.match(cacheKey);
    if (cached) {
      note('cache_hit', { kind });
      return new Response(cached.body, { status: cached.status, headers: { ...Object.fromEntries(cached.headers), ...cors } });
    }

    const limited = await env.LIMITER?.limit({ key: request.headers.get('cf-connecting-ip') ?? 'anonymous' });
    if (limited && !limited.success) return json({ error: 'slow down' }, 429, 0, cors);

    const response = await work();
    if (!bypass) await cache.put(cacheKey, response.clone());
    const noStore = bypass ? { 'cache-control': 'no-store' } : {};
    return new Response(response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...cors, ...noStore } });
  };
}

export default {
  fetch: (request, env, ctx) => {
    const handle = createHandler({ fetchFn: fetch, cache: caches.default });
    return handle(request, env, ctx);
  },
  // the daily job in wrangler.toml: the usage events do not grow for ever
  scheduled: (event, env, ctx) => {
    if (env.DB) ctx.waitUntil(pruneEvents(env.DB).catch(() => {}));
  },
};
