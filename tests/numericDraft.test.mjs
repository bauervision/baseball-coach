import { test } from "node:test";
import assert from "node:assert/strict";

import {
  nextNumericDraft,
  normalizeNumericDraft,
  parseNumericDraft,
} from "../src/lib/numericDraft.ts";

test("typing after a placeholder 0 replaces it (no 07)", () => {
  assert.equal(nextNumericDraft("0", "07"), "7");
  assert.equal(nextNumericDraft("0", "012"), "12");
});

test("typing over a selected 0 works normally", () => {
  assert.equal(nextNumericDraft("0", "7"), "7");
});

test("empty is allowed mid-edit", () => {
  assert.equal(nextNumericDraft("7", ""), "");
  assert.equal(nextNumericDraft("", "3"), "3");
});

test("non-integer and negative input is rejected", () => {
  assert.equal(nextNumericDraft("3", "3a"), null);
  assert.equal(nextNumericDraft("3", "-3"), null);
  assert.equal(nextNumericDraft("3", "3.5"), null);
  assert.equal(nextNumericDraft("3", "1e3"), null);
});

test("ordinary edits of nonzero values are not coerced per keystroke", () => {
  assert.equal(nextNumericDraft("1", "10"), "10");
  assert.equal(nextNumericDraft("10", "100"), "100");
  // Deleting the leading 1 of 105 leaves "05" until blur.
  assert.equal(nextNumericDraft("105", "05"), "05");
  // Typing in front of a 0 is left alone.
  assert.equal(nextNumericDraft("0", "70"), "70");
});

test("blur normalizes leading zeros and empties", () => {
  assert.equal(normalizeNumericDraft("05"), "5");
  assert.equal(normalizeNumericDraft("000"), "0");
  assert.equal(normalizeNumericDraft(""), "0");
  assert.equal(normalizeNumericDraft("", true), "");
  assert.equal(normalizeNumericDraft(" 12 "), "12");
});

test("parse treats empty as zero (or a given fallback)", () => {
  assert.equal(parseNumericDraft(""), 0);
  assert.equal(parseNumericDraft("", 3), 3);
  assert.equal(parseNumericDraft("07"), 7);
  assert.equal(parseNumericDraft("42"), 42);
});

test("full field session: focus 0, type 7, blur → 7", () => {
  let committed = "0";
  let draft = committed; // focus copies the value into the draft
  const next = nextNumericDraft(draft, draft + "7"); // caret after the 0
  assert.equal(next, "7");
  draft = next;
  committed = draft;
  committed = normalizeNumericDraft(draft);
  assert.equal(committed, "7");
  assert.equal(parseNumericDraft(committed), 7);
});

test("full field session: clear then blur restores 0", () => {
  let draft = nextNumericDraft("5", "");
  assert.equal(draft, "");
  assert.equal(parseNumericDraft(draft), 0); // stat value while empty
  assert.equal(normalizeNumericDraft(draft), "0");
});
