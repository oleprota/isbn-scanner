import test from 'node:test';
import assert from 'node:assert/strict';
import { goodreadsSearch, isbnLinks } from '../src/links.js';
import { existsSync, readFileSync } from 'node:fs';
import isbns from './fixtures/isbns.json' with { type: 'json' };

test('returns Ereadian and Goodreads links, in that order', () => {
  assert.deepEqual(isbnLinks('9786171299412'), [
    { name: 'Ereadian', url: 'https://ereadian.com/search?q=9786171299412', icon: 'icons/ereadian.png', title: '9786171299412 на Ereadian' },
    { name: 'Goodreads', url: 'https://www.goodreads.com/book/isbn/9786171299412', icon: 'icons/goodreads.png', title: '9786171299412 на Goodreads' },
  ]);
});

test('encodes the ISBN in every link', () => {
  const [ereadian, goodreads] = isbnLinks('080442957X&x=1 2');
  assert.ok(ereadian.url.endsWith('q=080442957X%26x%3D1%202'), ereadian.url);
  assert.ok(goodreads.url.endsWith('/isbn/080442957X%26x%3D1%202'), goodreads.url);
});

test('builds both links for every ISBN in the shared list', () => {
  for (const { isbn } of [...isbns.found, ...isbns.notFoundInOpenLibrary]) {
    assert.deepEqual(isbnLinks(isbn).map((l) => l.url), [
      `https://ereadian.com/search?q=${isbn}`,
      `https://www.goodreads.com/book/isbn/${isbn}`,
    ]);
  }
});

test('every link has an icon file in the repo, and it is a PNG', () => {
  for (const { name, icon } of isbnLinks('9780747532699')) {
    const file = new URL(`../${icon}`, import.meta.url);
    assert.ok(existsSync(file), `${name}: ${icon} is missing`);
    assert.equal(readFileSync(file).subarray(1, 4).toString(), 'PNG', `${icon} is not a PNG`);
  }
});

test('a series link is a Goodreads search for its name, encoded', () => {
  assert.equal(goodreadsSearch('Хроніки Буресвітла'), 'https://www.goodreads.com/search?q=%D0%A5%D1%80%D0%BE%D0%BD%D1%96%D0%BA%D0%B8%20%D0%91%D1%83%D1%80%D0%B5%D1%81%D0%B2%D1%96%D1%82%D0%BB%D0%B0');
  assert.ok(goodreadsSearch('A&B #1').endsWith('q=A%26B%20%231'));
});

test('a book found by title links to a title search on Ereadian and a title-and-author search on Goodreads', () => {
  const [ereadian, goodreads] = isbnLinks('9786171299412', { title: 'Хірург & Co', author: 'Tess Gerritsen' });
  assert.equal(ereadian.url, 'https://ereadian.com/search?q=%D0%A5%D1%96%D1%80%D1%83%D1%80%D0%B3%20%26%20Co');
  assert.equal(goodreads.url, 'https://www.goodreads.com/search?q=%D0%A5%D1%96%D1%80%D1%83%D1%80%D0%B3%20%26%20Co%20Tess%20Gerritsen');
  assert.equal(ereadian.title, 'Шукати «Хірург & Co» на Ereadian');
  assert.equal(goodreads.title, 'Шукати «Хірург & Co Tess Gerritsen» на Goodreads');
  assert.equal(isbnLinks('9786171299412', { title: 'Хірург', author: '' })[1].url, 'https://www.goodreads.com/search?q=%D0%A5%D1%96%D1%80%D1%83%D1%80%D0%B3');
  assert.deepEqual(isbnLinks('9786171299412', null), isbnLinks('9786171299412'));
});

test('a title-found book with an ISBN and a page address (upgraded by the lookup) links Ereadian by ISBN and Goodreads by page', () => {
  const found = { title: 'Хірург', author: 'Tess', url: 'https://www.goodreads.com/book/show/9' };
  const [ereadian, goodreads] = isbnLinks('9786171299412', found);
  assert.equal(ereadian.url, 'https://ereadian.com/search?q=9786171299412');
  assert.equal(goodreads.url, found.url);
  assert.equal(isbnLinks(undefined, found)[0].url, 'https://ereadian.com/search?q=%D0%A5%D1%96%D1%80%D1%83%D1%80%D0%B3'); // no ISBN: by title
});
