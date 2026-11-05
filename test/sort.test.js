import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSort, saveSort, sortBooks } from '../src/sort.js';

const books = [
  { id: '1', title: 'Яблуко' },
  { id: '2', title: 'Apple' },
  { id: '3', title: 'Банан' },
  { id: '4', title: 'cherry' },
];
const ratings = { 1: 3.5, 2: 4.7, 3: 0, 4: 3.5 };
const ctx = (waiting = []) => ({ ratingOf: (id) => ratings[id] ?? 0, isWaiting: (id) => waiting.includes(id) });
const order = (list) => list.map((b) => b.id).join('');

test('date keeps the list order', () => assert.equal(order(sortBooks(books, 'date', ctx())), '1234'));

test('name is А-Я then A-Z (Ukrainian collation), ignoring case', () => assert.equal(order(sortBooks(books, 'name', ctx())), '3124'));

test('rating puts the highest first, none counts as 0, ties keep the list order', () => {
  assert.equal(order(sortBooks(books, 'rating', ctx())), '2143');
});

test('books still being looked up stay on top, in list order, in any sort', () => {
  assert.equal(order(sortBooks(books, 'name', ctx(['4', '3']))), '3412');
  assert.equal(order(sortBooks(books, 'rating', ctx(['3']))), '3214');
});

test('sorting never changes the list it is given', () => {
  const copy = [...books];
  sortBooks(books, 'name', ctx());
  assert.deepEqual(books, copy);
});

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}

test('the choice is remembered per list; bad or missing data means date', () => {
  const storage = fakeStorage();
  assert.equal(loadSort(storage, 'scanned'), 'date');
  saveSort(storage, 'scanned', 'name');
  saveSort(storage, 'marked', 'rating');
  assert.equal(loadSort(storage, 'scanned'), 'name');
  assert.equal(loadSort(storage, 'marked'), 'rating');
  assert.equal(loadSort(fakeStorage({ 'isbn-reader.sort': '{"scanned":"nope"}' }), 'scanned'), 'date');
  assert.equal(loadSort(fakeStorage({ 'isbn-reader.sort': '[[' }), 'scanned'), 'date');
  assert.doesNotThrow(() => saveSort(fakeStorage({ 'isbn-reader.sort': '7' }), 'scanned', 'name'));
  for (const broken of [null, { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }]) {
    assert.equal(loadSort(broken, 'scanned'), 'date');
    assert.doesNotThrow(() => saveSort(broken, 'scanned', 'name'));
  }
});
