import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBook, parseCandidates, parseEdition, splitTitle } from '../worker/goodreads.js';

const page = (...blocks) =>
  `<html><head>${blocks.map((b) => `<script type="application/ld+json">${typeof b === 'string' ? b : JSON.stringify(b)}</script>`).join('')}</head></html>`;

// shaped like the real page of 9786171299412 (checked 2026-10-26)
const book = {
  '@context': 'https://schema.org',
  '@type': 'Book',
  name: 'Шлях королів (Хроніки Буресвітла #1)',
  image: 'https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1678531272i/123221824.jpg',
  author: [
    { '@type': 'Person', name: 'Brandon Sanderson', url: 'https://www.goodreads.com/author/show/38550.Brandon_Sanderson' },
    { '@type': 'Person', name: 'Брендон Сандерсон', url: 'https://www.goodreads.com/author/show/13521979._' },
  ],
  aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.66, ratingCount: 734385, reviewCount: 59741 },
};

test('reads title, series, author, rating and cover from the Book block', () => {
  assert.deepEqual(parseBook(page(book)), {
    title: 'Шлях королів',
    series: { name: 'Хроніки Буресвітла', number: '1' },
    author: { name: 'Brandon Sanderson', url: 'https://www.goodreads.com/author/show/38550.Brandon_Sanderson' },
    rating: { value: 4.66, count: 734385 },
    image: book.image,
  });
});

test('splitTitle takes the numbered bracket as the series and drops every trailing bracket', () => {
  const cases = {
    'Шлях королів (Хроніки Буресвітла #1)': ['Шлях королів', { name: 'Хроніки Буресвітла', number: '1' }],
    "Harry Potter and the Philosopher's Stone (Harry Potter, #1)": ["Harry Potter and the Philosopher's Stone", { name: 'Harry Potter', number: '1' }],
    'Title (Series, #2) (Special Edition)': ['Title', { name: 'Series', number: '2' }],
    'The Fellowship (The Lord of the Rings #1-3)': ['The Fellowship', { name: 'The Lord of the Rings', number: '1-3' }],
    'Дюна (Дюна, #1.5)': ['Дюна', { name: 'Дюна', number: '1.5' }],
    'Sapiens (Illustrated)': ['Sapiens', null],
    'Plain title': ['Plain title', null],
    '(Only a bracket)': ['(Only a bracket)', null],
    'Mid (bracket) stays in the title': ['Mid (bracket) stays in the title', null],
  };
  for (const [name, [title, series]] of Object.entries(cases)) assert.deepEqual(splitTitle(name), { title, series }, name);
});

test('finds the Book among other blocks, in an array, and skips malformed ones', () => {
  assert.equal(parseBook(page('{not json', { '@type': 'Organization' }, [book]))?.title, 'Шлях королів');
});

test('decodes HTML entities in the title and author, once', () => {
  const parsed = parseBook(page({ ...book, name: 'Philosopher&apos;s Stone &amp; &#8220;Co&#x201D; &amp;apos; (Harry Potter&apos;s, #1)', author: [{ name: 'A &lt;B&gt;' }] }));
  assert.equal(parsed.title, 'Philosopher\'s Stone & “Co” &apos;');
  assert.equal(parsed.series.name, "Harry Potter's");
  assert.equal(parsed.author.name, 'A <B>');
});

test('the author is the first with a name; its link only when it is a Goodreads author page', () => {
  assert.deepEqual(parseBook(page({ ...book, author: { name: 'One' } }))?.author, { name: 'One', url: '' });
  assert.deepEqual(parseBook(page({ ...book, author: [{ name: ' ' }, { name: 'Second', url: 'https://evil.example/x' }] }))?.author, { name: 'Second', url: '' });
  assert.equal(parseBook(page({ ...book, author: undefined }))?.author, null);
});

test('no rating (or a nonsense one) is null', () => {
  assert.equal(parseBook(page({ ...book, aggregateRating: undefined }))?.rating, null);
  assert.equal(parseBook(page({ ...book, aggregateRating: { ratingValue: 4.2, ratingCount: 0 } }))?.rating, null);
  assert.equal(parseBook(page({ ...book, aggregateRating: { ratingValue: 9, ratingCount: 5 } }))?.rating, null);
  assert.deepEqual(parseBook(page({ ...book, aggregateRating: { ratingValue: '3.5', ratingCount: 12 } }))?.rating, { value: 3.5, count: 12 });
});

test('only an https cover is kept', () => {
  assert.equal(parseBook(page({ ...book, image: 'http://x/y.jpg' }))?.image, '');
  assert.equal(parseBook(page({ ...book, image: 5 }))?.image, '');
});

test('no Book block or no name is no data', () => {
  assert.equal(parseBook(''), null);
  assert.equal(parseBook('<html>no data</html>'), null);
  assert.equal(parseBook(page({ '@type': 'Book', name: '  ' })), null);
  assert.equal(parseBook('<script type="application/ld+json">{"@type":"Book","name":"Cut off"'), null);
});

test('parseEdition is the book with the edition\'s ISBN when it is valid, else null', () => {
  const edition = parseEdition(page({ ...book, isbn: '978-617-129-941-2' }));
  assert.deepEqual(edition, { isbn: '9786171299412', ...parseBook(page(book)) });
  assert.equal(parseEdition(page({ ...book, isbn: '9786171299413' })), null);
  assert.equal(parseEdition(page(book)), null);
  assert.equal(parseEdition(page({ ...book, name: '', isbn: '9786171299412' })), null);
  assert.equal(parseEdition('<html></html>'), null);
});

test('parseCandidates keeps id and title, cleans the rest, and is null for a non-list', () => {
  assert.equal(parseCandidates({}), null);
  assert.deepEqual(parseCandidates([null, { bookId: 5 }, { bookId: '5', title: 'Fallback' }]), [{ id: '5', title: 'Fallback', author: '', image: '' }]);
});
