// ISBN lookup service, for the app (a browser page can't read Goodreads: no CORS headers there):
//   GET /lookup?isbn=<isbn>  -> {title, series, author, rating, image} or 404 {}
//   GET /lookup?isbn=<isbn>&original=1 -> {original: {title, author, rating, image, sameWork, url}} | 404 {reason, ...} (see originalAnswer)
//   GET /search?q=<title>    -> {results: [{id, title, author, image}]} (up to 5)
//   GET /book?id=<book id>   -> {isbn, title, series, author, rating, image} of that Goodreads edition, or 404 {}
//   POST /event              -> 204; a batch of anonymous usage events, kept in D1 when it is set up (events.js)
// Runs as a Cloudflare Worker, see README.md in this folder.
import { isValidIsbn, normalizeIsbn } from '../src/isbn.js';
import { ORIGINAL_RETRY_SECONDS } from '../src/lookup.js';
import { originalOrWhy, parseBook, parseCandidates, parseEdition } from './goodreads.js';
import { MAX_BYTES as MAX_EVENT_BYTES, cleanBatch, pruneEvents, saveBatch } from './events.js';

// the last one is the browser extension (extension/), whose ID the manifest's `key` pins
export const ALLOWED_ORIGINS = ['https://oleprota.github.io', 'http://localhost:8000', 'chrome-extension://pklepflaloonoobdekhhkhllcclcgipm'];
const FOUND_SECONDS = 7 * 24 * 3600;
const MISSING_SECONDS = 24 * 3600; // Goodreads said 404: it really doesn't know the book
const SEARCH_SECONDS = 24 * 3600; // a title search with results
const UNSURE_SECONDS = 60; // anything else (an empty 202, a block, an error): ask again soon
const QUERY_WORD_DROP_TRIES = 4;
const RETRY_202_TRIES = 4;
const RETRY_DELAY_MS = 1500;
// the original is on request and can be slower: fewer, more spaced tries at Goodreads, and a failure is remembered longer
const ORIGINAL_RETRY_202_TRIES = 2;
const ORIGINAL_RETRY_DELAY_MS = 2000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 400_000; // the JSON-LD block is near the top of a ~1 MB page
const MAX_BYTES_DEEP = 800_000; // the original title (embedded state) is at ~70% of it
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Reads the page only until the JSON-LD block is complete; `deep` goes on until the original title (embedded state, much
// later in the page) is found, or MAX_BYTES_DEEP. Each chunk is scanned alone plus a short carry-over, so the cost stays linear in the page size.
const ORIGINAL_TITLE = /"originalTitle":"(?:[^"\\]|\\.)*"/;
const CARRY = 2000; // enough to hold the marker, or a title cut by a chunk edge (200 characters as \uXXXX escapes are 1200)
async function readHead(response, deep = false) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let bytes = 0;
  let phase = 0; // 0: looking for the JSON-LD marker, 1: for the end of its block, 2: for the original title
  let carry = '';
  let cut = true; // stays true when the byte limit ended the read: the rest of the page was not seen
  while (bytes < (deep ? MAX_BYTES_DEEP : MAX_BYTES)) {
    const { done, value } = await reader.read();
    if (done) { cut = false; break; }
    bytes += value.length;
    const text = decoder.decode(value, { stream: true });
    parts.push(text);
    let window = carry + text;
    if (phase === 0 && window.includes('application/ld+json')) {
      phase = 1;
      window = window.slice(window.indexOf('application/ld+json'));
    }
    if (phase === 1 && window.includes('</script>')) {
      phase = 2;
      if (!deep) { cut = false; break; }
      window = window.slice(window.indexOf('</script>'));
    }
    if (phase === 2 && ORIGINAL_TITLE.test(window)) { cut = false; break; }
    carry = window.slice(-CARRY);
  }
  reader.cancel().catch(() => {});
  return { html: parts.join(''), cut };
}

