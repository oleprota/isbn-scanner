import test from 'node:test';
import assert from 'node:assert/strict';
import { titleQuery } from '../extension/titleQuery.js';

const ld = (o) => JSON.stringify(o);

test('title and author from a Book in JSON-LD', () => {
  assert.equal(titleQuery({ jsonLd: [ld({ '@type': 'Organization', name: 'Shop' }), ld({ '@type': ['Product', 'Book'], name: 'Амадока', author: [{ name: 'Софія Андрухович' }] })] }), 'Амадока Софія Андрухович');
});
test('author as a string, a @graph, no author', () => {
  assert.equal(titleQuery({ jsonLd: [ld({ '@graph': [{ '@type': 'Book', name: 'Dune', author: 'Frank Herbert' }] })] }), 'Dune Frank Herbert');
  assert.equal(titleQuery({ jsonLd: [ld({ '@type': 'Book', name: 'Dune' })] }), 'Dune');
});
test('not a book page: Product alone, other types, bad JSON, nothing', () => {
  assert.equal(titleQuery({ jsonLd: [ld({ '@type': 'Product', name: 'Mug' })] }), null);
  assert.equal(titleQuery({ jsonLd: ['{oops'] }), null);
  assert.equal(titleQuery({ jsonLd: [] }), null);
});
