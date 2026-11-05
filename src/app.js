import { isValidIsbn, looksLikeIsbn, normalizeIsbn } from './isbn.js';
import { isbnLinks } from './links.js';
import { startScanner } from './scanner.js';
import { createScanSession } from './scanSession.js';
import { grFromHash, hashForGr, hashForIsbn, isbnFromHash } from './hash.js';
import { isbnId } from './bookId.js';
import { candidateId, detailsFromCandidate } from './candidate.js';
import { createRefreshGate } from './refreshGate.js';
import { createListStore } from './storage.js';
import { bucket, createStats, describeClient } from './stats.js';
import { createBookList } from './bookList.js';
import { NAME_MAX, createBookTitles } from './bookTitles.js';
import { cleanText } from './text.js';
import { loadSort, saveSort } from './sort.js';
import { coverImage, factsBlock, isbnRows, ratingBlock } from './details.js';
import { LOOKUP_URL, bookPageUrl, editionOfBook, lookupBook, searchBooks, setNoCache } from './lookup.js';
import { createListView, createMarkToggle, iconButton } from './listView.js';
import { el, linkButton, spinner } from './dom.js';
import { applyTheme, loadTheme, nextTheme, saveTheme } from './theme.js';
import * as str from './strings.js';

str.applyStrings(document);
if (['localhost', '127.0.0.1'].includes(location.hostname)) document.title += str.page.localSuffix; // the local copy is told apart on the tab

const form = document.getElementById('search');
const input = document.getElementById('isbn');
const status = document.getElementById('status');
const result = document.getElementById('result');
const button = form.querySelector('button[type="submit"]');
const scanButton = document.getElementById('scan');
const scanLabel = document.getElementById('scan-label');
const scanner = document.getElementById('scanner');
let preview = document.getElementById('preview'); // plays the camera, out of sight
const view = document.getElementById('view'); // shows it
const themeButton = document.getElementById('theme');

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null; // blocked storage: lists just won't persist
  }
}

