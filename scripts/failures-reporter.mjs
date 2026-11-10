// node:test reporter: prints only failures, then a one-line summary whose "failed" matches what makes node exit nonzero.
// Failing todo tests are counted as todo, children cancelled by a failed hook are counted, not printed.
const head = (s) => s.split('\n').filter(Boolean).slice(0, 12).join('\n');

export default async function* (source) {
  const t0 = performance.now(); // wall clock: tests run in parallel, so summing their durations would overstate it
  const n = { passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
  const stderr = {};
  for await (const { type, data } of source) {
    if (type === 'test:stderr') stderr[data.file] = (stderr[data.file] ?? '') + data.message;
    if (type === 'test:pass' && data.details?.type !== 'suite') n[data.skip ? 'skipped' : data.todo ? 'todo' : 'passed']++;
    if (type !== 'test:fail') continue;
    const err = data.details?.error;
    const kind = err?.failureType;
    if (data.todo) n.todo++;
    else if (kind === 'cancelledByParent') n.cancelled++;
    else if (kind !== 'subtestsFailed') {
      n.failed++;
      const cause = err?.cause ?? err;
      // a test file that failed to load is reported as a test named after the file: its cause is on stderr
      const text = data.file?.endsWith(data.name) && stderr[data.name] || String(cause?.stack ?? cause);
      yield `FAIL ${data.file ?? ''}:${data.line} ${data.name}\n${head(text)}\n\n`;
    }
  }
  const parts = [`${n.passed} passed`, `${n.failed} failed`, ...['cancelled', 'skipped', 'todo'].filter((k) => n[k]).map((k) => `${n[k]} ${k}`)];
  yield `${parts.join(', ')}, ${((performance.now() - t0) / 1000).toFixed(1)}s\n`;
}
