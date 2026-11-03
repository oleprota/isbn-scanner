// Toolbar click (or auto-mode on an opted-in site) -> read the page (content.js) -> pick its ISBN, ask the lookup service -> content.js shows the card.
// Nothing runs before the click (activeTab) except on sites the user opted in, and only the ISBN leaves the browser, to our own lookup service.
import { pickIsbn } from './pickIsbn.js';
import { THIN_RATING_COUNT, isThin, lookupBook } from './shared/lookup.js';
import { isbnLinks } from './shared/links.js';
import { card as cardTexts, formatRating } from './shared/strings.js';
import { frame, auto as autoTexts } from './texts.js';
import { sitePatterns, hostPatterns, sitesFromOrigins } from './sites.js';

// Auto-mode: for the sites the user opted in (granted site permissions), autoStart.js runs after the page loads and asks
// for the same lookup, silently. It is registered only while the master switch is on.

async function inject(tabId, url, auto) {
  const patterns = sitePatterns(url);
  const enabled = !!patterns && await chrome.permissions.contains({ origins: patterns });
  const target = { tabId };
  const texts = { finding: frame.finding, loading: frame.loading, close: frame.close, problems: frame.problems, auto, enabled, autoOn: autoTexts.on, autoOff: autoTexts.off,
    thin: cardTexts.thinTitle(THIN_RATING_COUNT), thinLabel: cardTexts.thinLabel };
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
    if (!isbn) return respond({ problem: 'noIsbn' });
    chrome.tabs.sendMessage(sender.tab.id, { searching: true }).catch(() => {}); // ISBN found: now the Goodreads lookup
    let why;
    const details = await lookupBook(isbn, { report: (outcome, ms, detail) => { why = cardTexts.lookupWhy({ outcome, ...detail }); } });
    if (!details) return respond({ problem: 'lookup', message: why });
    const links = isbnLinks(isbn).map(({ name, url, title, icon }) => ({ name, url, title, icon: chrome.runtime.getURL(icon) }));
    respond({ card: { ...details, isbn, links, rating: shapeRating(details.rating) } });
  })();
  return true; // the answer comes later
});

// A rating as the card shows it: the formatted value and count, its tooltip, and whether it is thin (orange, with a warning).
const shapeRating = (rating) => {
  if (!rating) return null;
  const { value, count } = formatRating(rating);
  return { value, count, title: frame.ratingTitle(value, count), thin: isThin(rating) };
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
