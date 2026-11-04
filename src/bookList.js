// A list of books by ISBN, newest first, persisted through a list store. Used for both the
// "Scanned" list (everything looked up) and the "Marked" list (the ones picked from it).
// Entries saved by earlier versions may carry extra fields (authors, ...); they are kept.
export const isBookEntry = (e) => e && typeof e.isbn === 'string' && typeof e.title === 'string';

export const LIST_LIMIT = 1000;

// At most `limit` books are kept. A full list refuses new books (add and bump return false and
// change nothing) until some are removed; books already listed can still be moved or renamed.
export function createBookList(store, limit = LIST_LIMIT) {
  const read = () => store.read().filter(isBookEntry).slice(0, limit);

  return {
    list: read,
    has: (isbn) => read().some((e) => e.isbn === isbn),
    isFull: () => read().length >= limit,
    limit,
    // Returns false (and changes nothing) when the ISBN is already listed or the list is full.
    add({ isbn, title }, now = new Date()) {
      const books = read();
      if (books.some((e) => e.isbn === isbn) || books.length >= limit) return false;
      store.write([{ isbn, title, addedAt: now.toISOString() }, ...books]);
      return true;
    },
    // Puts the book at the top (adding it, or moving and re-titling an existing entry).
    // Returns false (and changes nothing) when it would be a new book on a full list.
    bump({ isbn, title }, now = new Date()) {
      const books = read();
      const existing = books.find((e) => e.isbn === isbn);
      if (!existing && books.length >= limit) return false;
      const entry = existing ? { ...existing, title } : { isbn, title, addedAt: now.toISOString() };
      store.write([entry, ...books.filter((e) => e.isbn !== isbn)]);
      return true;
    },
    remove(isbn) {
      store.write(read().filter((e) => e.isbn !== isbn));
    },
    // Changes the title of a listed book (e.g. after the user names an unknown one).
    rename(isbn, title) {
      store.write(read().map((e) => (e.isbn === isbn ? { ...e, title } : e)));
    },
    clear() {
      store.write([]);
    },
  };
}
