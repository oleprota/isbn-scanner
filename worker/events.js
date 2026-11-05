// What the app may report to POST /event. The endpoint is public, so anything not listed here is dropped:
// the event names, and per name the fields that are kept (a short word or a number, never free text).
export const EVENTS = {
  session: ['os', 'browser', 'standalone', 'theme', 'screen', 'native_scan', 'scanned', 'marked'],
  scan_start: ['mode'],
  scan_ok: ['mode', 'ms'],
  scan_stop: ['ms', 'found'],
  scan_fail: ['reason'],
  search: ['via', 'ok'],
  lookup: ['result', 'ms', 'reason'],
  title_search: ['n'],
  title_pick: ['isbn'], // at click time: 1 when the ISBN was already known
  isbn_found: ['found', 'result', 'reason', 'ms', 'retry', 'details'], // later: the edition request's answer (retry: 1 = the user's button, 0 = automatic)
  star: ['on'],
  refresh: ['by_title'], // the card's refresh button (1 = a book found by title)
  copy: ['list', 'ok'],
  sort: ['list', 'mode'],
  title_edit: ['cleared'],
};
export const MAX_BYTES = 4096;
const MAX_EVENTS = 20;
const MAX_AGE_MS = 3600_000; // an event is sent within seconds; a claim of hours ago is not believed

const fieldValue = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  return typeof value === 'string' && /^[\w .:/+-]{1,24}$/.test(value) ? value : undefined;
};

// The body of a POST: { id, dev, events: [{ name, ago, ...fields }] } -> { id, dev, rows: [{ ts, name, data }] }, or null when it is not one.
export function cleanBatch(text, now = Date.now()) {
  if (typeof text !== 'string' || text.length > MAX_BYTES) return null;
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!/^[0-9a-f]{8}$/.test(body?.id) || !Array.isArray(body.events)) return null;
  const rows = [];
  for (const event of body.events.slice(0, MAX_EVENTS)) {
    if (!Object.hasOwn(EVENTS, event?.name)) continue;
    const data = {};
    for (const field of EVENTS[event.name]) {
      const value = fieldValue(event[field]);
      if (value !== undefined) data[field] = value;
    }
    const ago = Math.min(Math.max(Number(event.ago) || 0, 0), MAX_AGE_MS);
    rows.push({ ts: now - ago, name: event.name, data: JSON.stringify(data) });
  }
  return { id: body.id, dev: body.dev === 1 ? 1 : 0, rows };
}

export const saveBatch = async (db, { id, dev, rows }) => {
  const insert = db.prepare('INSERT INTO events (ts, id, dev, name, data) VALUES (?, ?, ?, ?, ?)');
  return db.batch(rows.map((row) => insert.bind(row.ts, id, dev, row.name, row.data)));
};

// Rows older than this are deleted by the daily job (`scheduled` in index.js, `[triggers]` in wrangler.toml).
export const KEEP_DAYS = 90;
export const pruneEvents = (db, now = Date.now()) => db.prepare('DELETE FROM events WHERE ts < ?').bind(now - KEEP_DAYS * 86400_000).run();
