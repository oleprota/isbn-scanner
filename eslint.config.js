import js from '@eslint/js';
import globals from 'globals';
import stylistic from '@stylistic/eslint-plugin';

export default [
  { ignores: ['vendor/', 'dist/', 'scripts/fixtures/', 'extension/shared/', '.claude/', '.playwright-mcp/', '.wrangler/'] },
  js.configs.recommended,
  {
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/indent': ['error', 2],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/no-multiple-empty-lines': ['error', { max: 1 }],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/array-bracket-spacing': ['error', 'never'],
      '@stylistic/space-infix-ops': 'error',
      '@stylistic/comma-spacing': 'error',
      '@stylistic/keyword-spacing': 'error',
      '@stylistic/space-before-blocks': 'error',
    },
  },
  { files: ['src/**'], languageOptions: { globals: globals.browser } },
  { files: ['worker/**'], languageOptions: { globals: globals.serviceworker } },
  {
    files: ['extension/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions, ...globals.serviceworker } },
  },
  { files: ['extension/autoStart.js', 'extension/content.js'], languageOptions: { sourceType: 'script' } },
  { files: ['scripts/**', 'test/**', '*.js', '*.mjs'], languageOptions: { globals: globals.node } },
];
