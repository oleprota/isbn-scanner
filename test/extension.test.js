import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SHARED } from '../scripts/sync-extension.mjs';
import { ALLOWED_ORIGINS } from '../worker/index.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the extension\'s copies of shared modules match src/ (run node scripts/sync-extension.mjs)', () => {
  for (const name of SHARED) assert.equal(read(`../extension/shared/${name}`), read(`../src/${name}`), name);
});

test('the manifest key gives the extension ID the Worker allows', () => {
  const der = Buffer.from(JSON.parse(read('../extension/manifest.json')).key, 'base64');
  const id = createHash('sha256').update(der).digest('hex').slice(0, 32).replace(/./g, (c) => 'abcdefghijklmnop'[parseInt(c, 16)]);
  assert.ok(ALLOWED_ORIGINS.includes(`chrome-extension://${id}`));
});

test('auto-mode adds no install-time site access: sites are asked for one by one', () => {
  const manifest = JSON.parse(read('../extension/manifest.json'));
  assert.deepEqual(manifest.host_permissions, ['https://isbn-lookup.oleprota.workers.dev/*']);
  assert.deepEqual(manifest.optional_host_permissions, ['*://*/*']);
  assert.ok(manifest.permissions.includes('storage') && manifest.permissions.includes('scripting'));
  assert.ok(manifest.options_ui?.page);
});
