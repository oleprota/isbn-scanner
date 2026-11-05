import { isValidIsbn, normalizeIsbn } from './isbn.js';

// Deep links look like `#isbn=9780747532699`.
export function isbnFromHash(hash) {
  const match = /^#isbn=([^&]+)/.exec(hash ?? '');
  if (!match) return null;
  let raw;
  try {
    raw = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const isbn = normalizeIsbn(raw);
  return isValidIsbn(isbn) ? isbn : null;
}

export function hashForIsbn(isbn) {
  return `#isbn=${encodeURIComponent(isbn)}`;
}

// A book with no ISBN (picked by title) links by its Goodreads id: `#gr=1885`.
export function grFromHash(hash) {
  const match = /^#gr=(\d{1,12})(?:&|$)/.exec(hash ?? '');
  return match ? match[1] : null;
}

export function hashForGr(id) {
  return `#gr=${id}`;
}
