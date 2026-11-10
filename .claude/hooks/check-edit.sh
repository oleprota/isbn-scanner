#!/bin/bash
# Stop hook (project scope): when anything other than *.md changed since HEAD (tracked or untracked), run npm run check.
# Exit 2 blocks the stop and sends stderr back to Claude. Quiet when the same diff already passed,
# and never loops (stop_hook_active).
input=$(cat)
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = true ] && exit 0
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" || exit 0
[ -f package.json ] && git rev-parse --git-dir >/dev/null 2>&1 || exit 0

files=$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u | grep -v '\.md$')
[ -n "$files" ] || exit 0

stamp="$(git rev-parse --git-dir)/check-edit-stamp"
sum=$( { git diff HEAD -- $files; git ls-files --others --exclude-standard -- $files | xargs -I{} cat "{}" 2>/dev/null; } | shasum | cut -d' ' -f1)
[ "$(cat "$stamp" 2>/dev/null)" = "$sum" ] && exit 0

if ! out=$(npm run check --silent 2>&1); then
  printf 'npm run check failed:\n%s\n' "$out" >&2
  exit 2
fi

printf '%s' "$sum" > "$stamp"
jq -n --arg m "✓ check OK, $(printf '%s' "$out" | tail -1)" '{systemMessage: $m}'
