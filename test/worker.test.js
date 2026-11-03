import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.deepEqual(await response.json(), { title: 'Title', series: null, author: { name: 'A', url: 'https://www.goodreads.com/author/show/1.A' }, rating: { value: 4.5, count: 10 }, image: 'https://m.media-amazon.com/a.jpg' });
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

test('an empty 202, an error status, a page without the block or a failure is 404 {} with the reason', async () => {
  const cases = [[goodreads('', 202), 'status 202'], [goodreads('x', 500), 'status 500'], [goodreads('<html></html>'), 'no book data in page'], [() => { throw new Error('offline'); }, 'timeout or network error']];
  for (const [respond, reason] of cases) {
    const { get } = setup(respond);
    const response = await get(`?isbn=${ISBN}`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {});
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
  assert.equal(calls.length, 4);
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

const hit = (extra = {}) => ({ bookId: '32740697', bookTitleBare: 'Хірург', title: 'Хірург (Rizzoli & Isles #1)', imageUrl: 'https://i.gr-assets.com/a.jpg', avgRating: '4.10', author: { name: 'Tess Gerritsen' }, ...extra });
const suggestions = (list) => () => new Response(JSON.stringify(list));

test('/search answers up to 5 cleaned candidates, from the search-as-you-type JSON', async () => {
  const { request, calls } = setup(suggestions([hit(), hit({ bookId: 'x' }), hit({ imageUrl: 'http://x/a.jpg', avgRating: '0.00', bookId: '2' }), ...Array.from({ length: 6 }, (_, i) => hit({ bookId: String(10 + i) }))]));
  const response = await request('/search?q=%20%D0%A5%D1%96%D1%80%D1%83%D1%80%D0%B3%20');
  assert.equal(response.status, 200);
  const { results } = await response.json();
  assert.equal(results.length, 5);
  assert.deepEqual(results[0], { id: '32740697', title: 'Хірург', author: 'Tess Gerritsen', image: 'https://i.gr-assets.com/a.jpg' });
  assert.deepEqual(results[1], { id: '2', title: 'Хірург', author: 'Tess Gerritsen', image: '' }); // 'x' is no id: dropped; the http cover is cleaned
  assert.equal(calls[0], 'https://www.goodreads.com/book/auto_complete?format=json&q=%D0%A5%D1%96%D1%80%D1%83%D1%80%D0%B3');
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
  assert.equal(asked.length, 4);
  const failing = [];
  const down = await setup((url) => { failing.push(url); return new Response('x', { status: 500 }); }).request('/search?q=a%20b%20c');
  assert.equal(down.status, 502);
  assert.equal(failing.length, 1); // not asked again with fewer words
});

// --- the original of a translation (issue #9) ---
const translated = readFileSync(new URL('./fixtures/goodreads-translated.html', import.meta.url), 'utf8'); // a real page's excerpt
const stateOf = (original, own = 'Own') => `${html.replace('"Title"', JSON.stringify(own))}<script>{"shelvesUrl":"https://www.goodreads.com/work/shelves/111-x","originalTitle":${JSON.stringify(original)},"x":1}</script>`;
const WORK = '111';

test('the first answer never carries the original (it is asked for on request)', async () => {
  for (const page of [html, translated, stateOf('Orig')]) {
    const body = await (await setup(goodreads(page)).get(`?isbn=${ISBN}`)).json();
    assert.equal('original' in body, false, page.slice(0, 80));
  }
});

const found = (extra = {}) => hit({ bookId: '77', workId: '999', bookTitleBare: 'The Way of Kings', avgRating: '4.65', ratingsCount: 90, author: { name: 'A' }, ...extra });
// the page of the translation, then the search
const original = (hits) => (url) => (url.includes('auto_complete') ? suggestions(hits)() : goodreads(stateOf('Orig'))());

test('/lookup&original=1 answers the original: name, rating and Goodreads link; the author must match exactly', async () => {
  const { get, calls } = setup(original([found({ bookId: '5', author: { name: 'A B' } }), found()]));
  const response = await get(`?isbn=${ISBN}&original=1`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { original: { title: 'The Way of Kings', author: 'A', rating: { value: 4.65, count: 90 }, image: 'https://i.gr-assets.com/a.jpg', url: 'https://www.goodreads.com/book/show/77' } });
  assert.ok(calls[1].startsWith('https://www.goodreads.com/book/auto_complete?format=json&q=Orig%20A'));
});

test('/lookup&original=1 answers the translation own work too, even with an unrelated duplicate by the same author', async () => {
  const { get } = setup(original([found({ bookId: '8', workId: '1000', ratingsCount: 4 }), found({ workId: WORK })]));
  assert.equal((await (await get(`?isbn=${ISBN}&original=1`)).json()).original.url, 'https://www.goodreads.com/book/show/77');
});

test('/lookup&original=1 is 404 and says why: no hint, no hits, other author, two different works, Goodreads empty or failing', async () => {
  const empty = new Response('', { status: 202 });
  const cases = [
    [goodreads(), 'no-original'],
    [original([]), 'not-found'],
    [original([found({ author: { name: 'Other' } })]), 'not-found'],
    [original([found(), found({ workId: '1000' })]), 'not-found'],
    [(url) => (url.includes('auto_complete') ? new Response('', { status: 500 }) : goodreads(stateOf('Orig'))()), 'unavailable'],
    [() => empty.clone(), 'unavailable'],
    [() => { throw new TypeError('network'); }, 'unavailable'],
  ];
  for (const [respond, reason] of cases) {
    const response = await setup(respond).get(`?isbn=${ISBN}&original=1`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { reason });
  }
});

test('/lookup&original=1 never trusts an empty work id: no "same", no ambiguity passing on empty ids', async () => {
  const noWork = stateOf('Orig').replace('work/shelves/111-x', 'work/x');
  const cases = [
    (url) => (url.includes('auto_complete') ? suggestions([found({ workId: '' })])() : goodreads(noWork)()),
    (url) => (url.includes('auto_complete') ? suggestions([found({ workId: '' })])() : goodreads(stateOf('Orig'))()),
    original([found({ workId: '' }), found({ workId: '' })]),
  ];
  for (const respond of cases) assert.equal((await setup(respond).get(`?isbn=${ISBN}&original=1`)).status, 404);
});

test('the original title is found when the page comes in tiny chunks (marker, </script>, long escaped title cut by edges)', async () => {
  const long = '\\u0436'.repeat(200); // 1200 characters as escapes
  const page = stateOf('Orig').replace('"originalTitle":"Orig"', `"originalTitle":"${long}"`);
  const bytes = new TextEncoder().encode(page + '<p>x</p>'.repeat(5000));
  let at = 0;
  const body = new ReadableStream({ pull(c) { if (at >= bytes.length) return c.close(); c.enqueue(bytes.slice(at, at + 13)); at += 13; } });
  const respond = (url) => (url.includes('auto_complete') ? suggestions([found()])() : Object.defineProperty(new Response(body), 'url', { value: 'https://www.goodreads.com/book/show/1' }));
  const response = await setup(respond).get(`?isbn=${ISBN}&original=1`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).original.title, 'The Way of Kings');
  assert.ok(at < page.length + 200, 'reading stopped at the title, not at the end of the page');
});

test('the original is cached on its own, apart from the first answer', async () => {
  const { get, calls } = setup(original([found()]));
  await get(`?isbn=${ISBN}&original=1`);
  const asked = calls.length;
  await get(`?isbn=${ISBN}&original=1`);
  assert.equal(calls.length, asked);
  await get(`?isbn=${ISBN}`); // the first answer is its own entry
  assert.ok(calls.length > asked);
});
