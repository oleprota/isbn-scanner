// A list of entries with an `id` (derived from the `isbn` of older entries, see src/bookId.js), one per id, newest first, up to `limit`: the shape under
// the typed names, the titles books were found by and what the lookup found (src/bookTitles.js). `valid` drops corrupt stored entries.
import { toId, withId, rekeyList, matchesKey } from './bookId.js';

// an `isbn:<isbn>` entry also carries the ISBN, as entries of earlier versions do
const full = (entry) => {
  const e = withId(entry);
  return e.isbn || !e.id.startsWith('isbn:') ? e : { ...e, isbn: e.id.slice(5) };
};

export function createKeyed(store, valid, limit = 1000) {
  const list = () => store.read().filter(valid).slice(0, limit).map(withId);
  const others = (key) => list().filter((e) => e.id !== toId(key));
  return {
    all: list,
    get: (key) => list().find((e) => matchesKey(e, key)) ?? null,
    put: (entry) => store.write([full(entry), ...others(full(entry).id)].slice(0, limit)),
    rekey(fromId, toId, merge) {
      const next = rekeyList(list(), fromId, toId, merge);
      if (next) store.write(next);
    },
    remove: (key) => store.write(others(key)),
  };
}
