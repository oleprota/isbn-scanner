---
name: verify-app
description: Full browser verification of the ISBN Reader: runs every verify-* skill in turn. Use before merging or when asked to verify the whole app; for one area use verify-strings, verify-card, verify-lists, verify-scan, verify-lookup or verify-stats.
---

# Verify the whole ISBN Reader

Run these skills one after another, each with the Skill tool, in one browser session. Shared setup, closing check and report format are in `common.md` (this folder); `fake-camera.js` lives here too.

1. `verify-strings`
2. `verify-card`
3. `verify-lists`
4. `verify-scan`
5. `verify-lookup`
6. `verify-stats`

End with one combined report in the format of `common.md` (default: the single count line over all skills, then one line per partial/failed check prefixed with its skill; verbose table only if asked).
