import test from 'node:test';
import assert from 'node:assert/strict';
import { copyText } from '../src/copyText.js';

const ereadian = (q) => `https://ereadian.com/search?q=${q}`;
const goodreads = (isbn) => `https://www.goodreads.com/book/isbn/${isbn}`;
const count = (n) => new Intl.NumberFormat('uk-UA').format(n);
const bookText = (title, info = {}, isbn = '1') => copyText([{ isbn, title }], () => info);
const first = (text) => text.split('\n')[0];

test('a book is its line, the Ereadian link and the Goodreads link; books are split by one empty line, none at the end', () => {
  assert.equal(
    copyText([{ isbn: '1', title: 'B' }, { isbn: '2', title: 'A' }]),
    `B\n${ereadian(1)}\n${goodreads(1)}\n\nA\n${ereadian(2)}\n${goodreads(2)}`,
  );
});

test('author, title, rating and count share the first line, a thin one ends with a warning', () => {
  const full = bookText('Matilda', { author: 'Roald Dahl', rating: { value: 4.4, count: 1234 } });
  assert.equal(first(full), `Roald Dahl, Matilda ★ 4.40 (${count(1234)})`);
  assert.equal(full.split('\n').length, 3);
  assert.equal(first(bookText('X', { author: 'A', rating: { value: 5, count: 3 } })), 'A, X ★ 5.00 (3) ⚠');
});

test('a missing author or rating is skipped', () => {
  assert.equal(first(bookText('Matilda', { author: 'Roald Dahl' })), 'Roald Dahl, Matilda');
  assert.equal(first(bookText('Matilda', { rating: { value: 4, count: 500 } })), 'Matilda ★ 4.00 (500)');
  assert.equal(first(bookText('Matilda')), 'Matilda');
});

test('a closing period of the title goes, ?, ! and an ellipsis stay', () => {
  assert.equal(first(bookText('Dune.')), 'Dune');
  assert.equal(first(bookText('Why?')), 'Why?');
  assert.equal(first(bookText('Go!')), 'Go!');
  assert.equal(first(bookText('Wait...')), 'Wait...');
  assert.equal(first(bookText('Wait…')), 'Wait…');
});

test('a book found by title links to the searches, as the card does', () => {
  const found = { isbn: '1', title: 'Dune', author: 'Frank Herbert' }; // the stored entry also carries the isbn
  assert.deepEqual(bookText('Dune', { found }, null).split('\n').slice(1), [ereadian('Dune'), 'https://www.goodreads.com/search?q=Dune+Frank+Herbert']);
  assert.equal(bookText('Dune', { found: { ...found, url: 'https://www.goodreads.com/book/show/9' } }).split('\n')[1], ereadian('1')); // with a page address and an ISBN Ereadian searches the ISBN
});

test('an entry saved by an earlier version (extra fields) is written by its title', () => {
  assert.equal(first(copyText([{ isbn: '1', title: 'Old', authors: ['A'], publishedDate: '1999' }])), 'Old');
});

test('Cyrillic reads as letters in the links and spaces are +; reserved characters stay encoded', () => {
  const found = { title: 'Неосяжний світ. 100% & так', author: 'Автор' };
  assert.deepEqual(bookText('X', { found }, null).split('\n').slice(1), [
    'https://ereadian.com/search?q=Неосяжний+світ.+100%25+%26+так',
    'https://www.goodreads.com/search?q=Неосяжний+світ.+100%25+%26+так+Автор',
  ]);
});