// Goodreads sometimes answers an empty 202 for a page it has not built yet and serves the full page
// a moment later, so a 202 is asked again, up to RETRY_202_TRIES times in all, RETRY_DELAY_MS apart. Returns { found } (what `parse` made of the page) or
// { miss, certain, why }: `certain` only when Goodreads answered 404, so that a hiccup is never remembered as "no such book".
async function fromGoodreads(pageUrl, parse, fetchFn, wait, deep = false) {
  let miss = 'no answer';
  let why;
  const tries = deep ? ORIGINAL_RETRY_202_TRIES : RETRY_202_TRIES;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const response = await fetchFn(pageUrl, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.status === 404) return { miss: 'status 404', certain: true };
      miss = `status ${response.status}`;
      if (response.status === 200 && response.body) {
        const { html, cut } = await readHead(response, deep);
        const parsed = parse(html, cut); // a page that is no use may say why: { unusable: <reason> }
        if (parsed && !parsed.unusable) return { found: parsed };
        miss = 'no book data in page';
        why = parsed?.unusable;
      }
      if (response.status !== 202) break;
      if (attempt === tries - 1) break; // no pause after the last try
    } catch {
      miss = 'timeout or network error';
      break;
    }
    await wait(deep ? ORIGINAL_RETRY_DELAY_MS : RETRY_DELAY_MS);
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
// first, the author after it), down to one word, at most QUERY_WORD_DROP_TRIES times. Returns the candidates, [] or null (failure).
async function searchGoodreads(query, fetchFn, maxTries = QUERY_WORD_DROP_TRIES) {
  const words = query.split(' ');
  for (let tries = 0; tries < maxTries && words.length > 0; tries++, words.pop()) {
    const results = await suggestions(words.join(' '), fetchFn);
    if (!results || results.length) return results;
  }
  return [];
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
    if (url.pathname === '/lookup') {
      const isbn = normalizeIsbn(param('isbn'));
      if (!isValidIsbn(isbn)) return json({ error: 'invalid isbn' }, 400, 0, cors);
      const page = `https://www.goodreads.com/book/isbn/${isbn}`;
      if (url.searchParams.get('original') === '1') {
        key = `orig3/${isbn}`; // orig3: 404s carry detailed reasons // orig2: the answer carries the cover
        work = () => originalAnswer(page);
      } else {
        key = `v6/${isbn}`; // v6: the first author, as listed
        work = () => pageAnswer(page, parseBook);
      }
    } else if (url.pathname === '/book') {
      const id = param('id');
      if (!/^\d{1,12}$/.test(id)) return json({ error: 'invalid id' }, 400, 0, cors);
      key = `book2/${id}`; // book2: the whole answer with the ISBN, not the ISBN alone
      work = () => pageAnswer(`https://www.goodreads.com/book/show/${id}`, parseEdition);
    } else if (url.pathname === '/search') {
      const query = param('q').slice(0, 100);
      if (query.length < 2) return json({ error: 'query too short' }, 400, 0, cors);
      key = `search1/${encodeURIComponent(query.toLowerCase())}`;
      work = async () => {
        const results = await searchGoodreads(query, fetchFn);
        return results ? json({ results: results.map(({ id, title, author, image }) => ({ id, title, author, image })) }, 200, results.length ? SEARCH_SECONDS : UNSURE_SECONDS) : json({}, 502, UNSURE_SECONDS);
      };
    } else return json({}, 404, 0, cors);

    async function pageAnswer(pageUrl, parse) {
      const { found, miss, certain } = await fromGoodreads(pageUrl, parse, fetchFn, wait);
      return found
        ? json(found, 200, FOUND_SECONDS)
        : json({}, 404, certain ? MISSING_SECONDS : UNSURE_SECONDS, { 'x-miss-reason': miss }); // the reason is for curl, when debugging
    }

    // The original of a translation: the page's hint is searched by title and author. {original} for a hit whose author
    // matches exactly (the translation's own work included), else 404 (a failure is remembered shortly).
    // `until` (epoch ms) is when the remembered failure ends: the app counts down to it, from the cache too
    const unavailable = (reason, extra) => json({ reason, until: Date.now() + ORIGINAL_RETRY_SECONDS * 1000 }, 404, ORIGINAL_RETRY_SECONDS, extra);
    const final = (reason, extra = {}) => json({ reason, ...extra }, 404, MISSING_SECONDS);
    // The original of a translation: the page's hint is searched by title and author (both Goodreads' own words, so one search,
    // no word dropping). {original} for a hit whose author matches exactly, else 404 {reason}. The reasons (the app words them, src/strings.js):
    //   page-404 page-empty page-refused page-down page-no-book page-no-author page-no-original page-too-long page-same-title page-no-work
    //   search-failed search-empty search-other-author search-no-rating search-no-work search-ambiguous
    // page-empty, page-refused, page-down and search-failed are remembered ORIGINAL_RETRY_SECONDS and carry `until`; the others for a day.
    async function originalAnswer(pageUrl) {
      const { found, miss, certain, why } = await fromGoodreads(pageUrl, (html, cut) => {
        const result = originalOrWhy(html, cut);
        return result.found ?? { unusable: result.why };
      }, fetchFn, wait, true);
      if (!found) {
        if (certain) return final('page-404');
        if (why) return final(why);
        const status = /^status (\d+)$/.exec(miss)?.[1];
        const reason = status === '202' ? 'page-empty' : status === '403' || status === '429' ? 'page-refused' : 'page-down';
        return unavailable(reason, { 'x-miss-reason': miss });
      }
      if (!found.workId) return final('page-no-work'); // without the page's work id nothing can be compared
      const results = await searchGoodreads(`${found.title} ${found.author}`, fetchFn, 1);
      if (!results) return unavailable('search-failed');
      if (!results.length) return final('search-empty', { title: found.title });
      const byAuthor = results.filter((r) => r.author === found.author);
      if (!byAuthor.length) return final('search-other-author', { title: found.title });
      const hits = byAuthor.filter((r) => r.rating);
      if (!hits.length) return final('search-no-rating');
      const own = hits.find((r) => r.workId === found.workId); // the book's own work among the hits: shown as the original too, whatever else matched
      if (!own && hits.some((r) => !r.workId)) return final('search-no-work');
      if (!own && hits.some((r) => r.workId !== hits[0].workId)) return final('search-ambiguous');
      const { id, title, author, rating, image } = own ?? hits[0];
      return json({ original: { title, author, rating, image, sameWork: Boolean(own), url: `https://www.goodreads.com/book/show/${id}` } }, 200, FOUND_SECONDS);
    }

    // test-only bypass (ADR-0003): ?nocache=1 skips the edge cache, read and write
    const bypass = url.searchParams.get('nocache') === '1';
    const cacheKey = new Request(`https://lookup.invalid/${key}`);
    const cached = bypass ? null : await cache.match(cacheKey);
    if (cached) return new Response(cached.body, { status: cached.status, headers: { ...Object.fromEntries(cached.headers), ...cors } });

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
