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

// Snippets as seen on the shops on 2026-11-01
test('real pages: Bohdan and MBooks (ISBN in the title), Nebo (labelled text), ReadEat (JSON-LD)', () => {
  assert.equal(pick({ title: ['Купити книгу Війна старого : роман онлайн, Скалці Д. , 978-966-10-8980-7 | Видавництво «Богдан»'] }), '9789661089807');
  assert.equal(pick({ title: ['Книга Рій - Франк Шетцінг, (2026) купити на MEGOGO BOOKS | ISBN 978-966-10-9300-2'] }), '9789661093002');
  assert.equal(pick({ text: 'Видавництво\nISBN\tISBN 978-617-8446-15-4\nСторінок' }), '9786178446154');
  assert.equal(pick({ jsonLd: ['{"@type":"Book","isbn":"9786175480892"}'] }), '9786175480892');
});

test('real page: Apriori keeps the main book\'s ISBN spec in page data, ahead of related books', () => {
  const nuxt = '[{"isbn":149},"9781524760373",{"name":167,"value":168},"ISBN"," 978-617-8634-66-7 ",{"name":170},"Розмір","150 x 220 мм","isbn","9780593723821","isbnlocal","978-617-8634-37-7"]';
  assert.equal(pick({ text: `Довкола ливарень\n680 грн\n${nuxt}` }), '9786178634667');
});

test('real page: Vivat has the label and the number in neighbouring elements, glued together in the page text', () => {
  assert.equal(pick({ text: `Артикул1768975ISBN${A}Тип товаруПаперова книжка` }), A);
  assert.equal(pick({ text: `ISBN${A}2024` }), A);
});

test('an ISBN found in several sources beats a related book that comes first', () => {
  // the related book B is labelled before the main book A, which is also in the title and the data
  assert.equal(pick({ title: [`Book ${A}`], text: `ISBN: ${B} ... ISBN: ${A}` }), A);
  assert.equal(pick({ jsonLd: [JSON.stringify({ isbn: B })], title: [`Book ${A}`], text: `ISBN ${A}` }), A);
});

test('a repeat within one source is not a second vote', () => {
  assert.equal(pick({ text: `ISBN: ${B} ISBN: ${A} ISBN: ${A}` }), B);
});
