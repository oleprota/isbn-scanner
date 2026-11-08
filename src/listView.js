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
    const isMarked = marked.has(button.dataset.id);
    button.textContent = isMarked ? '★' : '☆';
    button.title = isMarked ? card.isMarked : card.mark;
    button.setAttribute('aria-pressed', String(isMarked));
  }
  return {
    // `book` is { id, isbn?, title }; `book.title` is read on click, so a rename after the button was made is picked up.
    create(book) {
      const button = iconButton('', card.mark);
      button.classList.add('mark-toggle');
      button.dataset.id = book.id;
      button.addEventListener('click', () => {
        if (marked.has(book.id)) {
          marked.remove(book.id);
          onToggle(false);
        } else if (marked.add({ id: book.id, isbn: book.isbn, title: book.title })) onToggle(true);
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
//   rowButton(book): the button at the end of each row; removeButton(book): the one in edit mode (default: the same); onOpen(book): show a book from the list;
//   onChange(): called after Clear, so every list and star in the page is redrawn;
//   ratings(): Map of id -> rating value (a book without one is not in it); sortMode, onSort(mode): the list's
//   order (see src/sort.js) and what to do when the user picks another one;
//   details(id): what the lookup found for a book ({ author, rating, ... }) or undefined (Copy writes the author and rating)
//   foundBy(): Map of id -> { title, author, url } for the books found by a title search (their site links search for them, not the ISBN);
//   isWaiting(id): true while the book's name is still being looked up (the row shows a spinner);
//   onCopy(ok): the Copy button was used (for the usage stats); notify(text, isError): status line; elements: { section, count, items, empty, copy, clear }
// Edit mode (a toggle in the header, not remembered): each row gets a drag handle at the left edge (or ↑ ↓ on the
// focused handle) and removeButton instead of rowButton. Moving a row saves the order and switches the list to the "custom" sort.
// The section (a <details>) opens by itself when the list stops being empty (on load, or at the
// first book added, also while scanning); after that the user's open/closed choice is left alone.
export function createListView({ list, confirmClear, rowButton, removeButton = rowButton, onOpen, onChange, isWaiting = () => false, ratings = () => new Map(), thinRatings = () => new Set(), foundBy = () => new Map(), details = () => undefined, sortMode = 'date', onSort = () => {}, onCopy = () => {}, notify, elements }) {
  const { section, count, items, empty, copy, clear } = elements;
  let locked = false;
  let wasEmpty = true;
  let editing = false;
  let stale = false; // a closed section is not redrawn (up to 1000 rows per scan); it catches up when opened

  // the books in the order the user sees them
  const ordered = (all, rated = ratings()) => sortBooks(all, sortMode, { ratingOf: (id) => rated.get(id) ?? 0, isWaiting });

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
      open.addEventListener('click', () => onOpen(book));
      const actions = el('span', null, 'row-actions');
      actions.append(
        ...isbnLinks(book.isbn, found.get(book.id)).map((link) => linkButton(link)),
        editing ? removeButton(book) : rowButton(book),
      );
      item.dataset.id = book.id;
      if (editing) item.append(dragHandle(item));
      item.append(open);
      // the spinner and the rating share one place; the rating (the star and the value only) comes once the lookup is over
      if (isWaiting(book.id)) item.append(spinner(search.lookingUp));
      else if (rated.has(book.id)) item.append(ratingTag(rated.get(book.id), thin.has(book.id)));
      item.append(actions);
      return item;
    }));
  }

  // The handle at the left of a row in edit mode.
  function dragHandle(item) {
    const handle = iconButton('⠿', lists.dragHandle);
    handle.classList.add('drag-handle');
    // Moving the row in the DOM drops pointer capture, so the drag listens on the document.
    function move(event) {
      const others = [...items.children].filter((other) => other !== item);
      const next = others.find((other) => {
        const box = other.getBoundingClientRect();
        return event.clientY < box.top + box.height / 2;
      });
      if (next) next.before(item);
      else if (others.length) others.at(-1).after(item);
    }
    function drop() {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', drop);
      document.removeEventListener('pointercancel', drop);
      item.classList.remove('dragging');
      commitOrder();
      handle.focus();
    }
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      event.preventDefault();
      item.classList.add('dragging');
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', drop);
      document.addEventListener('pointercancel', drop);
    });
    handle.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      const to = event.key === 'ArrowUp' ? item.previousElementSibling : item.nextElementSibling;
      if (!to) return;
      if (event.key === 'ArrowUp') to.before(item);
      else to.after(item);
      handle.focus();
      commitOrder();
    });
    return handle;
  }

  // Saves the rows as they are on screen as the list's own order, and switches to it. The rows stay (no redraw), so a drag is not interrupted.
  function commitOrder() {
    list.reorder([...items.children].map((item) => item.dataset.id));
    if (sortMode !== 'custom') {
      sortMode = 'custom';
      onSort('custom');
      for (const [mode, choice] of choices) choice.setAttribute('aria-pressed', String(mode === sortMode));
    }
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
  const editButton = iconButton('✎', lists.edit);
  editButton.classList.add('edit-button');
  editButton.setAttribute('aria-pressed', 'false');
  editButton.addEventListener('click', (event) => {
    event.preventDefault();
    editing = !editing;
    editButton.setAttribute('aria-pressed', String(editing));
    editButton.title = editButton.ariaLabel = editing ? lists.editDone : lists.edit;
    section.classList.toggle('editing', editing);
    render();
  });
  menu.append(...choices.map(([, choice]) => choice));
  header.append(editButton, sortButton, menu);
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
      await navigator.clipboard.writeText(copyText(ordered(list.list()), (book) => {
        const found = details(book.id);
        return { author: found?.author?.name, rating: found?.rating, found: foundBy().get(book.id) };
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
