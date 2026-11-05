// How a list is ordered: `date` is the list's own order (the newest on top), `name` is A-Z,
// `rating` puts the highest first (no rating counts as 0). The choice is remembered per list.
export const SORTS = ['date', 'name', 'rating'];

const KEY = 'isbn-reader.sort';
const collator = new Intl.Collator('uk', { sensitivity: 'base', numeric: true });

// Books whose lookup is still running stay on top, in list order, until the answer (or the end of
// the retries) is in; then they sort like the rest. `ratingOf(id)` is a number, 0 when unknown.
export function sortBooks(books, mode, { ratingOf, isWaiting }) {
  if (mode === 'date') return books;
  const waiting = books.filter((b) => isWaiting(b.id));
  const rest = books.filter((b) => !isWaiting(b.id));
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
