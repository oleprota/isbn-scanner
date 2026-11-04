// The text Copy puts on the clipboard for a list: per book "Author, Title ★ 4.66 (1 234) ⚠", the Ereadian link,
// the Goodreads link, and an empty line between books. Pure: the caller says what is known about each book.
import { isbnLinks } from './links.js';
import { isThin } from './lookup.js';
import { formatRating, lists } from './strings.js';

// A link to copy: non-ASCII letters read as letters (browsers and chats accept them), a space is a +, other reserved
// characters stay encoded (a literal + is %2B, so the two never mix).
const readable = (url) => url.replaceAll('%20', '+').replace(/(?:%[C-F][0-9A-F](?:%[89AB][0-9A-F])+)+/gi, decodeURIComponent);

// `books`: [{ isbn, title }] in the order to write them.
// `lookup(isbn)`: { author, rating: {value, count}, found: {title, author} } of a book, whatever is known.
export function copyText(books, lookup = () => ({})) {
  return books
    .map(({ isbn, title }) => {
      const { author, rating, found } = lookup(isbn) ?? {};
      const name = title.replace(/(?<!\.)\.$/, ''); // a single closing period goes, an ellipsis stays
      const { value, count } = rating ? formatRating(rating) : {};
      const stars = rating ? ` ${lists.copyStar} ${value} (${count})${isThin(rating) ? ` ${lists.copyThin}` : ''}` : '';
      const line = `${author ? `${author}, ` : ''}${name}${stars}`;
      return [line, ...isbnLinks(isbn, found).map((link) => readable(link.url))].join('\n');
    })
    .join('\n\n');
}
