// How a list is ordered: `date` is the list's own order (the newest on top), `name` is A-Z,
// `rating` puts the highest first (no rating counts as 0), `custom` is the user's own order from edit mode
// (the `rank` of each book; books without one, i.e. added since, stay on top in list order).
// The choice is remembered per list.
export const SORTS = ['date', 'name', 'rating', 'custom'];

const KEY = 'isbn-reader.sort';
const collator = new Intl.Collator('uk', { sensitivity: 'base', numeric: true });

// Books whose lookup is still running stay on top, in list order, until the answer (or the end of
// the retries) is in; then they sort like the rest. `ratingOf(id)` is a number, 0 when unknown.
export function sortBooks(books, mode, { ratingOf, isWaiting }) {
  if (mode === 'date') return books;
  const waiting = books.filter((b) => isWaiting(b.id));
  const rest = books.filter((b) => !isWaiting(b.id));
  if (mode === 'custom') {
    const unranked = rest.filter((b) => typeof b.rank !== 'number');
    const ranked = rest.filter((b) => typeof b.rank === 'number').sort((a, b) => a.rank - b.rank);
    return [...waiting, ...unranked, ...ranked];
  }
  rest.sort(mode === 'name' ? (a, b) => collator.compare(a.title, b.title) : (a, b) => ratingOf(b.id) - ratingOf(a.id));
  return [...waiting, ...rest];
}

export function loadSort(storage, list) {
  try {
    const mode = JSON.parse(storage.getItem(KEY))?.[list];
    return SORTS.includes(mode) ? mode : 'date';
  } catch {
    return 'date';
  }
}

export function saveSort(storage, list, mode) {
  try {
    const saved = JSON.parse(storage.getItem(KEY));
    storage.setItem(KEY, JSON.stringify({ ...(saved && typeof saved === 'object' ? saved : {}), [list]: mode }));
  } catch {
    // storage blocked or full: the choice just won't persist
  }
}
