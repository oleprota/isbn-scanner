import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanThin, loadThin, saveThin } from '../src/settings.js';
import { THIN_RATING_COUNT, isThin, setThinCount } from '../src/lookup.js';

const fake = (init = {}) => ({ data: { ...init }, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; }, removeItem(k) { delete this.data[k]; } });

test('cleanThin keeps whole numbers of 1 or more', () => {
  assert.equal(cleanThin('250'), 250);
  assert.equal(cleanThin('99.6'), 100);
  assert.equal(cleanThin('123456789'), 123456789);
  for (const bad of ['', '0', '-5', 'abc', null, undefined, Infinity]) assert.equal(cleanThin(bad), null);
});

test('the threshold is remembered; the default is stored as nothing; a corrupt value or blocked storage gives the default', () => {
  const storage = fake();
  saveThin(storage, 500);
  assert.equal(loadThin(storage), 500);
  saveThin(storage, THIN_RATING_COUNT);
  assert.deepEqual(storage.data, {});
  assert.equal(loadThin(fake({ 'isbn-reader.thin': 'junk' })), THIN_RATING_COUNT);
  assert.equal(loadThin(null), THIN_RATING_COUNT);
  assert.doesNotThrow(() => saveThin(null, 5));
});

test('isThin follows the setting', () => {
  setThinCount(500);
  assert.equal(isThin({ value: 4, count: 499 }), true);
  assert.equal(isThin({ value: 4, count: 500 }), false);
  setThinCount(THIN_RATING_COUNT);
});
