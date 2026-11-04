// Which ISBN a web page is about, from what the content script read off it:
// { jsonLd: [JSON strings], meta: [values], title: [<title> and og: values], text: body text }.
// Candidates come from structured data, the title and text labelled "ISBN"; see the vote in pickIsbn.
import { isValidIsbn, normalizeIsbn } from './shared/isbn.js';

const RUN = /\d(?:[ -]?\d){8,}(?:[ -]?X)?/gi; // digits with spaces or hyphens between them
// Case-sensitive on purpose: in page data (JSON) a book's spec is "ISBN" while related books carry lowercase `isbn` keys.
// The separator also allows quotes and commas, for `"ISBN"," 978-…"` in JSON. One label can head a whole list
// ("ISBN 978… (електронне видання), 978… (паперове видання)"): runs with up to 40 non-digits between them.
const LABELLED = new RegExp(`ISBN(?:-1[03])?[\\s:#"',]*(${RUN.source}(?:[^\\d]{1,40}${RUN.source})*)`, 'g');
const PAPER = /паперов|друков|обкладин|paperback|hardcover|print/i;
const NOT_PAPER = /електрон|аудіо|e-?book|kindle|audio|pdf|epub/i;
const format = (words) => (PAPER.test(words) ? 1 : NOT_PAPER.test(words) ? -1 : 0);

const valid = (text) => {
  const digits = normalizeIsbn(text);
  if (digits.length === 10 || digits.length === 13) return isValidIsbn(digits) ? digits : null;
  // any other length: the run swallowed digits that follow the ISBN (a year, a price), so try its 13- and 10-digit starts
  return [digits.slice(0, 13), digits.slice(0, 10)].find(isValidIsbn) ?? null;
};
const allIn = (texts, pattern, group = 0) =>
  texts.flatMap((text) => [...text.matchAll(pattern)].map((match) => valid(match[group]))).filter(Boolean);

// [isbn, rank] for the ISBNs in labelled text; rank 1 = paper edition, -1 = e-book or audio, 0 = no format word.
// The words between two ISBNs split at the last comma/semicolon: before it they describe the first ISBN, after it the next
// ("978… (paperback), 979… (ebook)" and "Paperback: 978…, Ebook: 979…" both work). The words before an ISBN win over those after.
function labelled(text) {
  return [...text.matchAll(LABELLED)].flatMap((label) => {
    const runs = [...label[1].matchAll(RUN)];
    return runs.map((run, i) => {
      const gapBefore = i ? label[1].slice(runs[i - 1].index + runs[i - 1][0].length, run.index) : text.slice(Math.max(0, label.index - 30), label.index);
      const gapAfter = label[1].slice(run.index + run[0].length, runs[i + 1]?.index) || text.slice(label.index + label[0].length, label.index + label[0].length + 40);
      const before = gapBefore.slice(gapBefore.search(/[,;][^,;]*$/) + 1);
      const after = gapAfter.slice(0, gapAfter.search(/[,;]/) < 0 ? undefined : gapAfter.search(/[,;]/));
      return [valid(run[0]), format(before) || format(after)];
    });
  }).filter(([isbn]) => isbn);
}

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

// Every ISBN found, in the order they first appear: [{ isbn, score, rank }], `rank` being the format words (see labelled).
export function candidates({ jsonLd, meta, title, text }) {
  const found = labelled(text.replace(/\s+/g, ' ')); // a page's markup indents with hundreds of spaces, which would break the 40-character gaps
  const rank = new Map([...found].reverse()); // the first mention wins
  const sources = [
    fromJsonLd(jsonLd),
    meta.filter(isValidIsbn).map(normalizeIsbn),
    allIn(title, RUN),
    found.map(([isbn]) => isbn),
  ];
  // The page's own book shows up in several sources (data, title, specs); a related book usually in one. So the ISBN
  // found in the most sources wins. The words next to an ISBN add one source for a paper edition and take one from an
  // e-book or audio one (a shop's structured data may hold the e-book's ISBN while its spec list names all three).
  // On a tie the first in this order wins (structured data, title, labelled text).
  const votes = new Map();
  for (const source of sources) for (const isbn of new Set(source)) votes.set(isbn, (votes.get(isbn) ?? 0) + 1);
  return [...votes].map(([isbn, count]) => ({ isbn, score: count + (rank.get(isbn) ?? 0), rank: rank.get(isbn) ?? 0 })); // the format words weigh as much as one source
}

export function pickIsbn(page) {
  let best = null;
  for (const c of candidates(page)) if (!best || c.score > best.score) best = c;
  return best?.isbn ?? null;
}
