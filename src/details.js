// The parts of a book card that come from the lookup: the rating (the accent of the card), and the
// series and author with links to Goodreads. All text goes in via textContent.
import { el, spinner } from './dom.js';
import { card, formatRating } from './strings.js';
import { goodreadsSearch } from './links.js';
import { THIN_RATING_COUNT, isThin } from './lookup.js';

const SVG = 'http://www.w3.org/2000/svg';

function starIcon() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'rating-star');
  svg.setAttribute('aria-hidden', 'true'); // the number next to it says it
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5l-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9z');
  svg.append(path);
  return svg;
}

// "★ 4.66 (734 385)": the value large, the count small. A screen reader gets "Рейтинг на Goodreads: 4.66 (734 385)".
export function ratingBlock(rating) {
  const { value, count } = formatRating(rating);
  const block = el('p', null, 'rating');
  block.title = card.ratingTitle(value, count);
  const countText = el('span', `(${count})`, 'rating-count');
  block.append(starIcon(), el('span', `${card.ratingLabel}: `, 'sr-only'), el('strong', value, 'rating-value'), countText);
  if (isThin(rating)) {
    countText.classList.add('thin');
    block.append(thinButton());
  }
  return block;
}

// The warning beside a thin count: a button that opens a native popover (no layout shift: it floats in the top layer)
// with the reason. Light dismiss (a tap outside) and Escape close it.
export function thinButton() {
  const text = card.thinTitle(THIN_RATING_COUNT);
  const button = el('button', '⚠\uFE0E', 'thin-warning');
  button.type = 'button';
  button.setAttribute('aria-label', `${card.thinLabel}: ${text}`);
  const popover = el('div', text, 'thin-popover');
  popover.popover = 'auto';
  button.popoverTargetElement = popover;
  popover.addEventListener('beforetoggle', (event) => {
    if (event.newState !== 'open') return;
    const at = button.getBoundingClientRect(); // below the icon, kept inside the window
    popover.style.top = `${at.bottom + 6}px`;
    popover.style.left = `${Math.max(8, Math.min(at.left, innerWidth - 224 - 8))}px`;
  });
  const wrap = el('span', null, 'thin-wrap');
  wrap.append(button, popover);
  return wrap;
}

export function coverImage(src) {
  const img = el('img', null, 'cover');
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.src = src;
  img.addEventListener('error', () => img.remove());
  return img;
}

function outsideLink(href, text) {
  const link = el('a', text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

// "ISBN  9786171299412": the number, or, for a book picked by title that has none yet, a spinner beside the label while
// the edition request runs, or "(не знайдено)" and a small circular-arrow button that asks again (a spinner takes its
// place while it runs). `state`: { isbn, running, failed, why, retry }: `failed` is this card's own memory of an answer
// without an ISBN, `why` the reason for the button's tooltip, `retry()` asks again. Returns the dt and dd.
export function isbnRows({ isbn, running, failed, why, retry }) {
  const label = el('dt', card.isbnLabel);
  const value = el('dd', null, 'isbn-value');
  if (isbn) {
    value.textContent = isbn;
  } else if (running && !failed) {
    label.append(spinner(card.isbnLooking));
  } else {
    value.append(el('span', card.isbnNotFound));
    if (running) {
      value.append(spinner(card.isbnLooking));
    } else {
      const again = el('button', '\u21BB\uFE0E', 'isbn-retry'); // ↻
      again.type = 'button';
      again.title = card.isbnRetryTitle(why);
      again.setAttribute('aria-label', card.isbnRetry);
      again.addEventListener('click', retry);
      value.append(again);
    }
  }
  return [label, value];
}

// "Серія  Хроніки Буресвітла #1" and "Автор  Brandon Sanderson", each name a link to Goodreads
// (the series its own page, or a search for its name; the author's own page), then the ISBN row (`isbnRows`).
export function factsBlock({ series, author } = {}, isbn = []) {
  const facts = el('dl', null, 'facts');
  if (series) {
    const value = el('dd');
    value.append(outsideLink(series.url ?? goodreadsSearch(series.name), series.name));
    if (series.number) value.append(el('span', ` #${series.number}`, 'series-number'));
    facts.append(el('dt', card.seriesLabel), value);
  }
  if (author) {
    const value = el('dd');
    value.append(author.url ? outsideLink(author.url, author.name) : author.name);
    facts.append(el('dt', card.authorLabel), value);
  }
  facts.append(...isbn);
  return facts;
}
