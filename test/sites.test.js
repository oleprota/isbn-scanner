import test from 'node:test';
import assert from 'node:assert/strict';
import { sitePatterns, sitesFromOrigins } from '../extension/sites.js';

test('a page address gives the host patterns, with www. stripped, both schemes and subdomains', () => {
  const expected = ['*://example.com/*', '*://*.example.com/*'];
  assert.deepEqual(sitePatterns('https://example.com/book/1?x=2#y'), expected);
  assert.deepEqual(sitePatterns('http://www.example.com/'), expected);
  assert.deepEqual(sitePatterns('https://shop.example.com:8080/a'), ['*://shop.example.com/*', '*://*.shop.example.com/*']);
});

test('addresses that can\'t be opted in give nothing', () => {
  for (const url of ['chrome://extensions', 'file:///a.html', 'about:blank', 'not a url', '', undefined]) assert.equal(sitePatterns(url), null, String(url));
});

test('granted origins turn back into a sorted site list, ignoring anything that isn\'t a pair of our patterns', () => {
  const origins = [
    'https://isbn-lookup.oleprota.workers.dev/*', // the install-time one
    '*://*.zeta.com/*', '*://zeta.com/*',
    '*://alpha.org/*', '*://*.alpha.org/*',
    '*://*.lonely.com/*', // half a pair: not one we made
    '<all_urls>',
  ];
  assert.deepEqual(sitesFromOrigins(origins), ['alpha.org', 'zeta.com']);
  assert.deepEqual(sitesFromOrigins([]), []);
});
