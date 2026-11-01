import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAnswer, editionOfBook, lookupBook, searchBooks, setNoCache } from '../src/lookup.js';

const URL_ = 'https://lookup.example';
const answer = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });

test('does nothing without a service address', async () => {
  let asked = false;
  assert.equal(await lookupBook('1', { url: '', fetchFn: async () => { asked = true; } }), null);
  assert.equal(asked, false);
});

const full = {
  title: '  Шлях   королів ',
  image: 'https://m.media-amazon.com/a.jpg',
  series: { name: 'Хроніки Буресвітла', number: '1' },
  author: { name: 'Brandon Sanderson', url: 'https://www.goodreads.com/author/show/38550.Brandon_Sanderson' },
  rating: { value: 4.66, count: 734385 },
};

test('returns the cleaned answer and asks for the ISBN', async () => {
  let requested;
  const found = await lookupBook('9786171299412', {
    url: URL_,
    fetchFn: async (url) => { requested = url; return answer(full)(); },
  });
  assert.deepEqual(found, { ...full, title: 'Шлях королів' });
  assert.equal(requested, `${URL_}/lookup?isbn=9786171299412&v=6`);
});

test('an answer with only a title is fine; missing parts are empty', async () => {
  assert.deepEqual(await lookupBook('1', { url: URL_, fetchFn: answer({ title: 'Only' }) }), { title: 'Only', image: '', series: null, author: null, rating: null });
});

test('every field is checked: long text cut, bad cover, bad author link and bad rating dropped', async () => {
  const found = await lookupBook('1', {
    url: URL_,
    fetchFn: answer({ title: 'x'.repeat(300), image: 'javascript:alert(1)', series: { name: 's'.repeat(200), number: 5 }, author: { name: 'A', url: 'javascript:alert(1)' }, rating: { value: 7, count: 3 } }),
  });
  assert.equal(found.title.length, 120);
  assert.equal(found.image, '');
  assert.equal(found.series.name.length, 80);
  assert.equal(found.series.number, '');
  assert.deepEqual(found.author, { name: 'A', url: '' });
  assert.equal(found.rating, null);
  assert.equal(cleanAnswer({ title: 'T', rating: { value: 4, count: 2.5 } }).rating, null);
});

test('every failure is null and never throws', async () => {
  const cases = [answer({}, 404), answer({ title: '' }), answer({ title: 5 }), answer(null), async () => new Response('<html>', { status: 200 }), async () => { throw new Error('offline'); }];
  for (const fetchFn of cases) assert.equal(await lookupBook('1', { url: URL_, fetchFn }), null);
});

test('a 429 waits and asks again, then gives up after a few tries', async () => {
  let calls = 0;
  const waits = [];
  const wait = async (ms) => waits.push(ms);
  const busyOnce = async () => (++calls === 1 ? new Response('{}', { status: 429 }) : answer({ title: 'Late' })());
  assert.equal((await lookupBook('1', { url: URL_, fetchFn: busyOnce, wait })).title, 'Late');
  assert.equal(waits.length, 1);

  calls = 0;
  assert.equal(await lookupBook('1', { url: URL_, fetchFn: async () => { calls++; return new Response('{}', { status: 429 }); }, wait }), null);
  assert.equal(calls, 4);
});

test('a title search asks /search and cleans every candidate; a failure is null, no hits is []', async () => {
  let requested;
  const fetchFn = async (url) => { requested = url; return answer({ results: [{ id: '32740697', title: ' Хірург ', author: 'Tess', image: 'javascript:x' }, { id: 'x', title: 'No id' }, { id: '1', title: '' }] })(); };
  assert.deepEqual(await searchBooks('Хірург Тесс', { url: URL_, fetchFn }), [{ id: '32740697', title: 'Хірург', author: 'Tess', image: '' }]);
  assert.equal(requested, `${URL_}/search?q=%D0%A5%D1%96%D1%80%D1%83%D1%80%D0%B3+%D0%A2%D0%B5%D1%81%D1%81`);
  assert.deepEqual(await searchBooks('x', { url: URL_, fetchFn: answer({ results: [] }) }), []);
  for (const fetchFn of [answer({}, 502), answer({ nope: 1 }), async () => { throw new Error('offline'); }]) assert.equal(await searchBooks('x', { url: URL_, fetchFn }), null);
});

test('the ISBN of a picked book is asked from /book and checked', async () => {
  let requested;
  assert.deepEqual(await editionOfBook('32740697', { url: URL_, fetchFn: async (url) => { requested = url; return answer({ isbn: '978-617-129-941-2', title: ' Хірург ', author: { name: 'Tess' }, rating: { value: 4.1, count: 3 } })(); } }), { isbn: '9786171299412', found: { title: 'Хірург', image: '', series: null, author: { name: 'Tess', url: '' }, rating: { value: 4.1, count: 3 } } });
  assert.equal((await editionOfBook('1', { url: URL_, fetchFn: answer({ isbn: '9786171299412' }) })).found, null); // an ISBN without details
  assert.equal(requested, `${URL_}/book?id=32740697`);
  for (const body of [{ isbn: '9786171299413', title: 'T' }, { isbn: 5 }, {}]) assert.equal(await editionOfBook('1', { url: URL_, fetchFn: answer(body) }), null);
  assert.equal(await editionOfBook('1', { url: URL_, fetchFn: answer({}, 404) }), null);
});

test('gives up after the timeout', async () => {
  const slow = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  assert.equal(await lookupBook('1', { url: URL_, fetchFn: slow, timeout: 20 }), null);
});

test('report tells how a request ended', async () => {
  const outcome = async (fetchFn, parse = lookupBook) => {
    const seen = [];
    await parse('9786171299412', { url: URL_, fetchFn, wait: async () => {}, report: (result, ms) => seen.push([result, typeof ms]) });
    return seen;
  };
  assert.deepEqual(await outcome(async () => new Response(JSON.stringify({ title: 'T' }))), [['found', 'number']]);
  assert.deepEqual(await outcome(async () => new Response(JSON.stringify({}))), [['invalid', 'number']]);
  assert.deepEqual(await outcome(async () => new Response('{}', { status: 404 })), [['missing', 'number']]);
  assert.deepEqual(await outcome(async () => new Response('{}', { status: 502 })), [['error', 'number']]);
  assert.deepEqual(await outcome(async () => new Response('{}', { status: 429 })), [['busy', 'number']]);
  assert.deepEqual(await outcome(async () => { throw new TypeError('Failed to fetch'); }), [['offline', 'number']]);
  assert.deepEqual(await outcome(async () => { throw new DOMException('slow', 'TimeoutError'); }), [['timeout', 'number']]);
});

test('setNoCache adds nocache=1 to requests until switched off', async () => {
  const urls = [];
  const fetchFn = async (u) => (urls.push(u), { ok: false, status: 404 });
  setNoCache(true);
  await lookupBook('1', { url: 'https://w', fetchFn });
  setNoCache(false);
  await lookupBook('1', { url: 'https://w', fetchFn });
  assert.match(urls[0], /nocache=1/);
  assert.doesNotMatch(urls[1], /nocache/);
});
