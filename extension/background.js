// Toolbar click -> read the page (content.js) -> pick its ISBN, ask the lookup service -> content.js shows the card.
// Nothing runs before the click (activeTab), and only the ISBN leaves the browser, to our own lookup service.
import { pickIsbn } from './pickIsbn.js';
import { lookupBook } from './shared/lookup.js';
import { isbnLinks } from './shared/links.js';
import { formatRating } from './shared/strings.js';
import { frame } from './texts.js';

chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {}); // chrome:// pages and the like
});

// content.js sends what it read; the answer is { card } (null = nothing found) and the texts.
chrome.runtime.onMessage.addListener((page, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  (async () => {
    const isbn = pickIsbn(page);
    const details = isbn && (await lookupBook(isbn));
    const links = details ? isbnLinks(isbn).map(({ name, url, title }) => ({ name, url, title })) : [];
    const rating = details?.rating ? formatRating(details.rating) : null;
    respond({
      card: details && { ...details, links, rating: rating && { text: `★ ${rating.value} (${rating.count})`, title: frame.ratingTitle(rating.value, rating.count) } },
      texts: { notFound: frame.notFound, close: frame.close },
    });
  })();
  return true; // the answer comes later
});
