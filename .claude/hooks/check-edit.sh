#!/bin/bash
# Stop hook (project scope): when src/*.js, test/*.js or index.html changed since HEAD, run node --check and the tests.
# Exit 2 blocks the stop and sends stderr back to Claude. Quiet when the same diff already passed,
# and never loops (stop_hook_active).
input=$(cat)
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = true ] && exit 0
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" || exit 0
[ -f package.json ] && git rev-parse --git-dir >/dev/null 2>&1 || exit 0

files=$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u | grep -E '^(src/.*\.js|test/.*\.js|index\.html)$')
[ -n "$files" ] || exit 0

stamp="$(git rev-parse --git-dir)/check-edit-stamp"
sum=$( { git diff HEAD -- $files; git ls-files --others --exclude-standard -- $files | xargs -I{} cat "{}" 2>/dev/null; } | shasum | cut -d' ' -f1)
[ "$(cat "$stamp" 2>/dev/null)" = "$sum" ] && exit 0

for f in $(printf '%s\n' "$files" | grep '\.js$'); do
  [ -f "$f" ] || continue
  if ! out=$(node --check "$f" 2>&1); then
    printf 'node --check failed for %s:\n%s\n' "$f" "$out" >&2
    exit 2
  fi
done

# Custom reporter: only failed tests reach Claude's context.
if ! out=$(node --test --test-reporter="$(cd "$(dirname "$0")" && pwd)/failures-reporter.mjs" 2>&1); then
  printf 'Tests failed:\n%s\n' "$out" >&2
  exit 2
fi

printf '%s' "$sum" > "$stamp"
jq -n --arg m "✓ syntax OK, $(printf '%s' "$out" | tail -1)" '{systemMessage: $m}'
