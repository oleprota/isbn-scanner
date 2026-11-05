# A book found by title gets search links, not ISBN links

A title typed into the field is looked up through the worker (`/search`, then `/book`). The picked edition's ISBN may not be the edition in hand, and Ereadian's search misses a book when an author is spelled differently there. So the site links search instead: Ereadian by the title alone, Goodreads by the title and author (both from the candidate). A book picked from the candidates is shown at once and has no ISBN until the edition request answers, so Goodreads links to the page address of the candidate (a title-and-author search for older entries that have none). A later search or scan by that ISBN goes back to ISBN links.

Once a lookup by ISBN answers with the Goodreads book id, the book is one entry `gr:<n>` (a scanned ISBN and a picked edition of the same Goodreads book merge). A found-by book thereby gets its Goodreads page address, and, having an ISBN, an ISBN-based Ereadian link.

Accepted risk: the Goodreads page address and the ISBN an edition request gives may be a different edition from the one in hand. Goodreads is linked by the page address of the book picked (the one thing the user chose), Ereadian by the ISBN only once it is known; a wrong edition is tolerated rather than hiding the book until the ISBN is found.
