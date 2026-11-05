import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookTitles } from '../src/bookTitles.js';
import { createBookList } from '../src/bookList.js';

const memoryStore = (initial = []) => {
  let list = initial;
  return { read: () => list, write: (next) => { list = next; } };
};

function setup({ names = [], foundBy = [], details = [], scanned = [], marked = [] } = {}) {
  const lists = { scanned: createBookList(memoryStore(scanned)), marked: createBookList(memoryStore(marked)) };
  const stores = { names: memoryStore(names), foundBy: memoryStore(foundBy), details: memoryStore(details) };
  return { ...lists, stores, titles: createBookTitles({ ...stores, lists: [lists.scanned, lists.marked] }) };
}
const row = (isbn, title) => ({ isbn, title, addedAt: '2026-01-01T00:00:00.000Z' });
const found = (title) => ({ title, image: '', series: null, author: null, rating: null });

test('a typed name beats the found title, which beats a listed one, which beats the picked one, which beats the ISBN', () => {
  const all = { names: [{ isbn: '1', name: 'Mine' }], details: [{ isbn: '1', title: 'Found', v: 5 }], scanned: [row('1', 'Old')], foundBy: [{ isbn: '1', title: 'Picked', author: '' }] };
  assert.equal(setup(all).titles.of('1'), 'Mine');
  assert.equal(setup({ ...all, names: [] }).titles.of('1'), 'Found');
  assert.equal(setup({ ...all, names: [], details: [] }).titles.of('1'), 'Old');
  assert.equal(setup({ ...all, names: [], details: [], scanned: [] }).titles.of('1'), 'Picked');
  assert.equal(setup().titles.of('1'), 'ISBN 1');
});

test('a listed default `ISBN 1` does not hide a picked title', () => {
  const { titles } = setup({ scanned: [row('1', 'ISBN 1')], foundBy: [{ isbn: '1', title: 'Picked', author: '' }] });
  assert.equal(titles.of('1'), 'Picked');
});

test('naming a book updates its row in Scanned and Marked; the name is trimmed and capped', () => {
  const { titles, scanned, marked } = setup({ scanned: [row('1', 'ISBN 1')], marked: [row('1', 'ISBN 1')] });
  assert.equal(titles.rename('1', '  My   book '), 'My book');
  assert.equal(titles.of('1'), 'My book');
  assert.equal(scanned.list()[0].title, 'My book');
  assert.equal(marked.list()[0].title, 'My book');
  assert.equal(titles.rename('1', 'x'.repeat(500)).length, 120);
});

test('an empty name, or the fallback typed back, falls back to the found title, else the picked one, else the ISBN', () => {
  const { titles, scanned } = setup({ scanned: [row('1', 'ISBN 1')], details: [{ isbn: '1', title: 'Found', v: 5 }] });
  titles.rename('1', 'Mine');
  assert.equal(titles.rename('1', ''), 'Found');
  assert.equal(scanned.list()[0].title, 'Found');
  titles.rename('1', 'Mine');
  assert.equal(titles.rename('1', 'Found'), 'Found');
  assert.equal(titles.fallback('1'), 'Found');
  assert.equal(setup().titles.fallback('1'), 'ISBN 1');
  assert.equal(setup({ foundBy: [{ isbn: '2', title: 'Picked', author: '' }] }).titles.fallback('2'), 'Picked');
});

test('clearing a name on a book with no details goes back to the picked title, else the ISBN, not the old name', () => {
  const plain = setup({ scanned: [row('1', 'ISBN 1')] });
  plain.titles.rename('1', 'Mine');
  assert.equal(plain.titles.rename('1', ''), 'ISBN 1');
  assert.equal(plain.scanned.list()[0].title, 'ISBN 1');
  const picked = setup({ scanned: [row('1', 'ISBN 1')], foundBy: [{ isbn: '1', title: 'Picked', author: '' }] });
  picked.titles.rename('1', 'Mine');
  assert.equal(picked.titles.rename('1', '   '), 'Picked');
  assert.equal(picked.scanned.list()[0].title, 'Picked');
});

test('details arriving after a rename leave the name alone', () => {
  const { titles, scanned } = setup({ scanned: [row('1', 'ISBN 1')] });
  titles.rename('1', 'Mine');
  const replaces = titles.setDetails('1', found('Found'));
  assert.equal(replaces('Mine'), false);
  assert.equal(titles.of('1'), 'Mine');
  assert.equal(scanned.list()[0].title, 'Mine');
});

test('details replace a default row title and the title an earlier lookup gave, not another title', () => {
  const { titles, scanned, marked } = setup({ scanned: [row('1', 'ISBN 1'), row('2', 'Typed long ago')], marked: [row('1', 'ISBN 1')] });
  const replaces = titles.setDetails('1', found('Found'));
  assert.equal(replaces('ISBN 1'), true);
  assert.equal(scanned.list()[0].title, 'Found');
  assert.equal(marked.list()[0].title, 'Found');
  titles.setDetails('2', found('Other'));
  assert.equal(scanned.list()[1].title, 'Typed long ago');
  // a second answer replaces the first lookup's title (older versions kept the series bracket in it)
  const again = titles.setDetails('1', found('Found again'));
  assert.equal(again('Found'), true);
  assert.equal(again('Typed'), false);
  assert.equal(scanned.list()[0].title, 'Found again');
});

test('details are kept with a version; an older entry is not current, and ratings are listed', () => {
  const { titles, stores } = setup({ details: [{ isbn: '9', title: 'Old shape', v: 1 }] });
  assert.equal(titles.details('9').title, 'Old shape');
  assert.equal(titles.detailsCurrent('9'), false);
  assert.equal(titles.detailsCurrent('1'), false);
  titles.setDetails('1', { ...found('One'), rating: { value: 4, count: 3 } });
  assert.equal(titles.detailsCurrent('1'), true);
  assert.deepEqual([...titles.ratings()], [['1', 4]]);
  assert.equal(stores.details.read()[0].isbn, '1');
});

test('the title and author a book was found by are kept, newest first, and cleared explicitly', () => {
  const { titles } = setup();
  assert.equal(titles.foundBy('1'), null);
  titles.setFoundBy('1', { title: '  Хірург ', author: 'Tess   Gerritsen' });
  titles.setFoundBy('2', { title: 'Other' });
  assert.deepEqual(titles.foundBy('1'), { id: 'isbn:1', isbn: '1', title: 'Хірург', author: 'Tess Gerritsen' });
  assert.equal(titles.foundBy('2').author, '');
  assert.deepEqual([...titles.allFoundBy().keys()], ['2', '1']);
  titles.clearFoundBy('1');
  assert.equal(titles.foundBy('1'), null);
  assert.equal(titles.of('1'), 'ISBN 1');
});

test('stores are cut to their limit and corrupt entries are ignored', () => {
  const { titles } = setup({ names: [null, 5, { isbn: 1 }, { isbn: '9', name: 'Ok' }], foundBy: [{ isbn: '9', title: 5 }] });
  assert.equal(titles.of('9'), 'Ok');
  assert.equal(titles.foundBy('9'), null);
  const small = createBookTitles({ names: memoryStore(), foundBy: memoryStore(), details: memoryStore(), lists: [], limit: 2 });
  for (const isbn of ['1', '2', '3']) small.rename(isbn, `Book ${isbn}`);
  assert.equal(small.of('1'), 'ISBN 1'); // the oldest was dropped
  assert.equal(small.of('3'), 'Book 3');
});
