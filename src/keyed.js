// A list of entries with an `isbn` (and a derived `id`, see src/bookId.js), one per ISBN, newest first, up to `limit`: the shape under
// the typed names, the titles books were found by and what the lookup found (src/bookTitles.js). `valid` drops corrupt stored entries.
import { withId, rekeyList } from './bookId.js';

export function createKeyed(store, valid, limit = 1000) {
  const list = () => store.read().filter(valid).slice(0, limit).map(withId);
  const others = (isbn) => list().filter((e) => e.isbn !== isbn);
  return {
    all: list,
    get: (isbn) => list().find((e) => e.isbn === isbn) ?? null,
    put: (entry) => store.write([entry, ...others(entry.isbn)].slice(0, limit)),
    rekey(fromId, toId, merge) {
      const next = rekeyList(list(), fromId, toId, merge);
      if (next) store.write(next);
    },
    remove: (isbn) => store.write(others(isbn)),
  };
}