// Anonymous usage counts (src/stats.js): #dev / #nodev (the developer flag) is read from the address and then removed from it.
const stats = createStats({
  url: LOOKUP_URL,
  storage: browserStorage(),
  hash: location.hash,
  hostname: location.hostname,
  doNotTrack: navigator.doNotTrack === '1',
});
if (/^#(no)?dev$/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && stats.flush());
window.addEventListener('pagehide', stats.flush);
const statsNote = document.getElementById('stats-note');
statsNote.textContent = str.page.statsNote(stats.id, stats.dev);
statsNote.hidden = !stats.enabled;
// Dev only: unticking the box makes every request skip the worker's cache; a reload ticks it again.
const devTools = document.getElementById('dev-tools');
devTools.hidden = !(stats.enabled && stats.dev);
document.getElementById('dev-cache').addEventListener('change', (event) => setNoCache(!event.target.checked));

// "Scanned" is everything searched or scanned; "Marked" is the subset the user picked.
const scanned = createBookList(createListStore(browserStorage(), 'isbn-reader.scanned'));
const marked = createBookList(createListStore(browserStorage(), 'isbn-reader.marked'));
// What a book is called, the title it was found by, what the lookup found: see src/bookTitles.js.
const titles = createBookTitles({
  names: createListStore(browserStorage(), 'isbn-reader.names'),
  foundBy: createListStore(browserStorage(), 'isbn-reader.search'),
  details: createListStore(browserStorage(), 'isbn-reader.meta'),
  lists: [scanned, marked],
});

// Opening a book from a list shows its card but does not move it in Scanned: only a new
// search or scan does that.
// A full list refuses new books. The book is still shown on its card; this warning sits
// between the card and the lists until the next search or scan, or until there is room again.
const warning = document.getElementById('list-warning');
let warnedList = null;

function warnFull(name, list) {
  warnedList = list;
  warning.textContent = str.lists.listFull(name, list.limit, str.lists.fullAdvice[name]);
  warning.hidden = false;
}

function clearWarning() {
  warnedList = null;
  warning.hidden = true;
}

// A book from a list: one with an ISBN is searched again, one without (picked by title) shows its card from what is stored.
const openBook = (book) => {
  if (book.isbn) {
    input.value = book.isbn;
    search(book.isbn, { move: false, via: 'list' });
  } else showPicked(book);
};
const listElements = (id) => ({
  section: document.getElementById(id),
  count: document.getElementById(`${id}-count`),
  items: document.getElementById(`${id}-list`),
  empty: document.getElementById(`${id}-empty`),
  copy: document.getElementById(`copy-${id}`),
  clear: document.getElementById(`clear-${id}`),
});

// Marking changes both lists (the stars in Scanned) and every star on the page.
function renderLists() {
  if (warnedList && !warnedList.isFull()) clearWarning(); // room again (Clear, Unmark)
  scannedView.render();
  markedView.render();
  markToggle.syncAll();
}
const markToggle = createMarkToggle({
  marked,
  onChange: renderLists,
  onFull: () => warnFull('marked', marked),
  onToggle: (on) => stats.track('star', { on: on ? 1 : 0 }),
});
// What the two lists share; `name` is the list's name in the page, in the stored sort order and in the usage stats.
const listView = (name, list, own) => createListView({
  list,
  onOpen: openBook,
  onChange: renderLists,
  isWaiting: (id) => pending.has(id),
  ratings: titles.ratings,
  thinRatings: titles.thinRatings,
  foundBy: titles.allFoundBy,
  details: titles.details,
  sortMode: loadSort(browserStorage(), name),
  onSort: (mode) => {
    saveSort(browserStorage(), name, mode);
    stats.track('sort', { list: name, mode });
  },
  onCopy: (ok) => stats.track('copy', { list: name, ok: ok ? 1 : 0 }),
  notify: (text, isError) => setStatus(text, isError, isError ? 0 : NOTE_MS),
  elements: listElements(name),
  ...own,
});
const scannedView = listView('scanned', scanned, {
  confirmClear: str.lists.clearScanned,
  rowButton: (book) => markToggle.create(book),
});
const markedView = listView('marked', marked, {
  confirmClear: str.lists.clearMarked,
  rowButton: (book) => {
    const remove = iconButton('✕', str.card.unmark);
    remove.addEventListener('click', () => {
      marked.remove(book.id);
      stats.track('star', { on: 0 });
      renderLists();
    });
    return remove;
  },
});

// `ttl`: the message clears itself after that many ms unless another one replaces it first.
let statusTimer = null;
function setStatus(text, isError = false, ttl = 0) {
  clearTimeout(statusTimer);
  status.textContent = text;
  status.className = isError ? 'error' : '';
  if (ttl && text) statusTimer = setTimeout(() => setStatus(''), ttl);
}

// Messages about what was typed (invalid ISBN, camera unavailable, list full) go away as soon as
// the field is edited; a confirmation (Copied) goes away on its own.
const NOTE_MS = 4000;
input.addEventListener('input', () => {
  hideCandidates();
  setStatus('');
  clearWarning();
});


// The title on a card is also where the book is named: tap it to type a name (Enter or leaving
// the field saves, Escape cancels); an empty name goes back to `ISBN <number>`. The name is saved
// per book and also updates the Scanned and Marked entries for that book.
// Returns the heading, `update(title)` for a title that arrives later from the lookup, and
// `setWaiting(on)` for the spinner beside the title that shows the lookup is still running.
function titleHeading(book, waiting) {
  const heading = el('h2', null, 'book-title');
  const slot = el('span', null, 'title-slot'); // the title button or the editor field
  const ring = spinner(str.search.lookingUp);
  heading.append(slot);
  const setWaiting = (on) => (on ? heading.append(ring) : ring.remove());

  // `refocus`: the editor was closed from the keyboard, so keep the focus on the title
  // (otherwise it would fall back to the top of the page).
  function showTitle(refocus = false) {
    const title = el('button', book.title, 'title-edit');
    title.type = 'button';
    title.title = str.card.editName;
    title.addEventListener('click', startEditing);
    slot.classList.remove('editing');
    slot.replaceChildren(title);
    if (refocus) title.focus();
  }

  function save(raw, initial) {
    const value = cleanText(raw, NAME_MAX);
    if (value === initial) return; // unchanged: this also keeps titles saved by earlier versions
    stats.track('title_edit', { cleared: value ? 0 : 1 });
    const title = titles.rename(book.id, value);
    if (title === book.title) return; // e.g. an empty name on a card that already shows the default
    book.title = title;
    renderLists();
  }

  function startEditing() {
    const field = el('input', null, 'title-input');
    field.type = 'text';
    field.maxLength = NAME_MAX;
    const initial = book.title; // a title found by the lookup meanwhile is not a change made here
    field.value = initial;
    field.placeholder = titles.fallback(book.id); // what an empty name turns back into
    field.setAttribute('aria-label', str.card.nameLabel);
    let finished = false;
    const finish = (keep, refocus) => {
      if (finished) return; // Enter and the blur that follows it must not save twice
      finished = true;
      if (keep) save(field.value, initial);
      showTitle(refocus);
    };
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault(); // else the Enter is also delivered to the title button that takes the field's place, and reopens the editor
        finish(true, true);
      }
      if (event.key === 'Escape') finish(false, true);
    });
    field.addEventListener('blur', () => finish(true, false));
    slot.classList.add('editing');
    slot.replaceChildren(field);
    field.focus();
    field.select();
  }

  // while the editor is open the field keeps what the user typed; the new title shows after it closes
  function update(title) {
    book.title = title;
    if (slot.querySelector('button')) showTitle();
  }

  showTitle();
  setWaiting(waiting);
  return { heading, update, setWaiting };
}

