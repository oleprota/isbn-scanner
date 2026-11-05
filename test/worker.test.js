import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../worker/index.js';

const ISBN = '9786171299412'; // valid; see test/fixtures/isbns.json for more
const ORIGIN = 'https://oleprota.github.io';
const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Book', name: 'Title', image: 'https://m.media-amazon.com/a.jpg', author: [{ name: 'A', url: 'https://www.goodreads.com/author/show/1.A' }], aggregateRating: { ratingValue: 4.5, ratingCount: 10 } })}</script>`;

function memoryCache() {
  const map = new Map();
  return {
    match: async (request) => map.get(request.url)?.clone(),
    put: async (request, response) => { map.set(request.url, response); },
  };
}

function setup(respond) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    return respond(url);
  };
  const handle = createHandler({ fetchFn, cache: memoryCache(), wait: async () => {} });
  const get = (query, headers = { origin: ORIGIN }, env) =>
    handle(new Request(`https://worker.test/lookup${query}`, { headers }), env);
  const request = (path, headers = { origin: ORIGIN }, env) => handle(new Request(`https://worker.test${path}`, { headers }), env);
  return { calls, get, request };
}

const goodreads = (body = html, status = 200) => () => Object.defineProperty(new Response(body, { status }), 'url', { value: 'https://www.goodreads.com/book/show/1' });

