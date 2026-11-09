// The user's thin-rating threshold: a rating with fewer votes than this gets the ⚠ warning.
// Remembered in storage; the default is stored as nothing. Nothing here may throw (storage can be blocked).
import { THIN_RATING_COUNT } from './lookup.js';

const KEY = 'isbn-reader.thin';

// A whole number of 1 or more, or null.
export function cleanThin(value) {
  const count = Math.round(Number(value));
  return Number.isFinite(count) && count >= 1 ? count : null;
}

export function loadThin(storage) {
  try {
    return cleanThin(storage.getItem(KEY)) ?? THIN_RATING_COUNT;
  } catch {
    return THIN_RATING_COUNT;
  }
}

export function saveThin(storage, count) {
  try {
    if (count === THIN_RATING_COUNT) storage.removeItem(KEY);
    else storage.setItem(KEY, String(count));
  } catch {
    // storage blocked: the choice just won't persist
  }
}
