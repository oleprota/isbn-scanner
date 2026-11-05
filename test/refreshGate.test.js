import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshGate } from '../src/refreshGate.js';

test('one refresh locks every refresh for 60 s, then it opens again', () => {
  let t = 1000;
  const gate = createRefreshGate({ now: () => t });
  assert.equal(gate.ready(), true);
  gate.start();
  assert.equal(gate.ready(), false);
  t += 59999;
  assert.equal(gate.ready(), false);
  t += 1;
  assert.equal(gate.ready(), true);
});
