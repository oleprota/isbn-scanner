// Which ISBN a web page is about, from what the content script read off it:
// { jsonLd: [JSON strings], meta: [values], title: [<title> and og: values], text: body text }.
// Order: structured data, then the title, then text labelled "ISBN". The first valid ISBN wins, so the
// page's own book beats the related books that book pages list further down.
import { isValidIsbn, normalizeIsbn } from './shared/isbn.js';

const RUN = /\d(?:[ -]?\d){8,}(?:[ -]?X)?/gi; // digits with spaces or hyphens between them
// Case-sensitive on purpose: in page data (JSON) a book's spec is "ISBN" while related books carry lowercase `isbn` keys.
// The separator also allows quotes and commas, for `"ISBN"," 978-…"` in JSON.
const LABELLED = new RegExp(`ISBN(?:-1[03])?[\\s:#"',]*(${RUN.source})`, 'g');

const valid = (text) => {
  const digits = normalizeIsbn(text);
  if (digits.length === 10 || digits.length === 13) return isValidIsbn(digits) ? digits : null;
  // any other length: the run swallowed digits that follow the ISBN (a year, a price), so try its 13- and 10-digit starts
  return [digits.slice(0, 13), digits.slice(0, 10)].find(isValidIsbn) ?? null;
};
const firstIn = (texts, pattern, group = 0) => {
  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      const isbn = valid(match[group]);
      if (isbn) return isbn;
    }
  }
  return null;
};

function* isbnValues(node) {
  if (Array.isArray(node)) for (const item of node) yield* isbnValues(item);
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'isbn') yield* [value].flat().map(String);
      else yield* isbnValues(value);
    }
  }
}

export function pickIsbn({ jsonLd, meta, title, text }) {
  for (const block of jsonLd) {
    let data;
    try { data = JSON.parse(block); } catch { continue; }
    for (const value of isbnValues(data)) if (isValidIsbn(value)) return normalizeIsbn(value);
  }
  return meta.map((value) => (isValidIsbn(value) ? normalizeIsbn(value) : null)).find(Boolean)
    ?? firstIn(title, RUN)
    ?? firstIn([text], LABELLED, 1);
}
