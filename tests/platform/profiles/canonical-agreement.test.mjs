// Behavior assertions grouped by function; see README.md in this directory.
/**
 * Two canonicalizers hash the same values and must not disagree.
 *
 * The room archive verifies a proposal invocation's requestHash, which the
 * story store wrote with the rules canonicalizer. They agreed on everything
 * until a value carried integer-like object keys: the archive sorted its keys
 * and then rebuilt the record with `Object.fromEntries`, which restores
 * JavaScript's property order and puts "10" before "2". A compacted tool
 * schema names its `$def` entries "0", "1", ... "10", so every room that made
 * a proposal had an archive that could never verify, and the telemetry said
 * only that a binding was invalid.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, archiveSha256 } from "../../../app/_runtime/lib/room/archive.ts";
import { canonicalSha256, canonicalProfileBytes } from "../../../app/_runtime/lib/rules/profiles/canonical.ts";

const text = (value) => new TextDecoder().decode(canonicalProfileBytes(value));

/** Values both canonicalizers accept, including the shapes that exposed the gap. */
const SHARED = [
  null, true, 0, -1, 1.5, "", "文字", [],
  { b: 1, a: 2 },
  { "10": 1, "2": 2, "1": 3, "0": 4, b: 5 },
  { $def: { 0: { type: "string" }, 1: { type: "array" }, 10: { type: "object" }, h: { type: "number" } } },
  { nested: [{ "2": [1, 2], "10": { z: 1, a: 2 } }] },
  { "01": 1, "1": 2, "+1": 3, "1.0": 4, "-1": 5 },
  { "4294967295": 1, "4294967296": 2, "2": 3 },
];

test("the archive and rules canonicalizers write the same bytes", () => {
  for (const value of SHARED) {
    assert.equal(canonicalJson(value), text(value),
      `canonical text must agree for ${JSON.stringify(value)}`);
  }
});

test("the archive and rules hashes agree, which is what an archive verifies against", async () => {
  for (const value of SHARED) {
    assert.equal(await archiveSha256(value), canonicalSha256(value),
      `hashes must agree for ${JSON.stringify(value)}`);
  }
});

test("an integer-like key sorts as text, not as a number", () => {
  // "10" before "2" is the whole point: JavaScript's own property order is the
  // opposite, and a canonical form may not inherit it.
  assert.equal(canonicalJson({ "10": 1, "2": 2, "1": 3 }), '{"1":3,"10":1,"2":2}');
  assert.equal(canonicalJson({ $def: { 2: "b", 10: "a" } }), '{"$def":{"10":"a","2":"b"}}');
});

test("the archive canonicalizer keeps the rest of its contract", () => {
  assert.equal(canonicalJson({ kept: 1, dropped: undefined }), '{"kept":1}');
  assert.equal(canonicalJson(-0), "0");
  assert.equal(canonicalJson([1, [2, { a: 3 }]]), '[1,[2,{"a":3}]]');
  assert.throws(() => canonicalJson(Number.NaN), /finite/);
  assert.throws(() => canonicalJson(Number.POSITIVE_INFINITY), /finite/);
  assert.throws(() => canonicalJson(() => 1), /JSON values/);
});
