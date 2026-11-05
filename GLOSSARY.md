# ISBN Reader

A web page for checking books while shopping: enter or scan an ISBN, or type a title, and get a card with links to look the book up elsewhere.

## Language

**Card**:
What a search or scan shows for one book: its name, any details found, and links to the sites.
_Avoid_: Result, tile

**Book**:
Something known by its ISBN (or, with no ISBN yet, by the Goodreads page it was picked from), shown as a card or a row. Stores key it by an id: `isbn:<isbn>`, or `gr:<Goodreads id>` for a book picked by title.
_Avoid_: Item, entry

**Scanned**:
The list of every book searched or scanned, newest first.
_Avoid_: History

**Marked**:
The list of books the user starred, for shopping.
_Avoid_: Favourites, wishlist

**Lookup**:
The optional request to our worker for a book's title, series, author, rating and cover.
_Avoid_: Fetch, enrichment

**Details**:
What a lookup found for a book.
_Avoid_: Metadata, meta

**Name**:
What the user typed for a book by tapping its title; it beats any found title.
_Avoid_: Label, custom title

**Book id**:
What a stored book is matched by: `isbn:<isbn>`, or `gr:<Goodreads id>` for a book picked by title. A lookup that returns the Goodreads id upgrades `isbn:X` to `gr:N` and merges it with an existing `gr:N` book.
_Avoid_: Key, uid

**Goodreads page address**:
The `bookUrl` of a candidate (or of a found book): the address Goodreads' own page for that book has. It is what the Goodreads link opens for a book found by title.
_Avoid_: Goodreads link

**Found by title**:
A book picked from the candidates for a typed title, so its site links go by its Goodreads page address (Goodreads) and by the ISBN once known, else the title (Ereadian). It is shown at once, with no ISBN needed.


**Page book**:
The book a web page is about, the one the browser extension shows a card for.
_Avoid_: Current book

**Thin rating**:
A rating whose count is under `THIN_RATING_COUNT` (100); shown with an orange count and a warning icon.
_Avoid_: Weak rating, low rating