// The card on screen, so that a lookup answer can reach it: { card, book, update, setDetails, setWaiting, refresh, failure }.
// `book` is { id, isbn?, title }: a book picked by title has no ISBN until its edition request answers (kept in its
// details). `failure`: this card's own memory of a failed edition request ({ outcome, reason, status }), never stored.
let shown = null;
const refreshGate = createRefreshGate(); // one refresh a minute, for every book

function renderBook(book) {
  const card = el('article', null, 'book');
  const head = el('div', null, 'book-head');
  const body = el('div', null, 'book-main');
  const { heading, update, setWaiting } = titleHeading(book, pending.has(book.id));
  body.append(heading);
  const facts = el('div', null, 'facts-slot');
  const links = el('div', null, 'link-row');
  const self = { card, book, failure: null };
  // series, author and the ISBN row under the head, and the links: they follow what is known now (the ISBN
  // may arrive after the card was built, and so may the request's progress)
  const refresh = () => {
    const found = titles.details(book.id);
    const isbn = book.isbn ?? found?.isbn;
    facts.replaceChildren(factsBlock(found ?? {}, isbnRows({
      isbn,
      running: editionsRunning.has(book.id),
      failed: Boolean(self.failure),
      why: self.failure && str.card.lookupWhy(self.failure),
      retry: () => requestEdition(book.id, { retry: true }),
    })));
    links.replaceChildren(...isbnLinks(isbn, titles.foundBy(book.id)).map((link) => linkButton(link, { big: true })));
  };
  // what the lookup found: the cover beside the title, the rating under it, then the rest
  const setDetails = (found) => {
    head.querySelector('.cover')?.remove();
    if (found?.image) head.prepend(coverImage(found.image));
    body.querySelector('.rating')?.remove();
    if (found?.rating) heading.after(ratingBlock(found.rating));
    refresh();
  };
  // the star sits at the right edge of the card, like the buttons at the end of the list rows
  const refreshButton = iconButton('\u21BB\uFE0E', str.card.refresh); // ↻
  refreshButton.classList.add('refresh');
  refreshButton.hidden = !LOOKUP_URL;
  refreshButton.addEventListener('click', () => {
    if (!refreshGate.ready() || pending.has(book.id) || editionsRunning.has(book.id)) return; // a request already out: nothing to ask, keep the minute
    refreshGate.start();
    stats.track('refresh', { by_title: book.id.startsWith('gr:') ? 1 : 0 });
    if (book.id.startsWith('gr:')) requestEdition(book.id, { retry: true, fresh: true });
    else requestMeta(book.id.slice(5), { fresh: true });
    shown?.syncRefresh();
    setTimeout(() => shown?.syncRefresh(), refreshGate.left()); // every card's button opens again together
  });
  const syncRefresh = () => { refreshButton.disabled = !refreshGate.ready(); };
  syncRefresh();
  head.append(body, refreshButton, markToggle.create(book));
  setDetails(titles.details(book.id));
  card.append(head, facts, links);
  result.replaceChildren(card);
  shown = Object.assign(self, { syncRefresh, update, setDetails, setWaiting, refresh, refreshLinks: refresh });
}

