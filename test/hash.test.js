import test from 'node:test';
import assert from 'node:assert/strict';
import { grFromHash, hashForGr, hashForIsbn, isbnFromHash } from '../src/hash.js';
import isbns from './fixtures/isbns.json' with { type: 'json' };

test('reads a valid ISBN from the hash', () => {
  assert.equal(isbnFromHash('#isbn=9780747532699'), '9780747532699');
  assert.equal(isbnFromHash('#isbn=978-0-7475-3269-9'), '9780747532699');
  assert.equal(isbnFromHash('#isbn=9780747532699&x=1'), '9780747532699');
});

test('ignores missing, invalid or malformed hashes', () => {
  for (const hash of ['', '#', '#isbn=', '#isbn=1234567890', '#other=9780747532699', '#isbn=%E0%A4%A', undefined, null]) {
    assert.equal(isbnFromHash(hash), null, String(hash));
  }
});

test('builds a hash that reads back', () => {
  assert.equal(hashForIsbn('9780747532699'), '#isbn=9780747532699');
  assert.equal(isbnFromHash(hashForIsbn('080442957X')), '080442957X');
});

test('every valid ISBN in the shared list survives a deep-link round trip; invalid ones are ignored', () => {
  for (const { isbn } of [...isbns.found, ...isbns.notFoundInOpenLibrary]) {
    assert.equal(isbnFromHash(hashForIsbn(isbn)), isbn);
  }
  for (const { isbn } of isbns.invalid) {
    assert.equal(isbnFromHash(hashForIsbn(isbn)), null, isbn);
  }
});

test('reads a Goodreads book id from #gr=, builds one that reads back', () => {
  assert.equal(grFromHash('#gr=1885'), '1885');
  assert.equal(grFromHash('#gr=1885&x=1'), '1885');
  assert.equal(grFromHash(hashForGr('4588')), '4588');
  assert.equal(isbnFromHash('#gr=1885'), null);
});

test('ignores invalid #gr= values', () => {
  for (const hash of ['', '#gr=', '#gr=abc', '#gr=12a', '#gr=-5', '#gr=1234567890123', '#gr=1.5', '#isbn=9780747532699', undefined, null]) {
    assert.equal(grFromHash(hash), null, String(hash));
  }
});
