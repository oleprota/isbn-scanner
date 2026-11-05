// A book's id: never empty, and what a stored entry is matched by next to its ISBN (which is optional).
// Entries saved before ids existed have only an `isbn`; they get `isbn:<isbn>` on read (never written back by a read).
// `gr:<n>` is a Goodreads book the user picked by title, possibly without an ISBN.
export const isbnId = (isbn) => `isbn:${isbn}`;

// A key is an id, or a bare ISBN (meaning `isbn:<isbn>`): the stores take either.
export const toId = (key) => (key.includes(':') ? key : isbnId(key));

const hasId = (e) => typeof e.id === 'string' && e.id !== '';
// An entry is usable when it has an ISBN or an id.
export const hasKey = (e) => !!e && (typeof e.isbn === 'string' || hasId(e));
export const withId = (e) => (hasId(e) ? e : { ...e, id: isbnId(e.isbn) });
// An entry answers to a key: its id, or (for a bare ISBN) its ISBN too, since an upgraded book (`gr:<n>`) keeps its ISBN.
export const matchesKey = (e, key) => (key.includes(':') ? e.id === key : e.isbn === key || e.id === isbnId(key));
// Same book: by ISBN when both have one, else by id.
export const sameBook = (a, b) => (a.isbn && b.isbn ? a.isbn === b.isbn : a.id === b.id);

// Changes the id `isbn:X` to `gr:N` in a newest-first list and merges a duplicate that already has `gr:N`: the merged
// entry keeps the older of the two positions and `merge(from, to)` decides its fields. Any other change of id is
// refused, so different Goodreads ids stay separate books. Returns the new list, or null when nothing changes.
export function rekeyList(list, fromId, toId, merge = (from, to) => ({ ...from, ...to })) {
  if (!fromId.startsWith('isbn:') || !toId.startsWith('gr:')) return null;
  const items = list.map(withId);
  const i = items.findIndex((e) => e.id === fromId);
  if (i < 0) return null;
  const j = items.findIndex((e) => e.id === toId);
  if (j < 0) return items.map((e, k) => (k === i ? { ...e, id: toId } : e));
  const [from, to] = [items[i], items[j]];
  const merged = { ...merge(from, to), id: toId, isbn: to.isbn || from.isbn };
  if (!merged.isbn) delete merged.isbn;
  const at = Math.max(i, j); // the older one is lower in a newest-first list
  return items.flatMap((e, k) => (k === at ? [merged] : k === i || k === j ? [] : [e]));
}
