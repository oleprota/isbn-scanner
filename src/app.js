import { isValidIsbn, looksLikeIsbn, normalizeIsbn } from './isbn.js';
import { isbnLinks } from './links.js';
import { startScanner } from './scanner.js';
import { createScanSession } from './scanSession.js';
import { hashForIsbn, isbnFromHash } from './hash.js';
import { createListStore } from './storage.js';
import { bucket, createStats, describeClient } from './stats.js';
import { createBookList } from './bookList.js';
import { NAME_MAX, createBookTitles } from './bookTitles.js';
import { cleanText } from './text.js';
import { loadSort, saveSort } from './sort.js';
import { coverImage, factsBlock, ratingBlock } from './details.js';
import { LOOKUP_URL, editionOfBook, lookupBook, searchBooks, setNoCache } from './lookup.js';
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

const openBook = (isbn) => {
  input.value = isbn;
  search(isbn, { move: false, via: 'list' });
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
  isWaiting: (isbn) => pending.has(isbn),
  ratings: titles.ratings,
  thinRatings: titles.thinRatings,
  foundBy: titles.allFoundBy,
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
  rowButton: (book) => markToggle.create(book, book.isbn),
});
const markedView = listView('marked', marked, {
  confirmClear: str.lists.clearMarked,
  rowButton: (book) => {
    const remove = iconButton('✕', str.card.unmark);
    remove.addEventListener('click', () => {
      marked.remove(book.isbn);
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
  setStatus('');
  clearWarning();
});


// The title on a card is also where the book is named: tap it to type a name (Enter or leaving
// the field saves, Escape cancels); an empty name goes back to `ISBN <number>`. The name is saved
// per ISBN and also updates the Scanned and Marked entries for that book.
// Returns the heading, `update(title)` for a title that arrives later from the lookup, and
// `setWaiting(on)` for the spinner beside the title that shows the lookup is still running.
function titleHeading(book, isbn, waiting) {
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
    const title = titles.rename(isbn, value);
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
    field.placeholder = titles.fallback(isbn); // what an empty name turns back into
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

// The card on screen, so that a lookup answer can reach it: { card, isbn, book, update, setDetails, setWaiting }.
let shown = null;

function renderBook(book, isbn) {
  const card = el('article', null, 'book');
  const head = el('div', null, 'book-head');
  const body = el('div', null, 'book-main');
  const { heading, update, setWaiting } = titleHeading(book, isbn, pending.has(isbn));
  body.append(heading);
  const facts = el('div', null, 'facts-slot');
  // what the lookup found: the cover beside the title, the rating under it, series and author under the head
  const setDetails = (found) => {
    head.querySelector('.cover')?.remove();
    if (found?.image) head.prepend(coverImage(found.image));
    body.querySelector('.rating')?.remove();
    if (found?.rating) heading.after(ratingBlock(found.rating));
    facts.replaceChildren(...[found && factsBlock(found)].filter(Boolean));
  };
  // the star sits at the right edge of the card, like the buttons at the end of the list rows
  head.append(body, markToggle.create(book, isbn));
  setDetails(titles.details(isbn));
  const links = el('div', null, 'link-row');
  links.append(...isbnLinks(isbn, titles.foundBy(isbn)).map((link) => linkButton(link, { big: true })));
  card.append(head, facts, links);
  result.replaceChildren(card);
  shown = { card, isbn, book, update, setDetails, setWaiting };
}

// Asks the lookup service for the book's name and cover, in the background: the card, the beep and
// "Додано" never wait for it, and a failure is silent. One request per ISBN per page load.
const asked = new Set();
const pending = new Set(); // asked and not answered yet: its card shows a spinner beside the title

function requestMeta(isbn) {
  // an entry saved by an older version lacks the new fields: it is shown until the answer replaces it
  if (!LOOKUP_URL || titles.detailsCurrent(isbn) || asked.has(isbn)) return;
  asked.add(isbn);
  pending.add(isbn);
  renderLists(); // the rows of this book show the spinner too (several lookups can run at once while scanning)
  lookupBook(isbn, { report: (result, ms, detail) => stats.track('lookup', { result, ms, reason: detail?.reason }) }).then((found) => {
    pending.delete(isbn);
    if (found) return applyMeta(isbn, found);
    if (shownCard(isbn)) shown.setWaiting(false);
    renderLists();
  });
}

const shownCard = (isbn) => shown?.isbn === isbn && result.contains(shown.card);

// A found title only replaces the default `ISBN <number>` or the title an earlier lookup of this
// book gave (older versions kept the series bracket in it): never a typed name or another title.
function applyMeta(isbn, found) {
  const replaceable = titles.setDetails(isbn, found);
  // an answer for a card that is no longer on screen only fills the cache
  if (shownCard(isbn)) {
    shown.setWaiting(false);
    if (replaceable(shown.book.title)) shown.update(found.title);
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
function noteScanned(isbn, title) {
  const stored = scanned.bump({ isbn, title });
  if (!stored) warnFull('scanned', scanned);
  renderLists();
  return stored;
}

// Showing a book without searching for it again (opened from a list, Back/Forward, a reload
// with a link): it is added to Scanned if missing, but an existing row stays where it is.
function noteShown(isbn, title) {
  if (!scanned.has(isbn)) noteScanned(isbn, title);
}

// A series read a book: add it to Scanned (or move it to the top if it is already there).
function addScanned(isbn, again) {
  titles.clearFoundBy(isbn); // a barcode is the real ISBN of the book in hand
  clearWarning();
  if (again) return noteScanned(isbn, titles.of(isbn));
  const book = { title: titles.of(isbn) };
  if (noteScanned(isbn, book.title)) {
    setStatus(str.lists.added(book.title));
    requestMeta(isbn);
  } else setStatus(str.lists.notAdded(book.title), true);
}

const scannedTitle = (isbn) => scanned.list().find((book) => book.isbn === isbn)?.title;

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
        noteScanned(outcome.isbn, titles.of(outcome.isbn));
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

// Title search: the candidates from Goodreads are listed on the page; the one picked gives its ISBN, and the
// book is then shown like any other, except that its links search for the title. `pickToken` drops the answer
// of a search or pick that a newer search has replaced.
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
  result.replaceChildren(candidateList(found, token));
  input.blur();
}

function candidateList(found, token) {
  const list = el('ul', null, 'candidates');
  for (const book of found) {
    const pick = el('button', null, 'candidate');
    pick.type = 'button';
    if (book.image) pick.append(coverImage(book.image));
    const text = el('span', null, 'candidate-text');
    text.append(el('span', book.title, 'candidate-title'), el('span', book.author, 'candidate-author'));
    pick.append(text);
    pick.addEventListener('click', async () => {
      setStatus(str.search.gettingIsbn);
      const edition = await editionOfBook(book.id);
      if (token !== pickToken) return;
      stats.track('title_pick', { isbn: edition ? 1 : 0, details: edition?.found ? 1 : 0 });
      if (!edition) return setStatus(str.search.noIsbn(book.title), true);
      if (edition.found) titles.setDetails(edition.isbn, edition.found); // the page already told everything: no second lookup
      input.value = edition.isbn;
      search(edition.isbn, { found: book, via: 'title' });
    });
    const item = el('li');
    item.append(pick);
    list.append(item);
  }
  return list;
}

// `push: false` is used when the search comes from the URL itself (load, Back/Forward);
// those don't add a history entry. A valid search drops the focus from the field, so the phone keyboard closes.
// `move: false`: the book is only shown again, so it keeps its place in the Scanned list.
function search(isbn, { push = true, move = true, found = null, via = 'typed' } = {}) {
  pickToken++;
  closeScanner();
  result.replaceChildren();
  stats.track('search', { via, ok: isValidIsbn(isbn) ? 1 : 0 });
  if (!isValidIsbn(isbn)) return setStatus(str.search.invalidIsbn, true);
  if (move) found ? titles.setFoundBy(isbn, found) : titles.clearFoundBy(isbn); // a search by ISBN clears the title a book was once found by
  if (push && isbnFromHash(location.hash) !== isbn) history.pushState(null, '', hashForIsbn(isbn));

  const book = { title: titles.of(isbn) };
  setStatus('');
  clearWarning();
  (move ? noteScanned : noteShown)(isbn, book.title);
  requestMeta(isbn); // before the card, so that the card knows to show the spinner
  renderBook(book, isbn);
  input.blur();
}

window.addEventListener('popstate', () => {
  const isbn = isbnFromHash(location.hash);
  if (isbn) {
    input.value = isbn;
    search(isbn, { push: false, move: false, via: 'history' });
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
}
