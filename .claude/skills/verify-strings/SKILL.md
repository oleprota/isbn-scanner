---
name: verify-strings
description: Verify in a browser that the static texts of the ISBN Reader match src/strings.js (applyStrings, which fills the data-s* paths). Use after changes to applyStrings.
---

# Verify the static texts

Read `../verify-app/common.md` first (setup, closing check, report). One page load, no scenarios.

1. Load the app with clean storage. In one `page.evaluate`, `const S = await import('/src/strings.js')` (see `common.md` step 8).
2. For every element with a `data-s` attribute, its `textContent` equals `S.lookup(path)`. For every `data-s-<attr>` attribute, that attribute's value equals `S.lookup(path)`. Collect the elements from the page itself (`querySelectorAll('*')` and their attributes): do not write a list of them here.
3. No such text is empty, and `document.title` equals `S.page.title`.
4. Each mismatch is a failed check; give the element, the attribute and both values on its line.

Finish with the closing check from `common.md`.
