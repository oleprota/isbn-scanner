# ISBN Reader: Page book extension

Chromium (Manifest V3). Click the toolbar icon on a book page: it finds the page's ISBN (`pickIsbn.js`: JSON-LD/meta, then title, then text or page data labelled "ISBN"), asks the lookup service, and shows a card (cover, name, author, rating, Ereadian and Goodreads links) in a corner frame, or, for a few seconds, a line saying what went wrong (no ISBN on the page, extension not answering, book not on Goodreads, lookup service offline/slow/busy/erroring; texts in `texts.js`). Nothing runs before the click; only the ISBN is sent, to our lookup service.

## Install (unpacked)
`chrome://extensions` → Developer mode → Load unpacked → this folder. The manifest `key` pins the ID `pklepflaloonoobdekhhkhllcclcgipm`, which `ALLOWED_ORIGINS` in `worker/index.js` allows.

## Shared code
`shared/` holds copies of `src/{isbn,lookup,text,links,strings}.js`. After changing those, run `node scripts/sync-extension.mjs`; `npm test` fails while they differ.

## Manual checklist (Chrome)
1. A book page with an ISBN in JSON-LD (ReadEat): click → card with cover, name, author, rating, two links.
2. Pages checked on 2026-11-01 by ISBN extraction only: Bohdan, MBooks (title), Nebo (labelled text), Apriori (page data); Yakaboo could not be loaded (Cloudflare). Click on each → card.
3. A listing page or any page without a book: click → the matching problem line, gone after ~6 s.
4. Close button and Escape both remove the card.
5. Site CSS does not change the frame (try a page with aggressive global styles); the frame does not change the page.
6. Dark colour scheme → dark frame, readable links.
7. Single-page shop: Apriori krapla-skverni → click a link to misto-shodiv → the old card closes; click the icon → card for the new book (ISBN from a fresh copy of the page).
8. Click twice → one frame. Offline → the matching problem line, no errors.
