// A list of books by ISBN, newest first, persisted through a list store. Used for both the
// "Scanned" list (everything looked up) and the "Marked" list (the ones picked from it).
// Entries saved by earlier versions may carry extra fields (authors, ...); they are kept.
import { hasKey, isbnId, matchesKey, toId, withId, rekeyList } from './bookId.js';

export const isBookEntry = (e) => hasKey(e) && typeof e.title === 'string';

export const LIST_LIMIT = 1000;

// At most `limit` books are kept. A full list refuses new books (add and bump return false and
// change nothing) until some are removed; books already listed can still be moved or renamed.
const newEntry = ({ id, isbn, title }, now) => ({ id: id || isbnId(isbn), ...(isbn && { isbn }), title, addedAt: now.toISOString() });

export function createBookList(store, limit = LIST_LIMIT) {
  const read = () => store.read().filter(isBookEntry).slice(0, limit).map(withId);

  return {
    list: read,
    has: (key) => read().some((e) => matchesKey(e, key)),
    isFull: () => read().length >= limit,
    limit,
    // A book is { id?, isbn?, title }: a book with no ISBN has an id (`gr:<n>`), the rest get `isbn:<isbn>`.
    // Returns false (and changes nothing) when the book is already listed or the list is full.
    add(book, now = new Date()) {
      const books = read();
      const { id } = withId(book);
      if (books.some((e) => e.id === id) || books.length >= limit) return false;
      store.write([newEntry(book, now), ...books]);
      return true;
    },
    // Puts the book at the top (adding it, or moving and re-titling an existing entry).
    // Returns false (and changes nothing) when it would be a new book on a full list.
    bump(book, now = new Date()) {
      const books = read();
      const { id } = withId(book);
      const existing = books.find((e) => e.id === id);
      if (!existing && books.length >= limit) return false;
      const entry = existing ? { ...existing, title: book.title } : newEntry(book, now);
      store.write([entry, ...books.filter((e) => e.id !== id)]);
      return true;
    },
    remove(key) {
      store.write(read().filter((e) => e.id !== toId(key)));
    },
    // Changes the title of a listed book (e.g. after the user names an unknown one).
    rename(key, title) {
      store.write(read().map((e) => (e.id === toId(key) ? { ...e, title } : e)));
    },
    // `isbn:X` becomes `gr:N`; a duplicate already listed as `gr:N` is merged (see rekeyList).
    rekey(fromId, newId) {
      const next = rekeyList(read(), fromId, newId, (_from, to) => to);
      if (next) store.write(next);
    },
    // The user's own order (the "custom" sort): `ids` are the book ids in the order to keep. Each entry gets a
    // `rank` (its place); books not in `ids` go after them. The list itself stays newest first.
    reorder(ids) {
      const books = read();
      const place = new Map(ids.map((id, i) => [id, i]));
      const rest = books.filter((e) => !place.has(e.id)).map((e) => e.id);
      const rank = new Map([...ids.filter((id) => books.some((e) => e.id === id)), ...rest].map((id, i) => [id, i]));
      store.write(books.map((e) => ({ ...e, rank: rank.get(e.id) })));
    },
    clear() {
      store.write([]);
    },
  };
}
