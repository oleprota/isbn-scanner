// Zips extension/ (without README) into dist/isbn-reader-extension-<version>.zip. Needs the system `zip`.
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(`${root}extension/manifest.json`, 'utf8'));
mkdirSync(`${root}dist`, { recursive: true });
const out = `${root}dist/isbn-reader-extension-${version}.zip`;
execFileSync('zip', ['-r', '-X', out, '.', '-x', 'README.md', '-x', '*.DS_Store'], { cwd: `${root}extension`, stdio: 'inherit' });
console.log(out);