test('returns the book and allows the app origin', async () => {
  const { get, calls } = setup(goodreads());
  const response = await get(`?isbn=${ISBN}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  assert.deepEqual(await response.json(), { title: 'Title', series: null, author: { name: 'A', url: 'https://www.goodreads.com/author/show/1.A' }, rating: { value: 4.5, count: 10 }, image: 'https://m.media-amazon.com/a.jpg', bookId: '1' });
  assert.deepEqual(calls, [`https://www.goodreads.com/book/isbn/${ISBN}`]);
});

test('accepts a hyphenated ISBN and rejects invalid ones without asking Goodreads', async () => {
  const { get, calls } = setup(goodreads());
  assert.equal((await get('?isbn=978-617-129-941-2')).status, 200);
  assert.equal((await get('?isbn=9786171299413')).status, 400);
  assert.equal((await get('')).status, 400);
  assert.equal(calls.length, 1);
});

test('refuses other origins, answers the preflight, only serves GET', async () => {
  const { get, calls } = setup(goodreads());
  assert.equal((await get(`?isbn=${ISBN}`, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await get(`?isbn=${ISBN}`, { origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })).status, 403);
  assert.equal(calls.length, 0);
  const extension = await get(`?isbn=${ISBN}`, { origin: 'chrome-extension://pklepflaloonoobdekhhkhllcclcgipm' });
  assert.equal(extension.status, 200);
  assert.equal(extension.headers.get('access-control-allow-origin'), 'chrome-extension://pklepflaloonoobdekhhkhllcclcgipm');
  const handle = createHandler({ fetchFn: goodreads(), cache: memoryCache() });
  const preflight = await handle(new Request('https://worker.test/lookup', { method: 'OPTIONS', headers: { origin: 'http://localhost:8000' } }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:8000');
  assert.equal((await handle(new Request('https://worker.test/other'))).status, 404);
});

test('an empty 202, an error status, a page without the block or a failure is 404 with the reason', async () => {
  const cases = [[goodreads('', 202), 'status 202', 'page-empty'], [goodreads('x', 500), 'status 500', 'page-down'], [goodreads('x', 403), 'status 403', 'page-refused'], [goodreads('x', 429), 'status 429', 'page-refused'],
    [goodreads('<html></html>'), 'no book data in page', 'page-no-book'], [() => { throw new Error('offline'); }, 'timeout or network error', 'page-down'], [goodreads('', 404), 'status 404', 'page-404']];
  for (const [respond, reason, why] of cases) {
    const { get } = setup(respond);
    const response = await get(`?isbn=${ISBN}`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { reason: why });
    assert.equal(response.headers.get('x-miss-reason'), reason);
  }
});

test('a 202 is asked again, and the full page that follows is the answer', async () => {
  const answers = [goodreads('', 202), goodreads('', 202), goodreads()];
  const { get, calls } = setup(() => answers.shift()());
  const response = await get(`?isbn=${ISBN}`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).title, 'Title');
  assert.equal(calls.length, 3);
});

test('a 202 that never ends is given up after RETRY_202_TRIES tries', async () => {
  const { get, calls } = setup(goodreads('', 202));
  assert.equal((await get(`?isbn=${ISBN}`)).status, 404);
  assert.equal(calls.length, 3);
});

test('only a real 404 is remembered for a day; doubtful misses are asked again after a minute', async () => {
  const day = await setup(goodreads('', 404)).get(`?isbn=${ISBN}`);
  assert.equal(day.status, 404);
  assert.equal(day.headers.get('cache-control'), 'public, max-age=86400');
  for (const respond of [goodreads('', 202), goodreads('x', 500), goodreads('<html></html>')]) {
    const unsure = await setup(respond).get(`?isbn=${ISBN}`);
    assert.equal(unsure.headers.get('cache-control'), 'public, max-age=60');
  }
});

test('answers (found or not) are cached: Goodreads is asked once per ISBN', async () => {
  for (const respond of [goodreads(), goodreads('', 404)]) {
    const { get, calls } = setup(respond);
    const first = await get(`?isbn=${ISBN}`);
    const second = await get(`?isbn=${ISBN}`, { origin: 'http://localhost:8000' });
    assert.equal(second.status, first.status);
    assert.equal(second.headers.get('access-control-allow-origin'), 'http://localhost:8000');
    assert.equal(calls.length, 1);
  }
});

test('the rate limiter stops requests that are not in the cache', async () => {
  const { get, calls } = setup(goodreads());
  const env = { LIMITER: { limit: async () => ({ success: false }) } };
  assert.equal((await get(`?isbn=${ISBN}`, undefined, env)).status, 429);
  assert.equal(calls.length, 0);
});

test('cache bypass: ?nocache=1 asks Goodreads every time on every path, leaves the cache alone, and sends no-store', async () => {
  for (const path of [`/lookup?isbn=${ISBN}`, '/book?id=1', '/search?q=abc']) {
    const { request, calls } = setup(path.startsWith('/search') ? () => new Response('[]') : goodreads());
    const first = await request(`${path}&nocache=1`);
    await request(`${path}&nocache=1`);
    assert.equal(first.headers.get('cache-control'), 'no-store', path);
    const bypassed = calls.length;
    assert.ok(bypassed >= 2, path);
    await request(path); // nothing was written, so a normal request still asks Goodreads
    assert.ok(calls.length > bypassed, path);
    const normal = calls.length;
    const again = await request(path); // now it is cached
    assert.equal(calls.length, normal, path);
    assert.notEqual(again.headers.get('cache-control'), 'no-store', path);
  }
});

test('cache bypass: a bypassed request does not read or change cached answers', async () => {
  const { request, calls } = setup(goodreads());
  await request(`/lookup?isbn=${ISBN}`);
  await request(`/lookup?isbn=${ISBN}&nocache=1`);
  assert.equal(calls.length, 2);
  await request(`/lookup?isbn=${ISBN}`);
  assert.equal(calls.length, 2);
});

test('cache bypass: any other nocache value is a normal request', async () => {
  for (const query of ['', '&nocache=', '&nocache=0', '&nocache=x']) {
    const { request, calls } = setup(goodreads());
    const first = await request(`/lookup?isbn=${ISBN}${query}`);
    await request(`/lookup?isbn=${ISBN}${query}`);
    assert.equal(calls.length, 1, query);
    assert.notEqual(first.headers.get('cache-control'), 'no-store', query);
  }
});

test('cache bypass: the rate limiter still stops a bypassed request', async () => {
  const { request, calls } = setup(goodreads());
  const env = { LIMITER: { limit: async () => ({ success: false }) } };
  assert.equal((await request(`/lookup?isbn=${ISBN}&nocache=1`, undefined, env)).status, 429);
  assert.equal(calls.length, 0);
});

const hit = (extra = {}) => ({ bookId: '32740697', bookTitleBare: 'Хірург', title: 'Хірург (Rizzoli & Isles #1)', imageUrl: 'https://i.gr-assets.com/a.jpg', avgRating: '4.10', ratingsCount: '1,234', bookUrl: '/book/show/32740697', author: { name: 'Tess Gerritsen', profileUrl: 'https://www.goodreads.com/author/show/1' }, ...extra });
const suggestions = (list) => () => new Response(JSON.stringify(list));

test('/search answers up to 5 cleaned candidates, from the search-as-you-type JSON', async () => {
  const { request, calls } = setup(suggestions([hit(), hit({ bookId: 'x' }), hit({ imageUrl: 'http://x/a.jpg', avgRating: '0.00', bookId: '2' }), ...Array.from({ length: 6 }, (_, i) => hit({ bookId: String(10 + i) }))]));
  const response = await request('/search?q=%20%D0%A5%D1%96%D1%80%D1%83%D1%80%D0%B3%20');
  assert.equal(response.status, 200);
  const { results } = await response.json();
  assert.equal(results.length, 5);
  assert.deepEqual(results[0], { id: '32740697', title: 'Хірург', author: 'Tess Gerritsen', image: 'https://i.gr-assets.com/a.jpg', rating: 4.1, ratingCount: 1234, bookUrl: 'https://www.goodreads.com/book/show/32740697', authorUrl: 'https://www.goodreads.com/author/show/1' });
  assert.deepEqual(results[1], { id: '2', title: 'Хірург', author: 'Tess Gerritsen', image: '', rating: 0, ratingCount: 1234, bookUrl: 'https://www.goodreads.com/book/show/32740697', authorUrl: 'https://www.goodreads.com/author/show/1' }); // 'x' is no id: dropped; the http cover is cleaned
  assert.equal(calls[0], 'https://www.goodreads.com/book/auto_complete?format=json&q=%D0%A5%D1%96%D1%80%D1%83%D1%80%D0%B3');
});

test('/search drops addresses that are not Goodreads', async () => {
  const { request } = setup(suggestions([hit({ bookUrl: 'https://evil.example/book/show/1', author: { name: 'T', profileUrl: 'javascript:x' } })]));
  const [first] = (await (await request('/search?q=foreign')).json()).results;
  assert.equal(first.bookUrl, '');
  assert.equal(first.authorUrl, '');
});

test('/search rejects a missing or one-letter query, and says 502 when Goodreads fails; both are cached short or not at all', async () => {
  const { request, calls } = setup(suggestions([]));
  assert.equal((await request('/search')).status, 400);
  assert.equal((await request('/search?q=a')).status, 400);
  assert.equal(calls.length, 0);
  const empty = await request('/search?q=nothing');
  assert.deepEqual(await empty.json(), { results: [] });
  assert.equal(empty.headers.get('cache-control'), 'public, max-age=60');
  for (const respond of [() => new Response('x', { status: 500 }), () => new Response('not json'), () => { throw new Error('offline'); }]) {
    const failed = await setup(respond).request('/search?q=anything');
    assert.equal(failed.status, 502);
  }
});

test('/search answers are cached per query, ignoring case and spaces', async () => {
  const { request, calls } = setup(suggestions([hit()]));
  const first = await request('/search?q=Хірург');
  assert.equal(first.headers.get('cache-control'), 'public, max-age=86400');
  await request('/search?q=%20хірург%20');
  assert.equal(calls.length, 1);
});

const edition = (isbn) => goodreads(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Book', name: 'Хірург', isbn })}</script>`);

test('/book answers the ISBN of that Goodreads edition, with its details', async () => {
  const { request, calls } = setup(edition('9786171299412'));
  const response = await request('/book?id=32740697');
  assert.deepEqual(await response.json(), { isbn: '9786171299412', title: 'Хірург', series: null, author: null, rating: null, image: '' });
  assert.deepEqual(calls, ['https://www.goodreads.com/book/show/32740697']);
});

test('/book rejects a bad id, and is 404 when the edition has no valid ISBN', async () => {
  const { request, calls } = setup(edition('9786171299413'));
  for (const id of ['', 'abc', '1/2', '1234567890123']) assert.equal((await request(`/book?id=${id}`)).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await request('/book?id=1')).status, 404);
  assert.equal((await setup(edition(undefined)).request('/book?id=1')).status, 404);
});

test('/search drops the last words, one at a time, while nothing is found', async () => {
  const asked = [];
  const { request } = setup((url) => {
    const q = decodeURIComponent(new URL(url).searchParams.get('q'));
    asked.push(q);
    return new Response(JSON.stringify(q === 'Асистент' ? [hit({ bookId: '35262362', bookTitleBare: 'Асистент' })] : []));
  });
  const { results } = await (await request(`/search?q=${encodeURIComponent('Асистент Тесс Ґеррітсен')}`)).json();
  assert.deepEqual(asked, ['Асистент Тесс Ґеррітсен', 'Асистент Тесс', 'Асистент']);
  assert.equal(results[0].id, '35262362');
});

test('/search gives up after a few tries, and a failure stops the dropping', async () => {
  const asked = [];
  const { request } = setup((url) => { asked.push(url); return new Response('[]'); });
  const { results } = await (await request('/search?q=a%20b%20c%20d%20e%20f')).json();
  assert.deepEqual(results, []);
  assert.equal(asked.length, 3);
  const failing = [];
  const down = await setup((url) => { failing.push(url); return new Response('x', { status: 500 }); }).request('/search?q=a%20b%20c');
  assert.equal(down.status, 502);
  assert.equal(failing.length, 1); // not asked again with fewer words
});

test('each real Goodreads fetch leaves an upstream row, a cache hit a cache_hit row', async () => {
  const handler = createHandler({ fetchFn: goodreads('', 403), cache: memoryCache(), wait: async () => {} });
  const saved = [];
  const env = { DB: { prepare: () => ({ bind: (...args) => args }), batch: async (rows) => saved.push(...rows) } };
  const ctx = { waitUntil: (promise) => promise };
  const handle = (query) => handler(new Request(`https://worker.test/lookup${query}`, { headers: { origin: ORIGIN } }), env, ctx);
  await handle(`?isbn=${ISBN}`);
  await handle(`?isbn=${ISBN}`); // answered from the cache
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(saved.map((row) => row[3]), ['upstream', 'cache_hit']);
  assert.deepEqual([JSON.parse(saved[0][4]).kind, JSON.parse(saved[0][4]).result, JSON.parse(saved[1][4])], ['lookup', 'page-refused', { kind: 'lookup' }]);
  await handler(new Request('https://worker.test/search?q=dune', { headers: { origin: ORIGIN } }), env, ctx);
  assert.deepEqual([saved[2][3], JSON.parse(saved[2][4]).kind, JSON.parse(saved[2][4]).result, JSON.parse(saved[2][4]).tries], ['upstream', 'search', 'failed', 1]);
});

test('/lookup carries the book id of the redirect address, /book does not, and no id is omitted', async () => {
  const at = (url) => () => Object.defineProperty(new Response(html), 'url', { value: url });
  const lookup = await setup(at('https://www.goodreads.com/book/show/4214.Life_of_Pi')).get(`?isbn=${ISBN}`);
  assert.equal((await lookup.json()).bookId, '4214');
  const none = await setup(at('https://www.goodreads.com/search?q=x')).get(`?isbn=${ISBN}`);
  assert.equal('bookId' in (await none.json()), false);
  const book = await setup(at('https://www.goodreads.com/book/show/4214')).request('/book?id=4214');
  assert.equal('bookId' in (await book.json()), false);
});

test('the series link comes after the JSON-LD, tens of KB into the page, and is still read', async () => {
  const link = '<a href="https://www.goodreads.com/series/312023-the-chronicles-of-saylok">The Chronicles of Saylok<!-- --> #1</a><h1 data-testid="bookTitle">';
  const page = (name) => `${html.replace('"Title"', JSON.stringify(name))}${'<div>filler</div>'.repeat(3000)}${link}${'<div>more</div>'.repeat(3000)}`;
  const chunked = (text) => { // a real page arrives in chunks: the JSON-LD is complete in the first one
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 8192) c.enqueue(bytes.slice(i, i + 8192)); c.close(); } });
  };
  const { get } = setup(goodreads(chunked(page('Перша дівчинка. Хроніки Сейлока. Книга 1'))));
  const body = await (await get(`?isbn=${ISBN}`)).json();
  assert.deepEqual([body.title, body.series], ['Перша дівчинка. Хроніки Сейлока. Книга 1', { name: 'The Chronicles of Saylok', number: '1', url: 'https://www.goodreads.com/series/312023-the-chronicles-of-saylok' }]);
});

