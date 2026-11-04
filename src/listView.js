import { el, linkButton, spinner } from './dom.js';
import { books, card, lists, search } from './strings.js';
import { SORTS, sortBooks } from './sort.js';
import { copyText } from './copyText.js';
import { isbnLinks } from './links.js';
import { thinButton } from './details.js';

// An icon-only button still needs a name for screen readers, and a tooltip for the mouse.
export function iconButton(icon, label) {
  const button = el('button', icon, 'icon');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

// The star on a card or list row: marks or unmarks a book in the Marked list. It keeps one
// name ("Mark") and exposes its state, instead of renaming itself.
export function createMarkToggle({ marked, onChange, onFull, onToggle = () => {} }) {
  function sync(button) {
    const isMarked = marked.has(button.dataset.isbn);
    button.textContent = isMarked ? '★' : '☆';
    button.title = isMarked ? card.isMarked : card.mark;
    button.setAttribute('aria-pressed', String(isMarked));
  }
  return {
    // `book.title` is read on click, so a rename after the button was made is picked up.
    create(book, isbn) {
      const button = iconButton('', card.mark);
      button.classList.add('mark-toggle');
      button.dataset.isbn = isbn;
      button.addEventListener('click', () => {
        if (marked.has(isbn)) {
          marked.remove(isbn);
          onToggle(false);
        } else if (marked.add({ isbn, title: book.title })) onToggle(true);
        else onFull(); // the list is full
        onChange();
      });
      sync(button);
      return button;
    },
    syncAll() {
      for (const button of document.querySelectorAll('.mark-toggle')) sync(button);
    },
  };
}

// "★ 4.66": a rating in a list row (no count). A screen reader gets "Рейтинг на Goodreads: 4.66".
function ratingTag(value, thin) {
  const tag = el('span', null, 'row-rating');
  const star = el('span', '★', 'row-star');
  star.setAttribute('aria-hidden', 'true');
  tag.append(star, el('span', `${card.ratingLabel}: `, 'sr-only'), value.toFixed(2));
  if (thin) tag.append(thinButton()); // the same button and popover as on the card
  return tag;
}

// One book list in the page (Scanned or Marked): the rows, and its Copy / Clear actions.
// All text goes in via textContent.
//   list: a book list (src/bookList.js); confirmClear(booksText): the confirm question, given the count as text ("3 книги");
//   rowButton(book): the button at the end of each row; onOpen(isbn): search for a book from the list;
//   onChange(): called after Clear, so every list and star in the page is redrawn;
//   ratings(): Map of isbn -> rating value (a book without one is not in it); sortMode, onSort(mode): the list's
//   order (see src/sort.js) and what to do when the user picks another one;
//   details(isbn): what the lookup found for a book ({ author, rating, ... }) or undefined (Copy writes the author and rating)
//   foundBy(): Map of isbn -> { title, author } for the books found by a title search (their site links search for them, not the ISBN);
//   isWaiting(isbn): true while the book's name is still being looked up (the row shows a spinner);
//   onCopy(ok): the Copy button was used (for the usage stats); notify(text, isError): status line; elements: { section, count, items, empty, copy, clear }
// The section (a <details>) opens by itself when the list stops being empty (on load, or at the
// first book added, also while scanning); after that the user's open/closed choice is left alone.
export function createListView({ list, confirmClear, rowButton, onOpen, onChange, isWaiting = () => false, ratings = () => new Map(), thinRatings = () => new Set(), foundBy = () => new Map(), details = () => undefined, sortMode = 'date', onSort = () => {}, onCopy = () => {}, notify, elements }) {
  const { section, count, items, empty, copy, clear } = elements;
  let locked = false;
  let wasEmpty = true;
  let stale = false; // a closed section is not redrawn (up to 1000 rows per scan); it catches up when opened

  // the books in the order the user sees them
  const ordered = (all, rated = ratings()) => sortBooks(all, sortMode, { ratingOf: (isbn) => rated.get(isbn) ?? 0, isWaiting });

  function render() {
    const all = list.list();
    count.textContent = String(all.length);
    if (all.length > 0 && wasEmpty) section.open = true;
    wasEmpty = all.length === 0;
    empty.hidden = all.length > 0;
    copy.disabled = all.length === 0;
    clear.disabled = all.length === 0 || locked;
    stale = !section.open;
    if (stale) return;
    const rated = ratings();
    const found = foundBy();
    const thin = thinRatings();
    items.replaceChildren(...ordered(all, rated).map((book) => {
      const item = el('li');
      const open = el('button', book.title, 'open');
      open.type = 'button';
      open.disabled = locked;
      open.title = book.title; // the full name, for a name the row has to cut
      open.addEventListener('click', () => onOpen(book.isbn));
      const actions = el('span', null, 'row-actions');
      actions.append(
        ...isbnLinks(book.isbn, found.get(book.isbn)).map((link) => linkButton(link)),
        rowButton(book),
      );
      item.append(open);
      // the spinner and the rating share one place; the rating (the star and the value only) comes once the lookup is over
      if (isWaiting(book.isbn)) item.append(spinner(search.lookingUp));
      else if (rated.has(book.isbn)) item.append(ratingTag(rated.get(book.isbn), thin.has(book.isbn)));
      item.append(actions);
      return item;
    }));
  }

  // The sort button at the right edge of the header, and its menu. A tap outside the menu (or Escape) closes it.
  const header = section.querySelector('summary');
  const sortButton = iconButton('⇅', lists.sortMenu);
  sortButton.classList.add('sort-button');
  const menu = el('div', null, 'sort-menu');
  menu.hidden = true;
  menu.addEventListener('click', (event) => event.preventDefault()); // the menu's padding is part of the <summary> too: a tap there must not toggle the list
  const choices = SORTS.map((mode) => {
    const choice = el('button', lists.sortNames[mode]);
    choice.type = 'button';
    choice.addEventListener('click', (event) => {
      event.preventDefault(); // the header is a <summary>: it must not toggle the list
      sortMode = mode;
      onSort(mode);
      setMenu(false);
      render();
    });
    return [mode, choice];
  });
  function setMenu(open) {
    menu.hidden = !open;
    sortButton.setAttribute('aria-expanded', String(open));
    for (const [mode, choice] of choices) choice.setAttribute('aria-pressed', String(mode === sortMode));
  }
  sortButton.addEventListener('click', (event) => {
    event.preventDefault();
    setMenu(menu.hidden);
  });
  menu.append(...choices.map(([, choice]) => choice));
  header.append(sortButton, menu);
  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !sortButton.contains(event.target)) setMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      setMenu(false);
      sortButton.focus();
    }
  });
  setMenu(false);

  section.addEventListener('toggle', () => {
    if (section.open && stale) render();
  });

  // While the camera is on, opening a book (a search) and Clear are locked.
  function setLocked(value) {
    locked = value;
    clear.disabled = value || list.list().length === 0;
    for (const open of items.querySelectorAll('.open')) open.disabled = value;
  }

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(copyText(ordered(list.list()), (isbn) => {
        const found = details(isbn);
        return { author: found?.author?.name, rating: found?.rating, found: foundBy().get(isbn) };
      }));
      notify(lists.copied(books(list.list().length)));
      onCopy(true);
    } catch {
      notify(lists.copyFailed, true);
      onCopy(false);
    }
  });

  clear.addEventListener('click', () => {
    if (confirm(confirmClear(books(list.list().length)))) {
      list.clear();
      onChange();
    }
  });

  return { render, setLocked };
}
