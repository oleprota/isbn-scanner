// Toolbar click (or auto-mode on an opted-in site) -> read the page (content.js) -> pick its ISBN, ask the lookup service -> content.js shows the card.
// Nothing runs before the click (activeTab) except on sites the user opted in, and only the ISBN leaves the browser, to our own lookup service.
import { pickIsbn, candidates } from './pickIsbn.js';
import { titleQuery } from './titleQuery.js';
import { readDev } from './devMode.js';
import { THIN_RATING_COUNT, lookupBook, searchBooks, setNoCache } from './shared/lookup.js';
import { isbnLinks, goodreadsSearch } from './shared/links.js';
import { card as cardTexts, formatRating } from './shared/strings.js';
import { frame, auto as autoTexts } from './texts.js';
import { sitePatterns, hostPatterns, sitesFromOrigins } from './sites.js';

// Auto-mode: for the sites the user opted in (granted site permissions), autoStart.js runs after the page loads and asks
// for the same lookup, silently. It is registered only while the master switch is on.

async function inject(tabId, url, auto) {
  const { thinCount } = await chrome.storage.sync.get({ thinCount: THIN_RATING_COUNT });
  const patterns = sitePatterns(url);
  const enabled = !!patterns && await chrome.permissions.contains({ origins: patterns });
  const target = { tabId };
  const texts = { finding: frame.finding, loading: frame.loading, close: frame.close, problems: frame.problems, pick: frame.pick, back: frame.back, auto, enabled, autoOn: autoTexts.on, autoOff: autoTexts.off, autoOnLabel: autoTexts.onLabel, autoOffLabel: autoTexts.offLabel,
    thin: cardTexts.thinTitle(thinCount), thinLabel: cardTexts.thinLabel, seriesLabel: cardTexts.seriesLabel, authorLabel: cardTexts.authorLabel };
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
const syncAutoStart = () => { syncing = syncing.then(registerAutoStart).catch((error) => console.error('auto-mode: registering failed', error)); };
// The master switch is also a checkbox in the toolbar icon's right-click menu (the options page sets the same value).
chrome.runtime.onInstalled.addListener(async () => {
  const { autoMode } = await chrome.storage.sync.get({ autoMode: true });
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'autoMode', title: autoTexts.menu(autoMode), contexts: ['action'] });
  chrome.contextMenus.create({ id: 'autoSite', title: autoTexts.menuSite(false), contexts: ['action'] });
  refreshSiteMenu();
  syncAutoStart();
});
// The second item names the current site's state. The address of a tab on a site not in the list is hidden from us,
// which reads as "off", so no extra permission is needed.
// Open cards update their auto-search link when a site was added or removed from anywhere.
async function tellCards() {
  for (const tab of await chrome.tabs.query({})) chrome.tabs.sendMessage(tab.id, { siteChanged: true }).catch(() => {}); // most tabs have no card
}

async function refreshSiteMenu() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const origins = sitePatterns(tab?.url);
  const on = !!origins && await chrome.permissions.contains({ origins });
  chrome.contextMenus.update('autoSite', { title: autoTexts.menuSite(on) }).catch(() => {});
}
chrome.tabs.onActivated.addListener(refreshSiteMenu);
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'complete' || change.url) refreshSiteMenu(); });
chrome.windows.onFocusChanged.addListener(refreshSiteMenu);
chrome.runtime.onStartup.addListener(refreshSiteMenu);
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'autoSite') return void toggleSite(tab?.url).catch(() => {}); // same as the card's link
  if (info.menuItemId !== 'autoMode') return;
  const { autoMode } = await chrome.storage.sync.get({ autoMode: true });
  chrome.storage.sync.set({ autoMode: !autoMode });
});
chrome.runtime.onStartup.addListener(syncAutoStart);
chrome.permissions.onAdded.addListener(({ origins }) => {
  syncAutoStart();
  refreshSiteMenu();
  tellCards();
  // Registered scripts only reach pages loaded from now on: start the already open tabs of the new site too.
  syncing = syncing.then(async () => {
    const { autoMode } = await chrome.storage.sync.get({ autoMode: true });
    if (!autoMode || !origins?.length) return;
    for (const tab of await chrome.tabs.query({ url: origins })) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['autoStart.js'] });
  }).catch((error) => console.error('auto-mode: starting open tabs failed', error));
});
chrome.permissions.onRemoved.addListener(() => { syncAutoStart(); refreshSiteMenu(); tellCards(); });
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.autoMode) return;
  chrome.contextMenus.update('autoMode', { title: autoTexts.menu(changes.autoMode.newValue !== false) }).catch(() => {});
  syncAutoStart();
});

