import assert from "node:assert/strict";
import test from "node:test";
import {
  JsonSyntaxError,
  completeJsonObjectSyntaxEvidence,
  parseJsonWithUniqueMembers,
} from "../app/_runtime/lib/kp/vnext/canonical-json.ts";

function rejectsAt(source, reason, path, offset, line = 1, column = offset + 1, parse = parseJsonWithUniqueMembers) {
  assert.throws(() => parse(source), (error) => {
    assert.ok(error instanceof JsonSyntaxError);
    assert.ok(error instanceof TypeError);
    assert.equal(error.message, reason);
    assert.deepEqual({ reason: error.reason, path: error.path, offset: error.offset,
      line: error.line, column: error.column }, { reason, path, offset, line, column });
    assert.ok(Object.isFrozen(error.path));
    return true;
  });
}

test("unique JSON parsing retains valid values and locates a nested invalid value", () => {
  const valid = '{"entries":[{"amount":2,"labels":["甲","😀"]}],"active":true,"empty":null}';
  assert.deepEqual(JSON.parse(JSON.stringify(parseJsonWithUniqueMembers(valid))), JSON.parse(valid));
  const source = '{"entries":[{"amount":!}]}';
  rejectsAt(source, "json:value-invalid", ["entries", 0, "amount"], source.indexOf("!"));
});

test("object and array delimiter errors retain their actual container paths", () => {
  const object = '{"outer":{"a":1 "b":2}}';
  rejectsAt(object, "json:object-delimiter-expected", ["outer"], object.indexOf('"b"'));
  const array = '{"values":[1 true]}';
  rejectsAt(array, "json:array-delimiter-expected", ["values"], array.indexOf("true"));
  const colon = '{"outer":{"field" 7}}';
  rejectsAt(colon, "json:colon-expected", ["outer", "field"], colon.indexOf("7"));
});

test("invalid string tokens point to their start and unclosed strings point to EOF", () => {
  const invalid = '{"outer":["bad\\q"]}';
  rejectsAt(invalid, "json:string-invalid", ["outer", 0], invalid.indexOf('"bad'));
  const unclosed = '{"outer":["bad';
  rejectsAt(unclosed, "json:string-unclosed", ["outer", 0], unclosed.length);
  const invalidKey = '{"outer":{"bad\\q":1}}';
  rejectsAt(invalidKey, "json:string-invalid", ["outer"], invalidKey.indexOf('"bad'));
});

test("duplicate object members include the duplicate key path and second token position", () => {
  const source = '{"entries":[{"a/b~c":1,"a/b~c":2}]}';
  rejectsAt(source, "json:duplicate-object-member", ["entries", 0, "a/b~c"], source.lastIndexOf('"a/b~c"'));
  const escaped = '{"field":1,"\\u0066ield":2}';
  rejectsAt(escaped, "json:duplicate-object-member", ["field"], escaped.indexOf('"\\u0066ield"'));
});

test("trailing content and unsupported member names retain exact detection positions", () => {
  const trailing = '{"field":true} false';
  rejectsAt(trailing, "json:trailing-content", [], trailing.indexOf("false"));
  const key = '{"outer":{unquoted:2}}';
  rejectsAt(key, "json:string-expected", ["outer"], key.indexOf("unquoted"));
});

test("incomplete containers, missing values and invalid numbers preserve parser reasons", () => {
  for (const [source, reason, path] of [
    ['{"entries":[', "json:array-unclosed", ["entries"]],
    ['{"outer":{', "json:object-unclosed", ["outer"]],
    ['{"outer":', "json:value-invalid", ["outer"]],
  ]) rejectsAt(source, reason, path, source.length);
  const number = '{"amount":1e999}';
  rejectsAt(number, "json:number-invalid", ["amount"], number.indexOf("}"));
  rejectsAt(undefined, "json:string-required", [], 0);
});

test("depth rejection identifies the actual bounded recursive path", () => {
  const source = "[".repeat(102) + "0" + "]".repeat(102);
  rejectsAt(source, "json:depth-exceeded", Array(101).fill(0), 101);
});

