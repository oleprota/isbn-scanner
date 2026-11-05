import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookTitles } from '../src/bookTitles.js';
import { createBookList } from '../src/bookList.js';
import { isbnId, rekeyList } from '../src/bookId.js';
import fixtures from './fixtures/isbns.json' with { type: 'json' };

const [A, B] = fixtures.found.map((b) => b.isbn);
const spy = (initial) => {
  let list = initial;
  const store = { writes: 0, read: () => list, write: (next) => { store.writes++; list = next; } };
  return store;
};
const row = (isbn, title, extra = {}) => ({ isbn, title, addedAt: '2026-01-01T00:00:00.000Z', ...extra });

function legacy() {
  const stores = {
    scanned: spy([row(B, 'ISBN ' + B), row(A, 'Old A')]),
    marked: spy([row(A, 'Old A')]),
    names: spy([{ isbn: A, name: 'Mine' }]),
    foundBy: spy([{ isbn: B, title: 'Picked B', author: 'X' }]),
    details: spy([{ isbn: B, title: 'Found B', image: '', series: null, author: null, rating: { value: 4.5, count: 500 }, v: 5 }]),
  };
  const lists = { scanned: createBookList(stores.scanned), marked: createBookList(stores.marked) };
  const titles = createBookTitles({ names: stores.names, foundBy: stores.foundBy, details: stores.details, lists: [lists.scanned, lists.marked] });
  return { stores, ...lists, titles };
}

test('storage saved before ids reads with derived ids and writes nothing back', () => {
  const { stores, scanned, marked, titles } = legacy();
  assert.deepEqual(scanned.list().map((e) => e.id), [isbnId(B), isbnId(A)]);
  assert.equal(marked.list()[0].id, isbnId(A));
  assert.equal(titles.of(A), 'Mine');
  assert.equal(titles.of(B), 'Found B');
  assert.equal(titles.foundBy(B).id, isbnId(B));
  assert.equal(titles.details(B).id, isbnId(B));
  assert.equal(titles.ratings().get(B), 4.5);
  assert.equal(titles.allFoundBy().get(B).title, 'Picked B');
  assert.equal(Object.values(stores).reduce((n, s) => n + s.writes, 0), 0);
  assert.equal(stores.scanned.read()[0].id, undefined);
});

test('details saved partial are told apart from current ones', () => {
  const { titles } = legacy();
  titles.setDetails(A, { title: 'T', image: '', series: null, author: null, rating: null }, { partial: true });
  assert.equal(titles.detailsPartial(A), true);
  assert.equal(titles.detailsCurrent(A), false);
  titles.setDetails(A, { title: 'T', image: '', series: null, author: null, rating: null });
  assert.equal(titles.detailsPartial(A), false);
  assert.equal(titles.detailsCurrent(A), true);
  assert.equal(titles.detailsCurrent(B), true); // legacy v5 details without `partial` are current
});

test('rekey turns isbn:X into gr:N and merges a duplicate, keeping the star, the name and the older position', () => {
  const { scanned, marked, titles, stores } = legacy();
  // the same book already known as gr:7, newer in Scanned, starred only there
  stores.scanned.write([{ id: 'gr:7', title: 'GR', addedAt: 'x' }, row(B, 'ISBN ' + B), row(A, 'Old A')]);
  stores.marked.write([{ id: 'gr:7', title: 'GR', addedAt: 'x' }]);
  titles.rekey(isbnId(A), 'gr:7');
  assert.deepEqual(scanned.list().map((e) => e.id), [isbnId(B), 'gr:7']);
  assert.equal(scanned.list()[1].isbn, A);
  assert.deepEqual(marked.list().map((e) => e.id), ['gr:7']);
  assert.equal(stores.names.read()[0].id, 'gr:7');
  assert.equal(stores.names.read()[0].name, 'Mine');
});

test('rekey without a duplicate renames in place; different Goodreads ids stay separate', () => {
  const list = [row(B, 'b'), row(A, 'a')];
  assert.deepEqual(rekeyList(list, isbnId(A), 'gr:1').map((e) => e.id), [isbnId(B), 'gr:1']);
  assert.equal(rekeyList([{ id: 'gr:1', title: 'a' }, { id: 'gr:2', title: 'b' }], 'gr:1', 'gr:2'), null);
  assert.equal(rekeyList(list, isbnId(A), 'isbn:other'), null);
  assert.equal(rekeyList(list, 'isbn:missing', 'gr:1'), null);
});
