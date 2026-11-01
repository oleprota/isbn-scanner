export function normalizeIsbn(input) {
  return String(input).replace(/[\s-]/g, '').toUpperCase();
}

// Text typed into the field that is meant as an ISBN (digits, spaces, hyphens and X, at least 10 of them), even if
// its checksum is wrong: it gets the "invalid ISBN" message. Anything else is a title ("1984" too).
export const looksLikeIsbn = (text) => /^[\d\sX-]{10,}$/i.test(text);

export function isValidIsbn(input) {
  const isbn = normalizeIsbn(input);
  if (/^\d{13}$/.test(isbn)) {
    const sum = [...isbn].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0);
    return sum % 10 === 0;
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = [...isbn].reduce((s, c, i) => s + (c === 'X' ? 10 : Number(c)) * (10 - i), 0);
    return sum % 11 === 0;
  }
  return false;
}
