# Lookup service

A tiny Cloudflare Worker with three read paths and one for usage stats (`POST /event`, below). `GET /search?q=<title>` answers `{results: [{id, title, author, image}]}` (up to 5, which is Goodreads' own cap, from its search-as-you-type JSON; when nothing matches, the last word is dropped and it is asked again, up to 4 tries, so an author word Goodreads doesn't know doesn't empty the list; cached 1 day, or 1 minute when empty; 502 when Goodreads fails). `GET /book?id=<Goodreads book id>` answers `{isbn, title, series, author, rating, image}` of that edition (the same details as `/lookup`, so a picked result needs no second page fetch), or `404 {}` when it has no valid one. `GET /lookup?isbn=<isbn>` reads the Goodreads page for that ISBN and answers `{title, series: {name, number}, author: {name, url}, rating: {value, count}, image}` as JSON (the title has its trailing brackets cut off; the series is the bracket with a `#number`; the author is the first one listed; `series`, `author` and `rating` are `null` when the page has none), or `404 {reason}` when there is nothing. The app (`src/lookup.js`) uses it to name a book and show its cover. The app works fully without it.

- Only `https://oleprota.github.io`, `http://localhost:8000` and the browser extension (`extension/`) may call it from a browser (`ALLOWED_ORIGINS` in `index.js`).
- The cache key carries a version (`v7` in `index.js`): change it whenever the answer's shape changes, so old cached answers are not served.
- Answers are cached: 7 days for a found book, 1 day when Goodreads answers 404, and only 1 minute for any other miss (an empty 202, a block, an error), so a hiccup is not remembered as "no such book". A 202 is asked again, up to 4 tries in all, 1.5 s apart. A miss carries an `x-miss-reason` header (`curl -i` shows why).
- New (uncached) lookups are limited to 20 per 10 seconds per address (`wrangler.toml`). Past that the answer is 429, and the app waits 5 s and asks again (up to 3 times).
- Free plan: 100,000 requests a day, 10 ms CPU each. Past the limit requests fail (the app then just shows `ISBN <number>`); nothing is billed unless you upgrade to a paid plan.
- Where it is deployed: https://isbn-lookup.oleprota.workers.dev (Cloudflare account of oleprota@gmail.com, worker `isbn-lookup`; first deployed 2026-10-26).

## Usage stats (optional)

`POST /event` takes a batch of anonymous usage events from the app (`src/stats.js`) and keeps them in a D1 database (Cloudflare's free SQLite). Which events and fields are allowed is in `events.js`; anything else is dropped, and a body over 4 KB or an address past 10 batches a minute (`EVENT_LIMITER`) is refused. A daily job (`scheduled` in `index.js`, the cron in `wrangler.toml`) deletes events older than 90 days. Without the database the endpoint answers 204 and drops the events, so nothing else depends on it. Set it up once:

    cd worker
    npx wrangler d1 create isbn-stats          # prints a database_id
    # uncomment [[d1_databases]] in wrangler.toml and paste the id
    npx wrangler d1 execute isbn-stats --remote --file=schema.sql
    npx wrangler deploy

Read it (every row has `dev`: 1 is the developer's own use, leave it out):

    npx wrangler d1 execute isbn-stats --remote --command "SELECT json_extract(data,'$.os') os, json_extract(data,'$.browser') browser, COUNT(DISTINCT id) users FROM events WHERE name='session' AND dev=0 GROUP BY 1,2"
    npx wrangler d1 execute isbn-stats --remote --command "SELECT json_extract(data,'$.result') result, COUNT(*) n, CAST(AVG(json_extract(data,'$.ms')) AS INT) avg_ms FROM events WHERE name='lookup' AND dev=0 GROUP BY 1"

Is Goodreads blocking us? The worker writes rows with id `worker`: an `upstream` row per real Goodreads fetch and a `cache_hit` row per answer from the cache, each with `kind` (`lookup` = book page by ISBN, `book` = edition picked from a title search, `search` = title search, one row, whose `tries` field says how many Goodreads requests it cost, at most 3). For an `upstream` row `result` is `found` or the reason it failed (`page-refused` = 403/429, `page-empty` = empty 202, `page-down`, `page-404`, `page-no-book`; a search: `found`, `empty`, `failed`). The app's `lookup` rows carry the same `reason` for a missing book. Threshold for starting the backlog work "Goodreads blocking": on a day with 200+ real fetches, over 5% `page-refused` or `page-empty`.

    npx wrangler d1 execute isbn-stats --remote --command "SELECT date(ts/1000,'unixepoch') day, name, json_extract(data,'$.kind') kind, json_extract(data,'$.result') result, COUNT(*) n FROM events WHERE name IN ('upstream','cache_hit') AND dev=0 GROUP BY 1,2,3,4 ORDER BY 1 DESC"

## Deploy (once)

1. Make a free Cloudflare account (no card needed): https://dash.cloudflare.com/sign-up
2. From this folder, log in and deploy (needs Node):

       cd worker
       npx wrangler login
       npx wrangler deploy

   The last line prints the address, like `https://isbn-lookup.<your-name>.workers.dev`.
3. Try it: `curl "https://isbn-lookup.<your-name>.workers.dev/lookup?isbn=9786171299412"` should print the book's JSON.
4. Put the address (no trailing slash) into `LOOKUP_URL` in `src/lookup.js`, commit and push; the Pages site picks it up.

To change the service, edit `worker/` and run `npx wrangler deploy` again. To turn the lookup off, set `LOOKUP_URL` back to `''`.

## Testing without the cache

To see what Goodreads really answers now (the bypass neither reads nor writes the edge cache, answers `cache-control: no-store`, and the rate limiter still applies):
- From the page: a developer (the `dev` flag, ADR-0004) sees a "Для розробника" frame under the stats line; unticking its box adds `nocache=1` to every request until the page is reloaded.
- By hand: add `&nocache=1` to any `/lookup`, `/book` or `/search` URL.

## Check by hand

`npx wrangler dev` runs it locally on http://localhost:8787; `npm test` covers the parsing and the handler without the network.
