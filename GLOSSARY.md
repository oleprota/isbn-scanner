# ISBN Reader

A web page for checking books while shopping: enter or scan an ISBN, or type a title, and get a card with links to look the book up elsewhere.

## Language

**Card**:
What a search or scan shows for one book: its name, any details found, and links to the sites.
_Avoid_: Result, tile

**Book**:
Something known by its ISBN (or by the title it was found by), shown as a card or a row.
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

**Found by title**:
A book picked from the candidates for a typed title, so its site links search instead of using the ISBN.


**Page book**:
The book a web page is about, the one the browser extension shows a card for.
_Avoid_: Current book
