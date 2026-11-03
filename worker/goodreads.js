// Reads a book out of a Goodreads book page: the schema.org `Book` block in its
// <script type="application/ld+json"> (the og: tags hold the same data, but og:title is cut at ~60 characters).
import { isValidIsbn, normalizeIsbn } from '../src/isbn.js';

const MARKER = 'application/ld+json';
const CLOSE = '</script>';

// The JSON-LD blocks of a page, parsed. Malformed ones are skipped. A plain indexOf scan keeps
// the CPU time low (a Workers free-tier request has 10 ms).
export function jsonLdBlocks(html) {
  const blocks = [];
  let from = 0;
  for (;;) {
    const tag = html.indexOf(MARKER, from);
    if (tag === -1) return blocks;
    const start = html.indexOf('>', tag) + 1;
    const end = html.indexOf(CLOSE, start);
    if (start === 0 || end === -1) return blocks;
    from = end;
    try {
      blocks.push(JSON.parse(html.slice(start, end)));
    } catch {
      // not JSON: skip it
    }
  }
}

// The JSON-LD strings carry HTML entities ("Philosopher&apos;s Stone"). One pass, so "&amp;apos;" stays "&apos;".
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(?:#(\d{1,6})|#x([\da-f]{1,6})|(amp|lt|gt|quot|apos));/gi, (match, dec, hex, name) => {
    if (name) return NAMED[name.toLowerCase()];
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });

const text = (value, max) => (typeof value === 'string' ? decode(value).trim().replace(/\s+/g, ' ').slice(0, max) : '');

// "Шлях королів (Хроніки Буресвітла #1)" -> the title without any trailing brackets, and the series
// from the bracket that has a "#number" in it ({ name, number }, or null). Brackets without a number
// ("(Illustrated)") are only dropped. A title that is nothing but a bracket is left alone.
export function splitTitle(name) {
  let title = name;
  let series = null;
  for (;;) {
    const bracket = /\s*\(([^()]*)\)\s*$/.exec(title);
    if (!bracket || bracket.index === 0) break;
    title = title.slice(0, bracket.index);
    const numbered = /^(.*?)[,\s]*#\s*(\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)$/.exec(bracket[1].trim());
    if (numbered && numbered[1].trim() && !series) series = { name: numbered[1].trim(), number: numbered[2].replace(/\s+/g, '') };
  }
  return { title: title.trim(), series };
}

const AUTHOR_URL = 'https://www.goodreads.com/author/';

// The first author: { name, url } (the url only when it is a Goodreads author page).
function firstAuthor(value) {
  const person = [value].flat().find((p) => text(p?.name, 100));
  if (!person) return null;
  return { name: text(person.name, 100), url: typeof person.url === 'string' && person.url.startsWith(AUTHOR_URL) ? person.url : '' };
}

// { value, count } from schema.org's aggregateRating, or null when nobody has rated the book.
function ratingOf(rating) {
  const value = Number(rating?.ratingValue);
  const count = Number(rating?.ratingCount);
  return value > 0 && value <= 5 && Number.isInteger(count) && count > 0 ? { value, count } : null;
}

const findBook = (html) =>
  jsonLdBlocks(html)
    .flatMap((block) => (Array.isArray(block) ? block : [block]))
    .find((block) => block?.['@type'] === 'Book');

// The books in Goodreads' search-as-you-type answer (an array): up to 5 of
// `{ id, title, author, image }`. Entries without an id or a title are dropped.
export function parseCandidates(data) {
  if (!Array.isArray(data)) return null;
  return data
    .map((b) => ({
      id: String(b?.bookId ?? ''),
      title: text(b?.bookTitleBare ?? b?.title, 120),
      author: text(b?.author?.name, 100),
      image: typeof b?.imageUrl === 'string' && b.imageUrl.startsWith('https://') ? b.imageUrl : '',
    }))
    .filter((b) => /^\d{1,12}$/.test(b.id) && b.title)
    .slice(0, 5);
}

// What the answer holds, from the page's Book block (null = no title, no data).
function readBook(book) {
  const name = text(book?.name, 200);
  if (!name) return null;
  const { title, series } = splitTitle(name);
  return {
    title,
    series,
    author: firstAuthor(book.author),
    rating: ratingOf(book.aggregateRating),
    image: typeof book.image === 'string' && book.image.startsWith('https://') ? book.image : '',
  };
}

// `{ title, series, author, rating, image }` for the first Book in the page, or null (no title = no data).
export const parseBook = (html) => readBook(findBook(html));

// `{ isbn, title, series, author, rating, image }`: the Book of the page with the ISBN of its edition, or null
// when the page has no valid ISBN. A picked search result is fully described by this one page.
export function parseEdition(html) {
  const book = findBook(html);
  const isbn = normalizeIsbn(book?.isbn ?? '');
  const details = readBook(book);
  return details && isValidIsbn(isbn) ? { isbn, ...details } : null;
}
