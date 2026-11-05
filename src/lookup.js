// The app's only network calls, all to the lookup service (worker/): a book's name, cover, series, author and rating
// by ISBN; and, for a book typed by title, the candidates from Goodreads' search and the ISBN of the one picked.
// The app works fully without it: every failure (no URL set, offline, unknown book, slow answer)
// gives null and the book stays `ISBN <number>`.
import { isValidIsbn, normalizeIsbn } from './isbn.js';
import { cleanText as clean } from './text.js';

export const LOOKUP_URL = 'https://isbn-lookup.oleprota.workers.dev'; // the deployed worker (worker/README.md); '' turns the lookup off
const TIMEOUT_MS = 10000; // Goodreads pages sometimes take 4 s or more, and the worker may ask twice (an empty 202)
const SEARCH_TIMEOUT_MS = 12000; // the worker may ask Goodreads up to 4 times in a row (it drops words while nothing is found)
const SHAPE = 8; // the answer's shape, same as `v8` in worker/index.js: it keeps the browser's HTTP cache from serving an answer of an older shape
const BUSY_WAIT_MS = 5000; // the worker answered 429 (too many lookups at once): the request waits and goes again
const BUSY_RETRIES = 3;

// Dev only (ADR-0003): while on, every request carries `nocache=1` and the worker skips its cache.
let noCache = false;
export const setNoCache = (on) => { noCache = on; };

const AUTHOR_URL = 'https://www.goodreads.com/author/';

// What the service said, checked field by field (it is rendered into the page, so nothing is trusted):
// { title, [bookId: the Goodreads book id, when the service sent a valid one], image, series: {name, number} | null, author: {name, url} | null, rating: {value, count} | null }.
export function cleanAnswer(data) {
  const title = clean(data?.title, 120);
  if (!title) return null;
  const seriesName = clean(data.series?.name, 80);
  const authorName = clean(data.author?.name, 100);
  const bookId = typeof data.bookId === 'string' || typeof data.bookId === 'number' ? String(data.bookId) : '';
  return {
    title,
    ...(/^\d{1,12}$/.test(bookId) && { bookId }),
    image: typeof data.image === 'string' && data.image.startsWith('https://') ? data.image : '',
    series: seriesName ? { name: seriesName, number: clean(data.series.number, 12) } : null,
    author: authorName
      ? { name: authorName, url: typeof data.author.url === 'string' && data.author.url.startsWith(AUTHOR_URL) ? data.author.url : '' }
      : null,
    rating: cleanRating(data.rating),
  };
}

// A rating count under this is too small to trust (the Card shows it orange, with a warning). The page and the extension share it.
export const THIN_RATING_COUNT = 100;
export const isThin = (rating) => Boolean(rating) && rating.count < THIN_RATING_COUNT;

function cleanRating(rating) {
  const value = Number(rating?.value);
  const count = Number(rating?.count);
  return value > 0 && value <= 5 && Number.isInteger(count) && count > 0 ? { value, count } : null;
}

// The candidates of a title search: up to 5 of { id, title, author, image }, or null when the answer is not a list of results.
export function cleanResults(data) {
  if (!Array.isArray(data?.results)) return null;
  return data.results
    .map((b) => ({
      id: String(b?.id ?? ''),
      title: clean(b?.title, 120),
      author: clean(b?.author, 100),
      image: typeof b?.image === 'string' && b.image.startsWith('https://') ? b.image : '',
    }))
    .filter((b) => /^\d{1,12}$/.test(b.id) && b.title)
    .slice(0, 5);
}

// A Goodreads edition picked from a title search: { isbn, found } (`found` is what cleanAnswer makes of the
// same answer, null when it has no title), or null when the ISBN is not valid.
export function cleanEdition(data) {
  const isbn = normalizeIsbn(data?.isbn ?? '');
  return isValidIsbn(isbn) ? { isbn, found: cleanAnswer(data) } : null;
}

// Asks the service and returns what `parse` makes of the answer, or null. Never throws. A 429 puts the
// request in a queue of sorts: it waits and asks again (up to BUSY_RETRIES times), so the caller's
// spinner runs until the final answer. `report(outcome, ms, detail)` (optional, for the usage stats and the messages) is told how it ended:
// found, invalid (an answer that is not usable), missing (404), busy (429 to the end), timeout, offline or error. `detail` is { reason } for missing (the worker's, see REASONS, or 'no-reason') and { status } for error.
const REASONS = ['page-404', 'page-empty', 'page-refused', 'page-down', 'page-no-book']; // the worker's reasons for a 404 (worker/index.js)
async function ask(path, params, parse, { url = LOOKUP_URL, fetchFn = fetch, timeout = TIMEOUT_MS, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), report } = {}) {
  if (!url) return null;
  const started = Date.now();
  const done = (outcome, value = null, detail = {}) => {
    report?.(outcome, Date.now() - started, detail);
    return value;
  };
  for (let attempt = 0; attempt <= BUSY_RETRIES; attempt++) {
    try {
      const response = await fetchFn(`${url}/${path}?${new URLSearchParams(noCache ? { ...params, nocache: 1 } : params)}`, { signal: AbortSignal.timeout(timeout) });
      if (response.status !== 429) {
        if (!response.ok) {
          if (response.status !== 404) return done('error', null, { status: response.status });
          const reason = (await response.json().catch(() => null))?.reason;
          return done('missing', null, { reason: REASONS.includes(reason) ? reason : 'no-reason' });
        }
        const value = parse(await response.json());
        return done(value ? 'found' : 'invalid', value);
      }
    } catch (error) {
      return done(error?.name === 'TimeoutError' ? 'timeout' : error instanceof TypeError ? 'offline' : 'error');
    }
    await wait(BUSY_WAIT_MS);
  }
  return done('busy');
}

export const lookupBook = (isbn, options) => ask('lookup', { isbn, v: SHAPE }, cleanAnswer, options);
// null = the search failed; [] = it found nothing
export const searchBooks = (query, options) => ask('search', { q: query }, cleanResults, { timeout: SEARCH_TIMEOUT_MS, ...options });
export const editionOfBook = (id, options) => ask('book', { id }, cleanEdition, options);
