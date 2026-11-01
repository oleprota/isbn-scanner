// Toolbar click -> read the page (content.js) -> pick its ISBN, ask the lookup service -> content.js shows the card.
// Nothing runs before the click (activeTab), and only the ISBN leaves the browser, to our own lookup service.
import { pickIsbn } from './pickIsbn.js';
import { lookupBook } from './shared/lookup.js';
import { isbnLinks } from './shared/links.js';
import { formatRating } from './shared/strings.js';
import { frame } from './texts.js';

chrome.action.onClicked.addListener((tab) => {
  const target = { tabId: tab.id };
  chrome.scripting.executeScript({ target, func: (texts) => { globalThis.isbnReaderTexts = texts; }, args: [{ loading: frame.loading, close: frame.close, problems: frame.problems }] })
    .then(() => chrome.scripting.executeScript({ target, files: ['content.js'] }))
    .catch(() => {}); // chrome:// pages and the like
});

// content.js sends what it read; the answer is { card } or { problem } (a key of frame.problems: what went wrong).
chrome.runtime.onMessage.addListener((page, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  (async () => {
    const isbn = pickIsbn(page);
    if (!isbn) return respond({ problem: 'noIsbn' });
    let outcome;
    const details = await lookupBook(isbn, { report: (result) => { outcome = result; } });
    if (!details) return respond({ problem: outcome });
    const links = isbnLinks(isbn).map(({ name, url, title }) => ({ name, url, title }));
    const rating = details?.rating ? formatRating(details.rating) : null;
    respond({
      card: { ...details, links, rating: rating && { text: `★ ${rating.value} (${rating.count})`, title: frame.ratingTitle(rating.value, rating.count) } },
    });
  })();
  return true; // the answer comes later
});
