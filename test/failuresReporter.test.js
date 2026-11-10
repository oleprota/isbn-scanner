import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPORTER = fileURLToPath(new URL('../scripts/failures-reporter.mjs', import.meta.url));
const run = (name) => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // else the nested run is treated as part of this one
  const fixture = fileURLToPath(new URL(`../scripts/fixtures/${name}.fixture.js`, import.meta.url));
  return spawnSync(process.execPath, ['--test', `--test-reporter=${REPORTER}`, fixture], { encoding: 'utf8', env });
};

test('a failing test gives a FAIL line, exit 1 and the matching summary', () => {
  const r = run('fail');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^FAIL .*deliberate failure$/m);
  assert.match(r.stdout, /^1 passed, 1 failed, [\d.]+s$/m);
});

test('a failing todo gives exit 0 and no FAIL line', () => {
  const r = run('todo');
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /FAIL/);
  assert.match(r.stdout, /^1 passed, 0 failed, 1 todo, [\d.]+s$/m);
});
