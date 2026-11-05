import test from 'node:test';
import assert from 'node:assert/strict';
import { KEEP_DAYS, cleanBatch, pruneEvents, saveBatch } from '../worker/events.js';
import worker, { createHandler } from '../worker/index.js';

const ID = 'a1b2c3d4';
const NOW = 1_000_000_000;
const body = (events, extra = {}) => JSON.stringify({ id: ID, dev: 0, events, ...extra });

test('keeps listed events and fields, with the time they happened', () => {
  const batch = cleanBatch(body([{ name: 'lookup', result: 'found', ms: 812.4, ago: 2000 }]), NOW);
  assert.deepEqual(batch, { id: ID, dev: 0, rows: [{ ts: NOW - 2000, name: 'lookup', data: '{"result":"found","ms":812}' }] });
  assert.equal(cleanBatch(body([], { dev: 1 }), NOW).dev, 1);
});

test('drops unknown events (also names from Object.prototype), unknown fields and values that are not a short word or a number', () => {
  const batch = cleanBatch(body([
    { name: 'constructor' },
    { name: 'toString' },
    { name: 'purchase' },
    { name: 'search', via: 'typed', ok: 1, isbn: '9786171299412', title: 'x' },
    { name: 'search', via: 'a very long free text that is not a short word', ok: 'yes <b>' },
    { name: 'scan_ok', ms: Infinity, mode: { a: 1 } },
  ]), NOW);
  assert.deepEqual(batch.rows.map((r) => [r.name, r.data]), [['search', '{"via":"typed","ok":1}'], ['search', '{}'], ['scan_ok', '{}']]);
});

test('takes at most 20 events, and an event cannot claim to be older than an hour or from the future', () => {
  const many = Array.from({ length: 30 }, () => ({ name: 'star', on: 1 }));
  assert.equal(cleanBatch(body(many), NOW).rows.length, 20);
  const [old, future] = cleanBatch(body([{ name: 'star', ago: 1e12 }, { name: 'star', ago: -5000 }]), NOW).rows;
  assert.equal(old.ts, NOW - 3600_000);
  assert.equal(future.ts, NOW);
});

test('refuses what is not a batch: bad id, no events, bad JSON, too big', () => {
  assert.equal(cleanBatch('nope'), null);
  assert.equal(cleanBatch(JSON.stringify({ id: 'XYZ', events: [] })), null);
  assert.equal(cleanBatch(JSON.stringify({ id: ID })), null);
  assert.equal(cleanBatch(JSON.stringify({ id: ID, events: [{ name: 'star', on: 'x'.repeat(5000) }] })), null);
});

// the handler
const handle = createHandler({ fetchFn: async () => { throw new Error('no network'); }, cache: { match: async () => undefined, put: async () => {} } });
const ORIGIN = 'https://oleprota.github.io';
const post = (text, env, { origin = ORIGIN, method = 'POST' } = {}) => {
  const waiting = [];
  const headers = { ...(origin && { origin }), ...(method === 'POST' && { 'content-length': String(Buffer.byteLength(text)) }) }; // a browser's beacon always has its length
  const request = new Request('https://worker.test/event', { method, headers, body: method === 'POST' ? text : undefined });
  return handle(request, env, { waitUntil: (p) => waiting.push(p) }).then(async (response) => { await Promise.all(waiting); return response; });
};
const fakeDb = () => {
  const inserted = [];
  return { inserted, prepare: () => ({ bind: (...args) => args }), batch: async (statements) => { inserted.push(...statements); } };
};

test('POST /event saves the rows in one batch and answers 204', async () => {
  const DB = fakeDb();
  const response = await post(body([{ name: 'star', on: 1 }, { name: 'sort', list: 'marked', mode: 'name' }]), { DB });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  assert.deepEqual(DB.inserted.map(([, id, dev, name, data]) => [id, dev, name, data]), [[ID, 0, 'star', '{"on":1}'], [ID, 0, 'sort', '{"list":"marked","mode":"name"}']]);
});

test('without a database the events are dropped, and a failing database does not fail the request', async () => {
  assert.equal((await post(body([{ name: 'star', on: 1 }]), {})).status, 204);
  const DB = { prepare: () => ({ bind: () => 1 }), batch: async () => { throw new Error('D1 down'); } };
  assert.equal((await post(body([{ name: 'star', on: 1 }]), { DB })).status, 204);
});

test('POST /event refuses a body without a length or over the limit before reading it', async () => {
  const DB = fakeDb();
  let read = false;
  const streamed = new Request('https://worker.test/event', {
    method: 'POST',
    headers: { origin: ORIGIN },
    body: new ReadableStream({ pull(controller) { read = true; controller.enqueue(new TextEncoder().encode('x')); controller.close(); } }, { highWaterMark: 0 }), // asked for nothing until someone reads
    duplex: 'half',
  });
  assert.equal(streamed.headers.get('content-length'), null);
  assert.equal((await handle(streamed, { DB })).status, 413);
  assert.equal(read, false);
  assert.equal((await post('x'.repeat(5000), { DB })).status, 413);
  assert.equal(DB.inserted.length, 0);
});

test('POST /event refuses a bad batch, a strange origin, GET and a busy address', async () => {
  const DB = fakeDb();
  assert.equal((await post('nope', { DB })).status, 400);
  assert.equal((await post(body([{ name: 'star' }]), { DB }, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await post('', { DB }, { method: 'GET' })).status, 404);
  const busy = { EVENT_LIMITER: { limit: async () => ({ success: false }) } };
  assert.equal((await post(body([{ name: 'star' }]), { DB, ...busy })).status, 429);
  assert.equal(DB.inserted.length, 0);
});

test('a broken database binding does not fail the request (the save rejects instead of throwing)', async () => {
  const DB = { prepare() { throw new Error('no such binding'); } };
  await assert.rejects(saveBatch(DB, { id: ID, dev: 0, rows: [] }), /no such binding/);
  assert.equal((await post(body([{ name: 'star', on: 1 }]), { DB })).status, 204);
});

test('the daily job deletes events older than 90 days, and does nothing without a database', async () => {
  const run = [];
  const DB = { prepare: (sql) => ({ bind: (...args) => ({ run: async () => { run.push([sql, ...args]); } }) }) };
  const now = 1_700_000_000_000;
  await pruneEvents(DB, now);
  assert.deepEqual(run, [['DELETE FROM events WHERE ts < ?', now - KEEP_DAYS * 86400_000]]);
  assert.equal(KEEP_DAYS, 90);

  const waiting = [];
  worker.scheduled({}, { DB }, { waitUntil: (p) => waiting.push(p) });
  worker.scheduled({}, {}, { waitUntil: (p) => waiting.push(p) });
  await Promise.all(waiting);
  assert.equal(run.length, 2); // one run from the job with a database, none without
  assert.equal(waiting.length, 1);
});

test('title_pick carries only whether the ISBN was known; isbn_found carries the edition answer and no free text', () => {
  const batch = cleanBatch(body([
    { name: 'title_pick', isbn: 0, details: 1, title: 'x' },
    { name: 'isbn_found', found: 0, result: 'missing', reason: 'page-404', ms: 812.2, retry: 1, details: 0, isbn: '9786171299412' },
  ]), NOW);
  assert.deepEqual(batch.rows.map((r) => [r.name, r.data]), [
    ['title_pick', '{"isbn":0}'],
    ['isbn_found', '{"found":0,"result":"missing","reason":"page-404","ms":812,"retry":1,"details":0}'],
  ]);
});
