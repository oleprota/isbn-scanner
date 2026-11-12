import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookList } from '../src/bookList.js';

function memoryStore(initial = []) {
  let list = initial;
  return { read: () => list, write: (next) => { list = next; } };
}

const matilda = { isbn: '9780141365466', title: 'Matilda' };
const potter = { isbn: '9780747532699', title: 'ISBN 9780747532699' };

test('adds books newest first and records when', () => {
  const marked = createBookList(memoryStore());
  assert.equal(marked.add(matilda, new Date('2026-10-23T10:00:00Z')), true);
  assert.equal(marked.add(potter, new Date('2026-10-23T11:00:00Z')), true);
  assert.deepEqual(marked.list().map((b) => b.isbn), [potter.isbn, matilda.isbn]);
  assert.equal(marked.list()[1].addedAt, '2026-10-23T10:00:00.000Z');
});

test('refuses a duplicate ISBN', () => {
  const marked = createBookList(memoryStore());
  marked.add(matilda);
  assert.equal(marked.add({ ...matilda, title: 'Other' }), false);
  assert.equal(marked.list().length, 1);
  assert.equal(marked.list()[0].title, 'Matilda');
});

test('has, remove and clear', () => {
  const marked = createBookList(memoryStore());
  marked.add(matilda);
  marked.add(potter);
  assert.equal(marked.has(matilda.isbn), true);
  marked.remove(matilda.isbn);
  assert.equal(marked.has(matilda.isbn), false);
  assert.equal(marked.list().length, 1);
  marked.clear();
  assert.deepEqual(marked.list(), []);
});

test('ignores malformed stored entries', () => {
  const marked = createBookList(memoryStore([null, { isbn: 1 }, { isbn: '1', title: 'Ok', authors: [] }]));
  assert.deepEqual(marked.list().map((b) => b.isbn), ['1']);
});

test('rename changes the title of a marked book and ignores others', () => {
  const marked = createBookList(memoryStore());
  marked.add(matilda);
  marked.add(potter);
  marked.rename(matilda.isbn, 'My Matilda');
  marked.rename('0000000000', 'Nobody');
  assert.deepEqual(marked.list().map((b) => b.title), [potter.title, 'My Matilda']);
});

test('bump adds a new book at the top, and moves an existing one up with its new title', () => {
  const list = createBookList(memoryStore());
  list.add(matilda, new Date('2026-10-23T10:00:00Z'));
  list.add(potter, new Date('2026-10-23T11:00:00Z'));
  list.bump({ isbn: matilda.isbn, title: 'Matilda!' });
  assert.deepEqual(list.list().map((b) => [b.isbn, b.title]), [[matilda.isbn, 'Matilda!'], [potter.isbn, potter.title]]);
  assert.equal(list.list()[0].addedAt, '2026-10-23T10:00:00.000Z'); // the first-seen time is kept
  list.bump({ isbn: '9780140328721', title: 'Fox' }, new Date('2026-10-24T09:00:00Z'));
  assert.deepEqual(list.list().map((b) => b.isbn), ['9780140328721', matilda.isbn, potter.isbn]);
  assert.equal(list.list()[0].addedAt, '2026-10-24T09:00:00.000Z');
});

test('a full list refuses new books and changes nothing', () => {
  const store = memoryStore();
  const list = createBookList(store, 3);
  for (const n of ['1', '2', '3']) assert.equal(list.add({ isbn: n, title: n }), true);
  assert.equal(list.isFull(), true);
  assert.equal(list.add({ isbn: '4', title: '4' }), false);
  assert.equal(list.bump({ isbn: '4', title: '4' }), false);
  assert.deepEqual(list.list().map((b) => b.isbn), ['3', '2', '1']);
});

test('a full list still moves and renames the books it holds, and has room again after a removal', () => {
  const list = createBookList(memoryStore(), 3);
  for (const n of ['1', '2', '3']) list.add({ isbn: n, title: n });
  assert.equal(list.bump({ isbn: '1', title: 'One' }), true);
  assert.deepEqual(list.list().map((b) => [b.isbn, b.title]), [['1', 'One'], ['3', '3'], ['2', '2']]);
  list.rename('2', 'Two');
  list.remove('3');
  assert.equal(list.isFull(), false);
  assert.equal(list.add({ isbn: '4', title: '4' }), true);
  assert.equal(list.limit, 3);
});

test('the default limit is 1000, and a stored list over the limit is read cut to it', () => {
  const stored = Array.from({ length: 5 }, (_, i) => ({ isbn: String(i), title: 'x' }));
  assert.equal(createBookList(memoryStore(stored), 2).list().length, 2);
  assert.equal(createBookList(memoryStore(stored)).limit, 1000);
});

test('reorder gives each book a rank; books left out go after the others', () => {
  const books = createBookList(memoryStore());
  books.add(matilda);
  books.add(potter);
  books.reorder([matilda.isbn].map((k) => `isbn:${k}`));
  const byId = Object.fromEntries(books.list().map((b) => [b.id, b.rank]));
  assert.deepEqual(byId, { [`isbn:${matilda.isbn}`]: 0, [`isbn:${potter.isbn}`]: 1 });
});
