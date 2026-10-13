import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStorage } from "../src/vendor/fun-kit/index.js";
import { BOOK_NAMED, BADGES } from "../src/fun/config.js";
import { bookAdd, bookCounts, bookPages } from "../src/fun/book.js";
import { makeKit } from "../src/fun/kit.js";
import { COPY } from "../src/fun/copy.js";

test("the Combo Book: eleven named pages and one hidden, any combo can be logged, any judgment", () => {
  assert.equal(BOOK_NAMED.length, 12);
  assert.equal(BOOK_NAMED.filter((n) => n.hidden).length, 1);
  assert.equal(BOOK_NAMED.find((n) => n.hidden).name, "Alphabet");
  const { book, added } = bookAdd({}, [{ str: "1-2", judgment: "perfect" }, { str: "1-2-3-2-1", judgment: "free" }]);
  assert.deepEqual(added.map((a) => [a.str, a.name]), [["1-2", "One-Two"], ["1-2-3-2-1", null]]);
  assert.deepEqual(bookCounts(book), { distinct: 2, named: 1, total: 12 });
});

test("a page keeps a count and the best way it was landed (Perfect over Great over Good over Count it over free work)", () => {
  let b = bookAdd({}, [{ str: "1-2", judgment: "good" }]).book;
  b = bookAdd(b, [{ str: "1-2", judgment: "perfect" }]).book;
  b = bookAdd(b, [{ str: "1-2", judgment: "free" }]).book;
  assert.deepEqual(b["1-2"], { count: 3, best: "perfect" });
  const again = bookAdd(b, [{ str: "1-2", judgment: "great" }]);
  assert.equal(again.added.length, 0, "a second landing is not new");
  assert.equal(again.book["1-2"].best, "perfect");
});

test("nothing that is not a landing goes in: a missed or unknown judgment is ignored, and the old book is never mutated", () => {
  const old = { "1": { count: 1, best: "good" } };
  const r = bookAdd(old, [{ str: "1-2", judgment: "missed" }, { str: "", judgment: "perfect" }, { str: "1-1", judgment: "great" }]);
  assert.deepEqual(Object.keys(r.book).sort(), ["1", "1-1"]);
  assert.deepEqual(Object.keys(old), ["1"]);
});

test("the hidden Alphabet page shows only once it is found; the others show locked until landed", () => {
  const pages = bookPages({ "1-2": { count: 1, best: "good" } });
  assert.equal(pages.length, 11);
  assert.equal(pages.find((p) => p.str === "1-2").entry.count, 1);
  assert.equal(pages.find((p) => p.str === "1-2-3").entry, null);
  assert.equal(bookPages({ "1-2-3-4-5-6": { count: 1, best: "free" } }).length, 12);
});

test("the Combo Book badges open at five different combos and at all twelve pages", () => {
  const kit = makeKit({ storage: createMemoryStorage() });
  const ids = (m) => kit.completeSession({ metrics: m, counters: {}, first: [], tags: [] }).badges.map((b) => b.id);
  assert.deepEqual(ids({ bookDistinct: 4, bookNamed: 4 }), []);
  assert.deepEqual(ids({ bookDistinct: 5, bookNamed: 4 }), ["book_5"]);
  assert.deepEqual(ids({ bookDistinct: 14, bookNamed: 12 }), ["book_12"]);
  assert.ok(BADGES.find((b) => b.id === "book_12").desc.includes("Combo Book"));
});

test("Combo Book copy reads well and passes the pressure lint", () => {
  const kit = makeKit({ storage: createMemoryStorage() });
  for (const t of [COPY.book.note, COPY.book.own(2), COPY.book.fresh("Classic"), COPY.book.locked, COPY.book.tag(3, 11)]) assert.deepEqual(kit.guard.lintCopy(t), []);
  assert.equal(COPY.book.own(1), "1 more of your own combo logged.");
});