// content.js sends what it read; the answer is { card } or { problem, message? } (a key of frame.problems, or the lookup's own message: what went wrong).
chrome.runtime.onMessage.addListener((page, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (page.auto) { // a tab opened before the switch went off or the site was removed may still ask
    chrome.storage.sync.get({ autoMode: true }).then(({ autoMode }) => autoMode && inject(sender.tab.id, sender.tab.url, true)).catch((error) => console.error('auto-mode: injecting failed', error));
    return;
  }
  if (page.siteState) { // does the sender's site have auto-search on? (the card's link asks after a change)
    const origins = sitePatterns(sender.tab.url);
    (origins ? chrome.permissions.contains({ origins }) : Promise.resolve(false)).then((enabled) => respond({ enabled }));
    return true;
  }
  if (page.toggleSite) { toggleSite(sender.tab.url).then(respond); return true; }
  (async () => {
    const isbn = pickIsbn(page);
    // Developer mode (options page; ADR-0003) adds a line of facts to the answer, and its "no cache" check skips the caches.
    const { developer, noCache } = await readDev();
    const { thinCount } = await chrome.storage.sync.get({ thinCount: THIN_RATING_COUNT });
    setNoCache(developer && noCache);
    const debug = (text) => (developer ? { debug: `dev: ${text}` } : {});
    if (!isbn) {
      // A manual click on a page with no ISBN: offer Goodreads' best guesses for its title (ratings come with them; ADR 0005's links).
      const query = page.fallback && titleQuery(page);
      const found = query ? await searchBooks(query) : null;
      if (found?.length) return respond({ picks: found.map((c) => pickCard(c, thinCount)), ...debug(`no ISBN, searched "${query}"`) });
      return respond({ problem: 'noIsbn', ...debug('no ISBN found') });
    }
    chrome.tabs.sendMessage(sender.tab.id, { searching: true }).catch(() => {}); // ISBN found: now the Goodreads lookup
    let why, outcome, took, detail;
    const details = await lookupBook(isbn, { report: (o, ms, d) => { [outcome, took, detail] = [o, ms, d]; why = cardTexts.lookupWhy({ outcome: o, ...d }); } });
    const seen = candidates(page).map((c) => `${c.isbn}${['', ' paper'][c.rank] ?? ' e-book/audio'} (${c.score})`).join(', ');
    const facts = debug(`${isbn} · of ${seen} · ${outcome}${Object.keys(detail ?? {}).length ? ` ${JSON.stringify(detail)}` : ''} · ${took} ms`);
    if (!details) return respond({ problem: 'lookup', message: why, ...facts });
    const links = isbnLinks(isbn).map(({ name, url, title, icon }) => ({ name, url, title, icon: chrome.runtime.getURL(icon) }));
    respond({ ...facts, card: { ...details, isbn, links, rating: shapeRating(details.rating, thinCount), seriesUrl: details.series && (details.series.url || goodreadsSearch(details.series.name)) } });
  })();
  return true; // the answer comes later
});

// A title-search result as a card (no ISBN: links go by search or page, see isbnLinks)
const pickCard = (c, thinCount) => ({
  title: c.title,
  image: c.image,
  author: c.author ? { name: c.author, url: c.authorUrl } : null,
  rating: shapeRating(c.rating > 0 && c.ratingCount > 0 ? { value: c.rating, count: c.ratingCount } : null, thinCount),
  links: isbnLinks(null, { title: c.title, author: c.author, url: c.bookUrl }).map((l) => ({ ...l, icon: chrome.runtime.getURL(l.icon) })),
});

// A rating as the card shows it: the formatted value and count, its tooltip, and whether it is thin (orange, with a warning).
const shapeRating = (rating, thinCount) => {
  if (!rating) return null;
  const { value, count } = formatRating(rating);
  return { value, count, title: frame.ratingTitle(value, count), thin: rating.count < thinCount };
};

// The card's link: opt the site out right away, or open grant.html to opt it in (Chrome allows the permission prompt
// only after a click on an extension page). The answer is whether the site is on now.
async function toggleSite(url) {
  const origins = sitePatterns(url);
  if (!origins) return { enabled: false };
  if (await chrome.permissions.contains({ origins })) return { enabled: !(await chrome.permissions.remove({ origins })) };
  await chrome.tabs.create({ url: chrome.runtime.getURL(`grant.html?url=${encodeURIComponent(url)}`) });
  return { enabled: false };
}
