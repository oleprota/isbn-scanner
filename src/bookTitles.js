// What a book is called, and where that is kept. Three stores keyed by ISBN (newest first), each a plain
// `{ read, write }` list store:
//   names    the name the user typed
//   foundBy  the title and author a book was picked by from a title search: its site links search for them
//            instead of the ISBN, because the ISBN Goodreads has for the edition may not be the one in hand
//   details  what the lookup found (src/lookup.js) plus `v`, the shape of the entry (DETAILS_VERSION: an older
//            one is still readable, but the app asks the service again). Only a cache of public data.
//            Not the `SHAPE` in src/lookup.js (same as `v6` in worker/index.js): that one is the shape of the service's
//            answer in the request URL, so the browser's HTTP cache never serves an older one. The details store
//            is still under the key `isbn-reader.meta` (src/app.js), kept so that stored data is not lost.
// A title is, in this order: the typed name, the title the lookup found, a title stored in one of the lists
// (kept by earlier versions), the title the book was picked by, `ISBN <isbn>`.
// Naming a book and storing details also update the title in the lists, so callers only redraw them.
import { createKeyed } from './keyed.js';
import { cleanText } from './text.js';
import { card } from './strings.js';
import { isThin } from './lookup.js';

export const DETAILS_VERSION = 5;
export const NAME_MAX = 120;
const AUTHOR_MAX = 100;

const isName = (e) => e && typeof e.isbn === 'string' && typeof e.name === 'string';
const isFoundBy = (e) => e && typeof e.isbn === 'string' && typeof e.title === 'string' && typeof e.author === 'string';
const isDetails = (e) => e && typeof e.isbn === 'string' && typeof e.title === 'string';

export function createBookTitles({ names, foundBy, details, lists, limit = 1000 }) {
  const typed = createKeyed(names, isName, limit);
  const pickedBy = createKeyed(foundBy, isFoundBy, limit);
  const looked = createKeyed(details, isDetails, limit);

  // a listed `ISBN <isbn>` is only the default: it must not hide a better title
  const stored = (isbn) => lists.map((l) => l.list().find((b) => b.isbn === isbn)?.title).find((title) => title && title !== card.isbnTitle(isbn));
  const picked = (isbn) => pickedBy.get(isbn)?.title;
  const fallback = (isbn) => looked.get(isbn)?.title || picked(isbn) || card.isbnTitle(isbn);
  const of = (isbn) => typed.get(isbn)?.name || looked.get(isbn)?.title || stored(isbn) || picked(isbn) || card.isbnTitle(isbn);
  const retitle = (isbn, title, replaces = () => true) => {
    for (const list of lists) if (replaces(list.list().find((b) => b.isbn === isbn)?.title)) list.rename(isbn, title);
  };

  return {
    of,
    // what an empty name turns back into
    fallback,
    // Names the book (an empty name, or the fallback typed back, removes the name) and returns its title now.
    rename(isbn, name) {
      const clean = cleanText(name, NAME_MAX);
      const named = clean && clean !== fallback(isbn);
      if (named) typed.put({ isbn, name: clean });
      else typed.remove(isbn);
      // not `of`: the lists still hold the old name, which would beat the fallback
      const title = named ? clean : fallback(isbn);
      retitle(isbn, title);
      return title;
    },

    details: (isbn) => looked.get(isbn),
    detailsCurrent: (isbn) => looked.get(isbn)?.v === DETAILS_VERSION,
    // isbn -> rating value, for the books that have one (the lists show it)
    ratings: () => new Map(looked.all().filter((e) => e.rating).map((e) => [e.isbn, e.rating.value])),
    // isbns whose rating is thin (the lists mark them)
    thinRatings: () => new Set(looked.all().filter((e) => isThin(e.rating)).map((e) => e.isbn)),
    // Stores what the lookup found. A found title only replaces the default `ISBN <number>` or the title an
    // earlier lookup of this book gave (older versions kept the series bracket in it): never a typed name or
    // another title. Rows in the lists are replaced that way; the returned `replaces(title)` tells the same
    // for a title shown elsewhere (the card).
    setDetails(isbn, answer) {
      const earlier = looked.get(isbn)?.title;
      const replaces = (title) => title === card.isbnTitle(isbn) || title === earlier;
      looked.put({ ...answer, isbn, v: DETAILS_VERSION });
      retitle(isbn, answer.title, replaces);
      return replaces;
    },

    foundBy: (isbn) => pickedBy.get(isbn),
    allFoundBy: () => new Map(pickedBy.all().map((e) => [e.isbn, e])),
    // an empty title clears it (the book is no longer one found by its title)
    setFoundBy(isbn, { title, author } = {}) {
      const entry = { isbn, title: cleanText(title, NAME_MAX), author: cleanText(author, AUTHOR_MAX) };
      if (entry.title) pickedBy.put(entry);
      else pickedBy.remove(isbn);
    },
    clearFoundBy: (isbn) => pickedBy.remove(isbn),
  };
}