// Asks the lookup service for the book's name and cover, in the background: the card, the beep and
// "Додано" never wait for it, and a failure is silent. One request per ISBN per page load.
const asked = new Set();
const pending = new Set(); // asked and not answered yet: its card shows a spinner beside the title
const editionsRunning = new Set(); // books picked by title whose edition request is out (asked again at every card until it answers)

// `fresh`: the user's refresh button; it asks again even when the details are current, and skips the service's caches.
function requestMeta(isbn, { fresh = false } = {}) {
  const id = titles.idOf(isbn);
  // an entry saved by an older version lacks the new fields: it is shown until the answer replaces it
  if (!LOOKUP_URL || pending.has(id) || (!fresh && (titles.detailsCurrent(id) || asked.has(id)))) return;
  asked.add(id);
  pending.add(id);
  if (fresh && shownCard(id)) shown.setWaiting(true);
  renderLists(); // the rows of this book show the spinner too (several lookups can run at once while scanning)
  lookupBook(isbn, { fresh, report: (result, ms, detail) => stats.track('lookup', { result, ms, reason: detail?.reason }) }).then((found) => {
    pending.delete(id);
    if (found) return applyLookup(id, isbn, found);
    asked.delete(id); // nothing changed: the next card of this book asks again
    if (shownCard(id)) shown.setWaiting(false);
    renderLists();
  });
}

// The answer for an ISBN: when it carries the Goodreads book id, the book `isbn:X` becomes `gr:N` (merging a book already
// stored as `gr:N`), and a book found by title gets its Goodreads page address. Silent.
function applyLookup(id, isbn, { bookId, ...found }) {
  let now = id;
  if (bookId && id.startsWith('isbn:')) {
    now = `gr:${bookId}`;
    titles.rekey(id, now);
    const picked = titles.foundBy(now);
    if (picked && !picked.url) titles.setFoundBy(now, { ...picked, url: bookPageUrl(bookId) });
    if (shown?.book.id === id) { // the card on screen is that book: it follows the id
      shown.book.id = now;
      shown.card.querySelector('.mark-toggle').dataset.id = now;
      shown.refreshLinks(titles.foundBy(now));
    }
  }
  applyMeta(now, found, isbn);
}

// The edition request of a book picked by title (`gr:<n>`), in the background: its card and row are already there.
// The answer replaces the partial details with current ones and stores the ISBN (not shown yet); a book already
// known by that ISBN is merged into this one. A failure never blocks anything: the card shows "(не знайдено)" with
// a button (`retry`: the user's) and nothing is remembered, so every card built for the book asks again.
// The answer is reported once to the usage stats (`isbn_found`).
function requestEdition(id, { retry = false, fresh = false } = {}) {
  if (!LOOKUP_URL || editionsRunning.has(id) || (!fresh && titles.detailsCurrent(id) && titles.details(id).isbn)) return;
  editionsRunning.add(id);
  let why = {};
  if (shownCard(id)) shown.refresh();
  editionOfBook(id.slice(3), { fresh, report: (outcome, ms, detail) => { why = { outcome, ms, ...detail }; } }).then((edition) => {
    editionsRunning.delete(id);
    stats.track('isbn_found', { found: edition ? 1 : 0, result: why.outcome, reason: why.reason, ms: why.ms, retry: retry ? 1 : 0, details: edition?.found ? 1 : 0 });
    if (shownCard(id)) shown.failure = edition ? null : why;
    if (edition) {
      titles.rekey(isbnId(edition.isbn), id);
      if (edition.found) applyMeta(id, edition.found, edition.isbn);
      else if (titles.details(id) && !(fresh && titles.detailsCurrent(id))) titles.setDetails(id, titles.details(id), { partial: true, isbn: edition.isbn });
    }
    if (shownCard(id)) shown.refresh();
    renderLists();
  });
}

