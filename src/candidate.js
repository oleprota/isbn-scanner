// What a title-search candidate (src/lookup.js `cleanResults`) tells about its book, as the details the card is
// built from before the edition answer comes: the same shape as a lookup answer, saved with `partial: true`.
// A series is read from the title when it carries one ("Dune (Dune, #1)").
const SERIES = /^(.*?)\s*\((.+?),?\s*#(\d[^)]*)\)$/;

export function detailsFromCandidate(candidate) {
  const match = SERIES.exec(candidate.title);
  const { rating, ratingCount } = candidate;
  return {
    title: match?.[1] || candidate.title,
    image: candidate.image,
    series: match ? { name: match[2].trim(), number: match[3].trim() } : null,
    author: candidate.author ? { name: candidate.author, url: candidate.authorUrl } : null,
    rating: rating > 0 && ratingCount > 0 ? { value: rating, count: ratingCount } : null,
  };
}

// The id of a book picked from the candidates: it has no ISBN until the edition answer says one.
export const candidateId = (candidate) => `gr:${candidate.id}`;
