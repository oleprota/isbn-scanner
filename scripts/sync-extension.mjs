// Copies the app modules the extension shares into extension/shared/ (no bundler). Run after changing any of them;
// test/extension.test.js fails while the copies differ.
import { copyFileSync } from 'node:fs';

export const SHARED = ['isbn.js', 'lookup.js', 'text.js', 'links.js', 'strings.js'];

if (process.argv[1]?.endsWith('sync-extension.mjs')) {
  for (const name of SHARED) copyFileSync(new URL(`../src/${name}`, import.meta.url), new URL(`../extension/shared/${name}`, import.meta.url));
}
