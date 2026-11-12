// Run by test/failuresReporter.test.js, not discovered by node --test (no .test. in the name).
import test from 'node:test';
test('ok', () => {});
test('deliberate failure', () => { throw new Error('boom'); });