test("positions use UTF-16 offsets and columns with one-based multiline coordinates", () => {
  const multiline = '{"text":"😀",\r\n "items":[1,\r\n  !]}';
  rejectsAt(multiline, "json:value-invalid", ["items", 1], multiline.indexOf("!"), 3, 3);
  const sameLine = '{"text":"😀","items":[!]}';
  rejectsAt(sameLine, "json:value-invalid", ["items", 0], sameLine.indexOf("!"));
  const carriageReturn = '{\r "items":[!] }';
  rejectsAt(carriageReturn, "json:value-invalid", ["items", 0], carriageReturn.indexOf("!"), 2, 11);
});

test("complete root syntax evidence carries missing-close or trailing-comma diagnostics", () => {
  const missing = '{"items":[1,2]\n';
  const evidence = completeJsonObjectSyntaxEvidence(missing);
  assert.equal(evidence.issue, "json:root-close-missing");
  assert.deepEqual(evidence.diagnostic, { reason: "json:root-close-missing", path: [],
    offset: missing.length, line: 2, column: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(evidence.value)), { items: [1, 2] });
  assert.ok(Object.isFrozen(evidence.diagnostic));
  assert.ok(Object.isFrozen(evidence.diagnostic.path));
  for (const source of ['{"items":[1,2], \n}', '{"items":[1,2], \n']) {
    const trailing = completeJsonObjectSyntaxEvidence(source);
    const offset = source.lastIndexOf(",");
    assert.equal(trailing.issue, "json:root-trailing-comma");
    assert.deepEqual(trailing.diagnostic, { reason: trailing.issue, path: [], offset,
      line: 1, column: offset + 1 });
    assert.deepEqual(JSON.parse(JSON.stringify(trailing.value)), { items: [1, 2] });
  }
});

test("syntax evidence continues rejecting truncated children, duplicates and already valid roots", () => {
  const child = '{"items":[1,';
  rejectsAt(child, "json:array-unclosed", ["items"], child.length, 1, child.length + 1, completeJsonObjectSyntaxEvidence);
  const duplicate = '{"field":1,"field":2';
  rejectsAt(duplicate, "json:duplicate-object-member", ["field"], duplicate.lastIndexOf('"field"'),
    1, duplicate.lastIndexOf('"field"') + 1, completeJsonObjectSyntaxEvidence);
  const valid = '{"field":1}';
  rejectsAt(valid, "json:root-syntax-evidence-required", [], valid.length,
    1, valid.length + 1, completeJsonObjectSyntaxEvidence);
});

test("redundant closing delimiters after complete root members preserve every original value as evidence only", () => {
  for (const value of [{ decision: { kind: "directSuccess", steps: [{ result: { text: "} ] remains text" } }] } },
    { first: [1, { nested: true }], second: { amount: 3 } }]) {
    const valid = JSON.stringify(value);
    for (const source of [valid.slice(0, -1) + ']}}', valid + ']}', valid + ' } \n ]']) {
      assert.throws(() => parseJsonWithUniqueMembers(source), JsonSyntaxError);
      const evidence = completeJsonObjectSyntaxEvidence(source);
      assert.equal(evidence.issue, 'json:root-redundant-delimiters');
      assert.deepEqual(JSON.parse(JSON.stringify(evidence.value)), value);
      assert.throws(() => parseJsonWithUniqueMembers(source), error => {
        assert.deepEqual(evidence.diagnostic, { reason: error.reason, path: error.path,
          offset: error.offset, line: error.line, column: error.column });
        return true;
      });
    }
  }
  for (const source of ['{"decision":{"steps":[{"dc":12]}}', '{"decision":{"dc":12,"dc":1}]}}',
    '{"decision":{"dc":12}}] "dc":1', '{"decision":{"dc":12}} {"dc":1}',
    '{"decision":{"dc":12},]}', '{"decision":{"steps":[', '{"decision":{"text":"unterminated'] ) {
    assert.throws(() => completeJsonObjectSyntaxEvidence(source), JsonSyntaxError, source);
  }
});
