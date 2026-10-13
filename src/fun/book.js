// The Combo Book as pure functions: which combos you have landed, how many times, and the best way you landed each (free work, then
// Count it, Good, Great, Perfect). Eleven named pages and one hidden one (Alphabet). Any combo you land is logged, named or not.
// No DOM, no kit, no storage: the session keeps the record in its store and passes it in.
import { BOOK_NAMED, BOOK_RANK } from "./config.js";

const rank = (j) => BOOK_RANK.indexOf(j);
const better = (a, b) => (rank(a) >= rank(b) ? a : b);

/**
 * Add what a round landed to the book. `landed` is a list of { str, judgment } where judgment is "free" for an uncalled chain of
 * two or more punches, or the call's judgment (perfect, great, good, count) for a called one.
 * @returns {{book:object, added:Array<{str:string, name:string|null, hidden:boolean}>}} the next book (a copy) and the entries that are new
 */
export function bookAdd(book, landed) {
  const next = { ...(book ?? {}) };
  const added = [];
  for (const { str, judgment } of landed ?? []) {
    if (!str || rank(judgment) < 0) continue;
    const had = next[str];
    next[str] = { count: (had?.count ?? 0) + 1, best: had ? better(had.best, judgment) : judgment };
    if (!had) { const n = BOOK_NAMED.find((x) => x.str === str); added.push({ str, name: n?.name ?? null, hidden: !!n?.hidden }); }
  }
  return { book: next, added };
}

/** How many different combos are in the book, and how many of the twelve named pages are filled. */
export function bookCounts(book) {
  const distinct = Object.keys(book ?? {}).length;
  const named = BOOK_NAMED.filter((n) => book?.[n.str]).length;
  return { distinct, named, total: BOOK_NAMED.length };
}

/** The pages to draw: every named page (the hidden one only once it is found) with its count and best, locked pages with no entry. */
export function bookPages(book) {
  return BOOK_NAMED.filter((n) => !n.hidden || book?.[n.str]).map((n) => ({ ...n, entry: book?.[n.str] ?? null }));
}