const shownCard = (id) => shown?.book.id === id && result.contains(shown.card);

// A found title only replaces the default `ISBN <number>` or the title an earlier lookup of this
// book gave (older versions kept the series bracket in it): never a typed name or another title.
function applyMeta(id, found, isbn) {
  const replaceable = titles.setDetails(id, found, { isbn });
  // an answer for a card that is no longer on screen only fills the cache
  if (shownCard(id)) {
    shown.setWaiting(false);
    if (replaceable(shown.book.title)) shown.update(titles.of(id)); // not found.title: a merge may have brought a typed name
    shown.setDetails(found);
  }
  renderLists();
}

// Camera scanning: the lifecycle is in src/scanSession.js, this page reacts to its outcomes.
// The field and Search are locked while the camera is on; the Scan button
// turns into Stop (the way out of a scan).
function updateControls() {
  const scanning = session.active;
  input.disabled = scanning;
  button.disabled = scanning;
  scanLabel.textContent = scanning ? str.scanner.stop : str.scanner.scan;
  scanButton.classList.toggle('stop', scanning);
  scannedView.setLocked(scanning);
  markedView.setLocked(scanning);
}

const closeScanner = () => session.close();

// Continuous scanning (hold the Scan button): the camera stays on and each new book is added to Scanned.
let audio = null;

const BEEP_NEW = 880; // Hz
const BEEP_AGAIN = 520; // lower: the book was already scanned
const BEEP_FULL = 330; // lowest: the list is full, the book was not added

// Browsers only allow sound after a tap, and a scan result arrives long after it (the camera
// start is asynchronous). So the audio is created and unlocked in the Scan tap.
// Returns a promise that settles once the audio is running (it never rejects).
function prepareAudio() {
  try {
    audio ??= new AudioContext();
    return Promise.resolve(audio.resume?.()).catch(() => {});
  } catch {
    // no audio available: the status line still shows what happened
    return Promise.resolve();
  }
}

// The matching visual: a short flash over the page (amber for a new book, blue for a repeat,
// red when the list is full and the book was not added).
const snapEl = document.getElementById('snap');
function flashSnap(kind) {
  snapEl.classList.remove('flash');
  void snapEl.offsetWidth; // restart the animation when scans follow each other quickly
  snapEl.classList.toggle('again', kind === 'again');
  snapEl.classList.toggle('full', kind === 'full');
  snapEl.classList.add('flash');
}

// A short beep tells the user, without looking at the screen, that the camera read a barcode:
// a higher tone for a new book, a lower one for one that was already scanned, the lowest
// (with a red flash) when the Scanned list is full and the book was not added.
function confirmScan(frequency = BEEP_NEW) {
  flashSnap({ [BEEP_AGAIN]: 'again', [BEEP_FULL]: 'full' }[frequency] ?? 'new');
  // a context that is still resuming has a frozen clock, so wait for it before scheduling
  prepareAudio().then(() => {
    if (audio?.state !== 'running') return;
    try {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const now = audio.currentTime;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.15);
    } catch {
      // audio went away (closed context): the status line still shows what happened
    }
  });
}

// Every search or scan puts the book at the top of the Scanned list. Returns false when the
// list is full and the book is new: it is not added, and the warning says so.
function noteScanned(book) {
  const stored = scanned.bump(book);
  if (!stored) warnFull('scanned', scanned);
  renderLists();
  return stored;
}

// Showing a book without searching for it again (opened from a list, Back/Forward, a reload
// with a link): it is added to Scanned if missing, but an existing row stays where it is.
function noteShown(book) {
  if (!scanned.has(book.id)) noteScanned(book);
}

