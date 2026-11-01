// Toolbar click (or auto-mode on an opted-in site) -> read the page (content.js) -> pick its ISBN, ask the lookup service -> content.js shows the card.
// Nothing runs before the click (activeTab) except on sites the user opted in, and only the ISBN leaves the browser, to our own lookup service.
import { pickIsbn } from './pickIsbn.js';
import { lookupBook } from './shared/lookup.js';
import { isbnLinks } from './shared/links.js';
import { formatRating } from './shared/strings.js';
import { frame, auto as autoTexts } from './texts.js';
import { sitePatterns, hostPatterns, sitesFromOrigins } from './sites.js';

// Auto-mode: for the sites the user opted in (granted site permissions), autoStart.js runs after the page loads and asks
// for the same lookup, silently. It is registered only while the master switch is on.

async function inject(tabId, url, auto) {
  const patterns = sitePatterns(url);
  const enabled = !!patterns && await chrome.permissions.contains({ origins: patterns });
  const target = { tabId };
  const texts = { loading: frame.loading, close: frame.close, problems: frame.problems, auto, enabled, autoOn: autoTexts.on, autoOff: autoTexts.off };
  await chrome.scripting.executeScript({ target, func: (t) => { globalThis.isbnReaderTexts = t; }, args: [texts] });
  await chrome.scripting.executeScript({ target, files: ['content.js'] });
}

chrome.action.onClicked.addListener((tab) => {
  inject(tab.id, tab.url, false).catch(() => {}); // chrome:// pages and the like
});

async function registerAutoStart() {
  const { autoMode } = await chrome.storage.sync.get({ autoMode: true });
  const { origins } = await chrome.permissions.getAll();
  const matches = sitesFromOrigins(origins).flatMap(hostPatterns);
  await chrome.scripting.unregisterContentScripts({ ids: ['auto'] }).catch(() => {});
  if (autoMode && matches.length) await chrome.scripting.registerContentScripts([{ id: 'auto', js: ['autoStart.js'], matches, runAt: 'document_idle' }]);
}
// one at a time: overlapping runs would register the same id twice
let syncing = Promise.resolve();
const syncAutoStart = () => { syncing = syncing.then(registerAutoStart).catch(() => {}); };
chrome.runtime.onInstalled.addListener(syncAutoStart);
chrome.runtime.onStartup.addListener(syncAutoStart);
chrome.permissions.onAdded.addListener(syncAutoStart);
chrome.permissions.onRemoved.addListener(syncAutoStart);
chrome.storage.onChanged.addListener((changes) => { if (changes.autoMode) syncAutoStart(); });

// content.js sends what it read; the answer is { card } or { problem } (a key of frame.problems: what went wrong).
chrome.runtime.onMessage.addListener((page, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (page.auto) { // a tab opened before the switch went off or the site was removed may still ask
    chrome.storage.sync.get({ autoMode: true }).then(({ autoMode }) => autoMode && inject(sender.tab.id, sender.tab.url, true)).catch(() => {});
    return;
  }
  if (page.toggleSite) { toggleSite(sender.tab.url).then(respond); return true; }
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

// The card's link: opt this site in (Chrome asks the user) or out. The answer is whether it is on now.
async function toggleSite(url) {
  const origins = sitePatterns(url);
  if (!origins) return { enabled: false };
  if (await chrome.permissions.contains({ origins })) return { enabled: !(await chrome.permissions.remove({ origins })) };
  return { enabled: await chrome.permissions.request({ origins }).catch(() => false) };
}
