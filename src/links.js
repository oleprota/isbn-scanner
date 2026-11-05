// Where to look a book up by ISBN. Link-only: the pages can't be read from here (no CORS).
// The icons are the sites' own icons, saved in icons/ (see icons/README.md), so nothing is
// fetched from the sites to show them.
import { card } from './strings.js';

// A book found by title (`found`: { title, author, url }, see bookTitles.js) links to searches instead of the ISBN:
// Ereadian for the title alone (its search misses a book when an author is spelled differently there), Goodreads
// for its page (`url`, the page address of the book picked), or for the title and the author when the book has no
// page address (the title alone finds too many other books). A book with no ISBN is always one found by title.
export function isbnLinks(isbn, found = null) {
  const q = encodeURIComponent(isbn);
  if (!found) {
    return [
      { name: 'Ereadian', url: `https://ereadian.com/search?q=${q}`, icon: 'icons/ereadian.png', title: card.linkTitle(isbn, 'Ereadian') },
      { name: 'Goodreads', url: `https://www.goodreads.com/book/isbn/${q}`, icon: 'icons/goodreads.png', title: card.linkTitle(isbn, 'Goodreads') },
    ];
  }
  const withAuthor = [found.title, found.author].filter(Boolean).join(' ');
  const goodreads = found.url
    ? { url: found.url, title: card.pageLinkTitle(found.title, 'Goodreads') }
    : { url: goodreadsSearch(withAuthor), title: card.searchLinkTitle(withAuthor, 'Goodreads') };
  return [
    { name: 'Ereadian', url: `https://ereadian.com/search?q=${encodeURIComponent(found.title)}`, icon: 'icons/ereadian.png', title: card.searchLinkTitle(found.title, 'Ereadian') },
    { name: 'Goodreads', icon: 'icons/goodreads.png', ...goodreads },
  ];
}

// A Goodreads search by text. Also stands in for a series' own page, which has an id that the lookup
// does not return.
export const goodreadsSearch = (text) => `https://www.goodreads.com/search?q=${encodeURIComponent(text)}`;