// A book known by its ISBN: { id, isbn, title }.
// (the id is `gr:<n>` for a book the lookup has upgraded)
const isbnBook = (isbn) => ({ id: titles.idOf(isbn), isbn, title: titles.of(isbn) });

// A series read a book: add it to Scanned (or move it to the top if it is already there).
function addScanned(isbn, again) {
  titles.clearFoundBy(titles.idOf(isbn)); // a barcode is the real ISBN of the book in hand
  clearWarning();
  const book = isbnBook(isbn);
  if (again) return noteScanned(book);
  if (noteScanned(book)) {
    setStatus(str.lists.added(book.title));
    requestMeta(isbn);
  } else setStatus(str.lists.notAdded(book.title), true);
}

const scannedTitle = (isbn) => scanned.list().find((book) => book.id === titles.idOf(isbn))?.title;

const session = createScanSession({
  // a new <video> for every start: an iPhone kept showing a later start's picture unfitted to the box when the element was reused
  start: (handlers) => startScanner(preview, { canvas: view, ...handlers }),
  scanned,
  track: (name, fields) => stats.track(name, fields),
  onOutcome(outcome) {
    switch (outcome.type) {
      case 'opened': {
        scanner.hidden = false;
        updateControls();
        // Start from a clean slate: no previous ISBN, book card or message.
        input.value = '';
        result.replaceChildren();
        setStatus('');
        const fresh = preview.cloneNode(false);
        preview.replaceWith(fresh);
        preview = fresh;
        break;
      }
      case 'closed':
        scanner.hidden = true;
        updateControls();
        break;
      case 'hint': {
        const title = outcome.kind === 'already' && scannedTitle(outcome.isbn);
        if (outcome.kind === 'not-book') setStatus(str.search.notABook);
        else if (title) setStatus(str.lists.alreadyScanned(title));
        break;
      }
      case 'hintCleared':
        setStatus('');
        break;
      case 'beep':
        confirmScan({ new: BEEP_NEW, again: BEEP_AGAIN, full: BEEP_FULL }[outcome.kind]);
        break;
      case 'found':
        input.value = outcome.isbn;
        search(outcome.isbn, { via: 'scan' });
        if (outcome.again) setStatus(str.lists.alreadyScanned(titles.of(outcome.isbn)));
        break;
      case 'added':
        addScanned(outcome.isbn, outcome.again);
        break;
      case 'bump':
        noteScanned(isbnBook(outcome.isbn));
        break;
      case 'failed':
        setStatus(str.scanner.cameraUnavailable, true);
        input.focus();
        break;
    }
  },
});

function openScanner(continuous = false) {
  if (session.active) return;
  prepareAudio(); // still inside the tap, which is what lets sound play later
  session.open(continuous);
}

// Tap = scan one book. Hold: nothing happens for MIN_HOLD_MS (a tap, or a press not yet meant as a hold),
// then the button fills with red over the rest of MAX_HOLD_MS, and when it is full the camera stays on and adds
// every book until Stop. Letting go once the fill has started only cancels (the fill drains): it is not a tap.
const MIN_HOLD_MS = 300;
const MAX_HOLD_MS = 1000;
const FILL_DRAIN_MS = 200; // how fast the fill empties when the press is cancelled
scanButton.style.setProperty('--hold', `${MAX_HOLD_MS - MIN_HOLD_MS}ms`);
scanButton.style.setProperty('--drain', `${FILL_DRAIN_MS}ms`);
let startTimer = null;
let doneTimer = null;
let swallowClick = false; // set once the fill starts: the click that ends the press is not a tap or a Stop

function cancelHold() {
  clearTimeout(startTimer);
  clearTimeout(doneTimer);
  scanButton.classList.remove('holding');
}