// One budget for the whole Goodreads page call (all tries and pauses), not a timeout per try.
const withBudget = (fetchFn, budgetMs) => createHandler({ fetchFn, cache: memoryCache(), wait: async () => {}, budgetMs });
const lookup = (handle) => handle(new Request(`https://worker.test/lookup?isbn=${ISBN}`, { headers: { origin: ORIGIN } }));

test('a page that never answers is given up at the budget, as page-down', async () => {
  const hangs = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  const started = Date.now();
  const response = await lookup(withBudget(hangs, 50));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { reason: 'page-down' });
  assert.ok(Date.now() - started < 1000);
});

test('slow empty 202s stop at the budget, before RETRY_202_TRIES', async () => {
  let tries = 0;
  const slow202 = async () => {
    tries++;
    await new Promise((resolve) => setTimeout(resolve, 60));
    return new Response('', { status: 202 });
  };
  const response = await lookup(withBudget(slow202, 100));
  assert.deepEqual(await response.json(), { reason: 'page-empty' });
  assert.ok(tries < 4, `asked ${tries} times`);
});

test('a slow page that answers inside the budget is the answer', async () => {
  const slowPage = async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    return goodreads()();
  };
  assert.equal((await lookup(withBudget(slowPage, 1000))).status, 200);
});
