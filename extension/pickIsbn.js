// Which ISBN a web page is about, from what the content script read off it:
// { jsonLd: [JSON strings], meta: [values], title: [<title> and og: values], text: body text }.
// Candidates come from structured data, the title and text labelled "ISBN"; see the vote in pickIsbn.
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
const allIn = (texts, pattern, group = 0) =>
  texts.flatMap((text) => [...text.matchAll(pattern)].map((match) => valid(match[group]))).filter(Boolean);

function* isbnValues(node) {
  if (Array.isArray(node)) for (const item of node) yield* isbnValues(item);
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'isbn') yield* [value].flat().map(String);
      else yield* isbnValues(value);
    }
  }
}

const fromJsonLd = (blocks) =>
  blocks.flatMap((block) => {
    try { return [...isbnValues(JSON.parse(block))].filter(isValidIsbn).map(normalizeIsbn); } catch { return []; }
  });

export function pickIsbn({ jsonLd, meta, title, text }) {
  const sources = [
    fromJsonLd(jsonLd),
    meta.filter(isValidIsbn).map(normalizeIsbn),
    allIn(title, RUN),
    allIn([text], LABELLED, 1),
  ];
  // The page's own book shows up in several sources (data, title, specs); a related book usually in one. So the ISBN
  // found in the most sources wins, and on a tie the first one in this order (structured data, title, labelled text).
  const votes = new Map();
  for (const source of sources) for (const isbn of new Set(source)) votes.set(isbn, (votes.get(isbn) ?? 0) + 1);
  let best = null;
  for (const [isbn, count] of votes) if (count > (votes.get(best) ?? 0)) best = isbn;
  return best;
}
