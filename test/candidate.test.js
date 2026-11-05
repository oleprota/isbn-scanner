import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateId, detailsFromCandidate } from '../src/candidate.js';
import { createBookTitles } from '../src/bookTitles.js';
import { createBookList } from '../src/bookList.js';
import { isbnLinks } from '../src/links.js';
import { copyText } from '../src/copyText.js';
import { sortBooks } from '../src/sort.js';
import fixtures from './fixtures/isbns.json' with { type: 'json' };

const [A] = fixtures.found.map((b) => b.isbn);
const memory = (initial = []) => {
  let list = initial;
  return { read: () => list, write: (next) => { list = next; } };
};
const candidate = { id: '4588', title: 'Хірург', author: 'Tess Gerritsen', image: 'https://i.gr-assets.com/a.jpg', rating: 4.1, ratingCount: 1234, bookUrl: 'https://www.goodreads.com/book/show/4588', authorUrl: 'https://www.goodreads.com/author/show/1' };

function setup() {
  const scanned = createBookList(memory());
  const marked = createBookList(memory());
  const titles = createBookTitles({ names: memory(), foundBy: memory(), details: memory(), lists: [scanned, marked] });
  return { scanned, marked, titles };
}

test('a candidate gives partial details, with the series read from its title and no rating when it has no count', () => {
  assert.equal(candidateId(candidate), 'gr:4588');
  assert.deepEqual(detailsFromCandidate(candidate), {
    title: 'Хірург', image: candidate.image, series: null,
    author: { name: 'Tess Gerritsen', url: candidate.authorUrl }, rating: { value: 4.1, count: 1234 },
  });
  const series = detailsFromCandidate({ ...candidate, title: 'Dune (Dune, #1)', ratingCount: 0, author: '' });
  assert.deepEqual([series.title, series.series, series.rating, series.author], ['Dune', { name: 'Dune', number: '1' }, null, null]);
});

test('a book with no ISBN is listed, starred, named and sorted by its id', () => {
  const { scanned, marked, titles } = setup();
  const id = candidateId(candidate);
  titles.setFoundBy(id, { title: candidate.title, author: candidate.author, url: candidate.bookUrl });
  titles.setDetails(id, detailsFromCandidate(candidate), { partial: true });
  assert.equal(titles.of(id), 'Хірург');
  assert.equal(scanned.bump({ id, title: titles.of(id) }), true);
  assert.equal(marked.add({ id, title: 'Хірург' }), true);
  assert.deepEqual(scanned.list().map((b) => [b.id, b.isbn]), [[id, undefined]]);
  assert.equal(marked.has(id), true);
  assert.equal(titles.ratings().get(id), 4.1);
  assert.equal(titles.detailsCurrent(id), false);
  assert.equal(titles.rename(id, 'Моя'), 'Моя');
  assert.equal(scanned.list()[0].title, 'Моя');
  assert.equal(titles.rename(id, ''), 'Хірург');
  // the sort sees it by id, in both orders
  const ctx = { ratingOf: (k) => titles.ratings().get(k) ?? 0, isWaiting: () => false };
  const books = [{ id: 'isbn:1', title: 'Яблуко' }, { id, title: 'Хірург' }];
  assert.deepEqual(sortBooks(books, 'rating', ctx).map((b) => b.id), [id, 'isbn:1']);
  assert.deepEqual(sortBooks(books, 'name', ctx).map((b) => b.id), [id, 'isbn:1']);
});

test('the edition answer replaces the partial details, keeps the ISBN and merges a book scanned by that ISBN', () => {
  const { scanned, titles } = setup();
  const id = candidateId(candidate);
  scanned.bump({ isbn: A, title: `ISBN ${A}` });
  scanned.bump({ id, title: 'Хірург' });
  titles.setDetails(id, detailsFromCandidate(candidate), { partial: true });
  titles.rekey(`isbn:${A}`, id);
  titles.setDetails(id, { ...detailsFromCandidate(candidate), series: { name: 'Rizzoli & Isles', number: '1' } }, { isbn: A });
  assert.deepEqual(scanned.list().map((b) => b.id), [id]);
  assert.equal(titles.detailsCurrent(id), true);
  assert.equal(titles.details(id).isbn, A);
  assert.equal(titles.details(id).series.name, 'Rizzoli & Isles');
});

test('links: a book with no ISBN links Ereadian by title and Goodreads by its page; without a page address, by title and author', () => {
  const [ereadian, goodreads] = isbnLinks(undefined, { id: 'gr:1', title: 'Хірург', author: 'T', url: 'https://www.goodreads.com/book/show/4588' });
  assert.equal(ereadian.url, 'https://ereadian.com/search?q=%D0%A5%D1%96%D1%80%D1%83%D1%80%D0%B3');
  assert.equal(goodreads.url, 'https://www.goodreads.com/book/show/4588');
  assert.equal(isbnLinks(undefined, { title: 'Хірург', author: 'T' })[1].url, 'https://www.goodreads.com/search?q=%D0%A5%D1%96%D1%80%D1%83%D1%80%D0%B3%20T');
  assert.equal(isbnLinks(A)[1].url, `https://www.goodreads.com/book/isbn/${A}`); // the ISBN-only call is unchanged
});

test('Copy writes a book with no ISBN with its author, rating and the page links', () => {
  const book = { id: 'gr:4588', title: 'Хірург' };
  const text = copyText([book], (b) => (b === book ? { author: 'Tess Gerritsen', rating: { value: 4.1, count: 1234 }, found: { title: 'Хірург', author: 'Tess Gerritsen', url: 'https://www.goodreads.com/book/show/4588' } } : {}));
  assert.deepEqual(text.split('\n').slice(1), ['https://ereadian.com/search?q=Хірург', 'https://www.goodreads.com/book/show/4588']);
  assert.match(text.split('\n')[0], /^Tess Gerritsen, Хірург ★ 4\.10/);
});
