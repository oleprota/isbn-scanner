# Goodreads: the most popular edition as a stand-in for the original

Explored 2026-11-03. Status: **parked**, nothing built. Backlog entry: "Rating and link from the most popular edition".

## The question

The card can show the Original of a translation (`worker/`, `originalAnswer`). Idea: instead, or as well, show the book's *most popular edition*, so the rating rests on more votes. On a Goodreads book page the "More editions" list seemed to start with that edition (checked by eye on 5 books by the user).

## Findings

### 1. "More editions" is loaded after the page, from a private API
- Not in the page's HTML. It appears after "Book details & editions" is clicked (a real click; a scripted `.click()` did nothing at first, and a login popup blocks the first click: Escape closes it. Removing the popup from the DOM crashes the page).
- The list is one call: `POST https://kxbwmqov6jgg3daaamb744ycu4.appsync-api.us-east-1.amazonaws.com/graphql`, operation `getEditions(id: <work id>, pagination: {limit: 20})`, with an `x-api-key` (the key is in the page HTML) and an AWS WAF token (`x-aws-waf-token`, made by the browser).
- Per edition it returns only: format, publisher, publication time, cover URL, title, book link, primary contributor. **No rating, no ISBN, no language, no page count.** Also `totalCount` (68 on the example) and the "Show all N editions" link `/work/editions/<legacy work id>`.
- Not tried outside the browser (the call was blocked by the permission check and not pursued). Not recommended anyway: a private API, a WAF token, and it has no rating.

### 2. The first edition in the list is the work's `bestBook`, and that is in the page HTML
- The server HTML has `<script id="__NEXT_DATA__">` → `props.pageProps.apolloState`. Its `Work:` entry has `bestBook` → a `Book:` entry with `legacyId` and `webUrl` only (no title, rating or cover).
- Matches the first list item on both examples checked:

| Page | `bestBook` | First in "More editions" |
|---|---|---|
| 253827751 "Тео з Ґолдена" | 242376245 (`/book/show/242376245-theo-of-golden`) | same |
| 262031111 "Хозарський словник" | 321566 (`/book/show/321566.Dictionary_of_the_Khazars`) | same |

- To show a rating, title or cover of that edition, its own page has to be fetched (JSON-LD, as `parseBook` / `editionOfBook` already do): one extra request.

### 3. The most popular edition adds no better rating: Goodreads already merges editions
- On a book page, the JSON-LD `aggregateRating` equals the work's `stats` in the page state, not the edition's own. Example: the Ukrainian edition 253827751 (published 2026-08) shows 4.41 from 720,697 ratings, identical to the work's stats. Same on 262031111 (4.17 / 7,930).
- Editions listed under a page belong to the same work, so the best edition's page shows the same numbers. **The idea gains a link, cover and title, not a more reliable rating.** (Unless some part of the app takes ratings from elsewhere, such as search results, which carry per-book numbers.)

### 4. What is left unsolved: no ISBN on Goodreads, or an edition not connected to others
**a) Book absent from Goodreads** (example: `ridna-mova.com/golos-okeanu.html`).
- The shop page states "Оригінальна назва книжки: Voice of the Ocean" and the ISBN as plain text, with no JSON-LD. Reading it is site-specific scraping (ADR 0002 rules that out for the worker; a content script in the user's browser might be allowed, one parser per shop).
- Today the user can type the original title into the title search. A hint on the card ("not on Goodreads, type the original title") would be a text change.

**b) On Goodreads, but not connected** (example: 221072279 "Неосяжний світ", Ed Yong).
- `originalTitle` is empty; the work's `bestBook` is the page itself (20 ratings).
- The author's page is reachable: JSON-LD gives `/author/show/4124738.Ed_Yong`. `https://www.goodreads.com/author/list/4124738.Ed_Yong` is plain server-rendered HTML (curl, HTTP 200, 130 KB) with, per book: link/id, title, average rating, ratings count, year. First row was the author's best-known book (An Immense World, 4.46, 39,760 ratings).
- Matching is the hard part: the translated title does not match the English one, and Goodreads has no link between them. Auto-picking "the top book" is wrong for authors with several books. Safer: a short list of the author's top 3–5 books (rating, count, link) with a "none of these" choice. One extra request, only when there is no original and no linkage.
- Risks: unofficial list-page markup; order checked for one author only; fetch from a Cloudflare Worker not tried (only from a laptop).

### 5. Telling a translation from an original when no editions are listed
- The page state labels contributors: `primaryContributorEdge.role` and `secondaryContributorEdges[].role` ("Author", "Translator"). The JSON-LD lists the translator as a plain `author` with no role, and `firstAuthor` reads only JSON-LD.

| Page | Kind | Contributors (state) | `originalTitle` |
|---|---|---|---|
| 222780495 "Шептуха" | original Ukrainian novel | Author only | empty |
| 221072279 "Неосяжний світ" | translation, not connected | Author, **Translator** | empty |
| 253827751 "Тео з Ґолдена" | translation, connected | Author, **Translator** | "Theo of Golden" |
| 262031111 "Хозарський словник" | translation, connected | Author, Author (Павич), **Translator** | "Хазарски речник…" |

- Rule that fits all four: a Translator role means a translation; none means probably an original (no fallback offered).
- On 262031111 the first author is not always the original author: pick the contributor whose role is exactly "Author" and whose link is an author page.
- Can fail: translator not added on Goodreads (looks like an original); other role strings (only these two seen); a translation of a book that is not on Goodreads (the list finds nothing). Page language ("Ukrainian") does not prove a translation.

## Fallbacks considered

| Option | Verdict |
|---|---|
| Read the "More editions" list (GraphQL `getEditions`) | No: private API, WAF token, no ratings. |
| `bestBook` from the page state + one fetch of that edition | Works, but gives no better rating (finding 3). |
| Author's `/author/list/` page, user picks | Feasible in our setup; needs a small parser and a picker; one extra request. |
| Shop-page original title (extension, per shop) | Possible only per shop, against the site-links-only stance; typing the title already works. |
| "Type the original title" hint when not found | Cheapest; text only. |

## Not checked
- `bestBook` first-in-list on more than 2 pages (the user eyeballed 5).
- Other contributor role names; how often translators are left off.
- Whether the author list's default order is always popularity.
- Fetching `/author/list/…` and the page state from a Cloudflare Worker (worker byte limits: the deep read stops at 800 KB; the 222780495 page is 677 KB; the position of `secondaryContributorEdges` in the stream was not measured).
- The ISBN on the ridna-mova.com page (978-617-8691-38-7) against Goodreads.
- Calling `getEditions` directly.

## Decision
Parked on 2026-11-03: the rating gain is nil, and the remaining cases (book absent, or not connected to editions) are too narrow for the extra request, parser and picker.
