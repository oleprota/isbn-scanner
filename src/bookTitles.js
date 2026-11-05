// What a book is called, and where that is kept. Three stores keyed by book id (newest first; an entry saved before ids has an ISBN, and `isbn:<isbn>` is its id), each a plain
// `{ read, write }` list store:
//   names    the name the user typed
//   foundBy  the title and author a book was picked by from a title search: its site links search for them
//            instead of the ISBN, because the ISBN Goodreads has for the edition may not be the one in hand
//   details  what the lookup found (src/lookup.js) plus `v`, the shape of the entry (DETAILS_VERSION: an older
//            one is still readable, but the app asks the service again). Only a cache of public data.
//            Not the `SHAPE` in src/lookup.js (same as `v8` in worker/index.js): that one is the shape of the service's
//            answer in the request URL, so the browser's HTTP cache never serves an older one. The details store
//            is still under the key `isbn-reader.meta` (src/app.js), kept so that stored data is not lost.
// A title is, in this order: the typed name, the title the lookup found, a title stored in one of the lists
// (kept by earlier versions), the title the book was picked by, `ISBN <isbn>`.
// Naming a book and storing details also update the title in the lists, so callers only redraw them.
import { createKeyed } from './keyed.js';
import { cleanText } from './text.js';
import { card } from './strings.js';
import { isThin } from './lookup.js';
import { hasKey, matchesKey, toId } from './bookId.js';

export const DETAILS_VERSION = 6; // 6: a book is asked again once, to get its Goodreads book id (`isbn:X` becomes `gr:N`)
export const NAME_MAX = 120;
const AUTHOR_MAX = 100;

const isName = (e) => hasKey(e) && typeof e.name === 'string';
const isFoundBy = (e) => hasKey(e) && typeof e.title === 'string' && typeof e.author === 'string';
const isDetails = (e) => hasKey(e) && typeof e.title === 'string';

export function createBookTitles({ names, foundBy, details, lists, limit = 1000 }) {
  const typed = createKeyed(names, isName, limit);
  const pickedBy = createKeyed(foundBy, isFoundBy, limit);
  const looked = createKeyed(details, isDetails, limit);

  // the title of a book that has nothing better: `ISBN <isbn>`, or the id of a book with no ISBN (it always has a found title)
  const plain = (id) => (id.startsWith('isbn:') ? card.isbnTitle(id.slice(5)) : id);
  // a listed `ISBN <isbn>` is only the default: it must not hide a better title
  const stored = (id) => lists.map((l) => l.list().find((b) => b.id === id)?.title).find((title) => title && title !== plain(id));
  const picked = (id) => pickedBy.get(id)?.title;
  const fallbackOf = (id) => looked.get(id)?.title || picked(id) || plain(id);
  const ofId = (id) => typed.get(id)?.name || looked.get(id)?.title || stored(id) || picked(id) || plain(id);
  const retitle = (id, title, replaces = () => true) => {
    for (const list of lists) if (replaces(list.list().find((b) => b.id === id)?.title)) list.rename(id, title);
  };
  // the stores take an id, or a bare ISBN for `isbn:<isbn>`
  // (a bare ISBN also finds the book if it was upgraded to `gr:<n>`)
  const idOf = (key) => (key.includes(':') ? key : [...lists.flatMap((l) => l.list()), ...looked.all()].find((e) => matchesKey(e, key))?.id ?? toId(key));
  const of = (key) => ofId(idOf(key));
  const fallback = (key) => fallbackOf(idOf(key));

  return {
    of,
    // The id a book with this ISBN has now: `gr:<n>` once it was upgraded or merged, else `isbn:<isbn>`.
    idOf,
    // what an empty name turns back into
    fallback,
    // Names the book (an empty name, or the fallback typed back, removes the name) and returns its title now.
    rename(key, name) {
      const id = toId(key);
      const clean = cleanText(name, NAME_MAX);
      const named = clean && clean !== fallbackOf(id);
      if (named) typed.put({ id, name: clean });
      else typed.remove(id);
      // not `of`: the lists still hold the old name, which would beat the fallback
      const title = named ? clean : fallbackOf(id);
      retitle(id, title);
      return title;
    },

    details: (key) => looked.get(key),
    // current = the shape the app writes now and complete; partial = saved before the lookup finished (`partial: true`)
    detailsCurrent: (key) => { const d = looked.get(key); return d?.v === DETAILS_VERSION && !d.partial; },
    detailsPartial: (key) => looked.get(key)?.partial === true,
    // id -> rating value, for the books that have one (the lists show it)
    ratings: () => new Map(looked.all().filter((e) => e.rating).map((e) => [e.id, e.rating.value])),
    // ids whose rating is thin (the lists mark them)
    thinRatings: () => new Set(looked.all().filter((e) => isThin(e.rating)).map((e) => e.id)),
    // Stores what the lookup found. A found title only replaces the default `ISBN <number>` or the title an
    // earlier lookup of this book gave (older versions kept the series bracket in it): never a typed name or
    // another title. Rows in the lists are replaced that way; the returned `replaces(title)` tells the same
    // for a title shown elsewhere (the card). `partial`: only what a title search knew; `isbn`: the ISBN of a book
    // that has an id of its own (the edition request found it; it is kept, not shown yet).
    setDetails(key, answer, { partial = false, isbn } = {}) {
      const id = toId(key);
      const earlier = looked.get(id)?.title;
      const own = id.startsWith('isbn:') ? id.slice(5) : isbn;
      // an upgraded book (`gr:<n>`) may still be listed as `ISBN <isbn>`
      const replaces = (title) => title === plain(id) || title === earlier || (own && title === card.isbnTitle(own));
      looked.put({ ...answer, id, ...(own && { isbn: own }), v: DETAILS_VERSION, ...(partial && { partial: true }) });
      retitle(id, answer.title, replaces);
      return replaces;
    },

    foundBy: (key) => pickedBy.get(key),
    allFoundBy: () => new Map(pickedBy.all().map((e) => [e.id, e])),
    // `url`: the book's Goodreads page (the Goodreads link goes there). An empty title clears it (the book is no longer one found by its title)
    setFoundBy(key, { title, author, url } = {}) {
      const id = toId(key);
      const entry = { id, title: cleanText(title, NAME_MAX), author: cleanText(author, AUTHOR_MAX), ...(url && { url }) };
      if (entry.title) pickedBy.put(entry);
      else pickedBy.remove(id);
    },
    clearFoundBy: (key) => pickedBy.remove(key),

    // `isbn:X` becomes `gr:N` everywhere, merging a book already stored as `gr:N`: it stays starred if either was,
    // keeps a typed name (the `gr:N` one wins) and the older list position. Other re-keys are refused.
    rekey(fromId, toId) {
      for (const list of lists) list.rekey(fromId, toId);
      typed.rekey(fromId, toId);
      pickedBy.rekey(fromId, toId);
      looked.rekey(fromId, toId, (from, to) => (to.partial && !from.partial ? from : to));
    },
  };
}
