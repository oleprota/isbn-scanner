import test from 'node:test';
import assert from 'node:assert/strict';
import isbns from './fixtures/isbns.json' with { type: 'json' };
import { pickIsbn } from '../extension/pickIsbn.js';

const [A, B, C] = isbns.found.map((e) => e.isbn);
const none = { jsonLd: [], meta: [], title: [], text: '' };
const pick = (page) => pickIsbn({ ...none, ...page });

test('reads the isbn of a JSON-LD book, also nested and in a list', () => {
  assert.equal(pick({ jsonLd: [JSON.stringify({ '@type': 'Book', isbn: A })] }), A);
  assert.equal(pick({ jsonLd: [JSON.stringify({ '@graph': [{ '@type': 'WebSite' }, { '@type': 'Book', isbn: [B] }] })] }), B);
});

test('skips broken JSON-LD and wrong checksums', () => {
  assert.equal(pick({ jsonLd: ['{oops', JSON.stringify({ isbn: isbns.invalid[1].isbn }), JSON.stringify({ isbn: C })] }), C);
});

test('structured data beats the title, the title beats labelled text', () => {
  assert.equal(pick({ meta: [A], title: [`Book ${B}`], text: `ISBN: ${C}` }), A);
  assert.equal(pick({ title: [`Book ${B}`], text: `ISBN: ${C}` }), B);
  assert.equal(pick({ text: `Related ISBN: ${C}` }), C);
});

test('reads hyphenated and spaced ISBNs', () => {
  const hyphenated = `${A.slice(0, 3)}-${A.slice(3, 4)}-${A.slice(4, 7)}-${A.slice(7, 12)}-${A.slice(12)}`;
  assert.equal(pick({ title: [`Title (${hyphenated}) shop`] }), A);
  assert.equal(pick({ text: `ISBN ${A.slice(0, 3)} ${A.slice(3)}` }), A);
});

test('unlabelled digits in the text and image file names are ignored', () => {
  assert.equal(pick({ text: `Артикул ${A} ціна 200` }), null);
  assert.equal(pick({ meta: [`https://shop.example/img/${A}.jpg`] }), null);
  assert.equal(pick(none), null);
});

test('the first valid candidate of the first source wins', () => {
  assert.equal(pick({ title: [`x ${isbns.invalid[1].isbn} y ${B}`] }), B);
  assert.equal(pick({ text: `ISBN: ${A} … ISBN: ${B}` }), A);
});
