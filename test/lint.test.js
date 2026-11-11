import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ESLINT = fileURLToPath(new URL('../node_modules/eslint/bin/eslint.js', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const fixture = (name) => `scripts/fixtures/lint-${name}.fixture.js`;
// `as` lints the fixture's text as if the file lived there (stdin filename), so per-folder globals apply
const lint = (name, as) => {
  const args = as
    ? ['--stdin', '--stdin-filename', as]
    : ['--no-ignore', fixture(name)];
  const input = as ? readFileSync(new URL(`../${fixture(name)}`, import.meta.url)) : undefined;
  return spawnSync(process.execPath, [ESLINT, ...args], { cwd: ROOT, encoding: 'utf8', input });
};

for (const [title, name, rule] of [
  ['an undefined variable fails (no-undef)', 'undefined', 'no-undef'],
  ['an unused variable fails (no-unused-vars)', 'unused', 'no-unused-vars'],
  ['double quotes fail (@stylistic/quotes)', 'quotes', '@stylistic/quotes'],
]) {
  test(title, () => {
    const r = lint(name);
    assert.equal(r.status, 1);
    assert.match(r.stdout, new RegExp(`${rule}\\b`));
  });
}

test('a clean file passes', () => {
  const r = lint('clean');
  assert.equal(r.status, 0, r.stdout);
});

test('`document` is ok in src/ but flagged in worker/', () => {
  assert.equal(lint('globals', 'src/x.js').status, 0);
  const r = lint('globals', 'worker/x.js');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no-undef/);
});