scanButton.addEventListener('pointerdown', (event) => {
  if (session.active || (event.pointerType === 'mouse' && event.button !== 0)) return;
  prepareAudio(); // the hold ends outside a tap, so unlock sound now
  startTimer = setTimeout(() => {
    swallowClick = true;
    scanButton.classList.add('holding');
    doneTimer = setTimeout(() => {
      cancelHold();
      navigator.vibrate?.(30);
      openScanner(true);
    }, MAX_HOLD_MS - MIN_HOLD_MS);
  }, MIN_HOLD_MS);
});
for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
  scanButton.addEventListener(type, () => {
    cancelHold();
    if (swallowClick) setTimeout(() => { swallowClick = false; }, 50); // after the click that follows the release
  });
}
scanButton.addEventListener('contextmenu', (event) => event.preventDefault());

scanButton.addEventListener('click', () => {
  if (swallowClick) return;
  if (!session.active) return openScanner();
  session.stop();
  setStatus('');
});
window.addEventListener('pagehide', closeScanner);

// The field takes an ISBN or a title: only something that looks like an ISBN is checked as one (see looksLikeIsbn).
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (LOOKUP_URL && text && !looksLikeIsbn(text)) return searchTitle(text);
  search(normalizeIsbn(input.value));
});

// Title search: the candidates from Goodreads are listed on the page; the one picked is shown at once (see pickCandidate)
// and its links search for the title. `pickToken` drops the answer of a search that a newer search or a pick has replaced.
let pickToken = 0;

async function searchTitle(text) {
  const token = ++pickToken;
  closeScanner();
  result.replaceChildren();
  clearWarning();
  setStatus(str.search.searchingTitle);
  const found = await searchBooks(text);
  if (token !== pickToken) return;
  stats.track('title_search', { n: found ? found.length : -1 });
  if (!found) return setStatus(str.search.searchFailed, true);
  if (!found.length) return setStatus(str.search.noTitleResults, true);
  setStatus(str.search.pickBook);
  result.replaceChildren(candidateList(found));
  input.blur();
}

// The candidate list goes away (with its "choose a book" status) when the text changes, on a click outside it
// (the field itself excepted), on Escape and when a candidate is picked.
function hideCandidates() {
  if (!result.querySelector('.candidates')) return;
  result.replaceChildren();
  setStatus('');
}
document.addEventListener('click', (event) => {
  if (!event.target.closest?.('.candidates') && event.target !== input) hideCandidates();
});
document.addEventListener('keydown', (event) => event.key === 'Escape' && hideCandidates());

// The book picked from the candidates is shown at once, built from what the search told (saved as partial details),
// and listed in Scanned; it has no ISBN until the edition request, which runs in the background, answers.
function pickCandidate(candidate) {
  hideCandidates();
  pickToken++;
  closeScanner();
  clearWarning();
  setStatus('');
  const id = candidateId(candidate);
  stats.track('title_pick', { isbn: titles.details(id)?.isbn ? 1 : 0 }); // at click time: was the ISBN already known
  titles.setFoundBy(id, { title: candidate.title, author: candidate.author, url: candidate.bookUrl });
  if (!titles.detailsCurrent(id)) titles.setDetails(id, detailsFromCandidate(candidate), { partial: true }); // never replaces full details
  const book = { id, title: titles.of(id) };
  noteScanned(book);
  if (grFromHash(location.hash) !== candidate.id) history.pushState(null, '', hashForGr(candidate.id));
  requestEdition(id);
  renderBook(book);
  input.blur();
}

// A listed book with no ISBN is shown again from what is stored; its edition is asked again until it has answered.
// `push: false`: the card comes from the address itself (load, Back/Forward), so no history entry is added.
function showPicked(entry, { push = true } = {}) {
  pickToken++;
  closeScanner();
  clearWarning();
  setStatus('');
  input.value = '';
  if (push && grFromHash(location.hash) !== entry.id.slice(3)) history.pushState(null, '', hashForGr(entry.id.slice(3)));
  const book = { id: entry.id, title: titles.of(entry.id) };
  noteShown(book);
  requestEdition(book.id);
  renderBook(book);
  input.blur();
}

