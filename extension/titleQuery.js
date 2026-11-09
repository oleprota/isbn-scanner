// What to search Goodreads for when a page has no ISBN: the title and author of the page's JSON-LD `Book` (page = what the
// content script read, see pickIsbn.js). null when the page does not declare a book: `Product` alone says nothing, any shop item has it.

function* nodes(node) {
  if (Array.isArray(node)) for (const item of node) yield* nodes(item);
  else if (node && typeof node === 'object') {
    yield node;
    yield* nodes(node['@graph']);
  }
}

const nameOf = (x) => (typeof x === 'string' ? x : Array.isArray(x) ? nameOf(x[0]) : x?.name);

export function titleQuery({ jsonLd }) {
  for (const block of jsonLd) {
    let data;
    try { data = JSON.parse(block); } catch { continue; }
    for (const node of nodes(data)) {
      if ([node['@type']].flat().includes('Book') && typeof node.name === 'string' && node.name.trim()) {
        return [node.name, nameOf(node.author)].filter((s) => typeof s === 'string' && s.trim()).join(' ').replace(/\s+/g, ' ').trim().slice(0, 100);
      }
    }
  }
  return null;
}