function candidateList(found) {
  const list = el('ul', null, 'candidates');
  for (const book of found) {
    const pick = el('button', null, 'candidate');
    pick.type = 'button';
    if (book.image) pick.append(coverImage(book.image));
    const text = el('span', null, 'candidate-text');
    text.append(el('span', book.title, 'candidate-title'), el('span', book.author, 'candidate-author'));
    pick.append(text, el('span', str.search.candidateRating(book.rating), 'candidate-rating'));
    pick.addEventListener('click', () => pickCandidate(book));
    const item = el('li');
    item.append(pick);
    list.append(item);
  }
  return list;
}

// `push: false` is used when the search comes from the URL itself (load, Back/Forward);
// those don't add a history entry. A valid search drops the focus from the field, so the phone keyboard closes.
// `move: false`: the book is only shown again, so it keeps its place in the Scanned list.
function search(isbn, { push = true, move = true, via = 'typed' } = {}) {
  pickToken++;
  closeScanner();
  result.replaceChildren();
  stats.track('search', { via, ok: isValidIsbn(isbn) ? 1 : 0 });
  if (!isValidIsbn(isbn)) return setStatus(str.search.invalidIsbn, true);
  const id = titles.idOf(isbn);
  // a search by ISBN clears the title an `isbn:` book was once found by; a `gr:` book keeps its Goodreads page address (better than an ISBN link)
  if (move && id.startsWith('isbn:')) titles.clearFoundBy(id);
  if (push && isbnFromHash(location.hash) !== isbn) history.pushState(null, '', hashForIsbn(isbn));

  const book = isbnBook(isbn);
  setStatus('');
  clearWarning();
  (move ? noteScanned : noteShown)(book);
  requestMeta(isbn); // before the card, so that the card knows to show the spinner
  renderBook(book);
  input.blur();
}

// `#gr=<id>`: the card of a book with no ISBN is built from what is stored; an id never seen is asked of the
// service, and when that gives no book the link is ignored without a message.
async function showGrLink(num) {
  const id = `gr:${num}`;
  if (scanned.has(id) || marked.has(id) || titles.foundBy(id) || titles.details(id)) return showPicked({ id }, { push: false });
  if (!LOOKUP_URL) return;
  const token = ++pickToken;
  const edition = await editionOfBook(num);
  if (!edition?.found) return;
  titles.rekey(isbnId(edition.isbn), id); // the same book already stored by its ISBN is merged into this one
  titles.setFoundBy(id, { title: edition.found.title, author: edition.found.author?.name, url: `https://www.goodreads.com/book/show/${num}` });
  titles.setDetails(id, edition.found, { isbn: edition.isbn });
  if (token === pickToken) showPicked({ id }, { push: false }); // the answer is kept either way; the card only if nothing newer replaced it
}

window.addEventListener('popstate', () => {
  const isbn = isbnFromHash(location.hash);
  const gr = grFromHash(location.hash);
  if (isbn) {
    input.value = isbn;
    search(isbn, { push: false, move: false, via: 'history' });
  } else if (gr) {
    showGrLink(gr);
  } else {
    pickToken++;
    closeScanner();
    input.value = '';
    result.replaceChildren();
    setStatus('');
  }
});

let theme = loadTheme(browserStorage());

function showTheme() {
  applyTheme(document.documentElement, theme);
  themeButton.textContent = str.theme.labels[theme];
  themeButton.setAttribute('aria-label', str.theme.aria(theme));
}

themeButton.addEventListener('click', () => {
  theme = nextTheme(theme);
  saveTheme(browserStorage(), theme);
  showTheme();
});
showTheme();

stats.track('session', {
  ...describeClient(navigator.userAgent, navigator.maxTouchPoints),
  standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 1 : 0,
  theme,
  screen: innerWidth < 600 ? 'phone' : innerWidth < 1024 ? 'tablet' : 'desktop',
  native_scan: 'BarcodeDetector' in window ? 1 : 0,
  scanned: bucket(scanned.list().length),
  marked: bucket(marked.list().length),
});

renderLists();
updateControls();
const linkedIsbn = isbnFromHash(location.hash);
if (linkedIsbn) {
  input.value = linkedIsbn;
  search(linkedIsbn, { push: false, move: false, via: 'link' });
} else if (grFromHash(location.hash)) showGrLink(grFromHash(location.hash));
