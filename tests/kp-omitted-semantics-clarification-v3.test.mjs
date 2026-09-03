import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compileKpFormDraft,
} from "../app/_runtime/lib/kp/causal-action-program.ts";
import {
  validateKpFormDraft,
} from "../app/_runtime/lib/kp/form-catalog.ts";

const SOURCE = new URL("../app/_runtime/lib/kp/authoritative.ts", import.meta.url);

test("only a pure omission becomes a question; a changed semantic stays terminal", async () => {
  const source = await readFile(SOURCE, "utf8");
  const body = source.slice(source.indexOf("function omittedSemanticKeys"));
  const matcher = /\/\^semantic-freeze:\(\.\+\):unproven\$\/u/u;
  assert.match(body, matcher, "only the unproven variant is convertible");

  // `:changed` means the repair overwrote frozen player intent. That is the
  // violation the freeze exists for and must never become a question.
  assert.doesNotMatch(
    body.slice(0, body.indexOf("function clarificationForOmittedSemantics")),
    /:changed/u,
  );

  // A single non-matching diagnostic disqualifies the whole set, so a repair
  // that failed for several reasons is not quietly reduced to a question.
  assert.match(body, /if \(match === null\) return \[\];/u);
});

test("a clarification continuation is never converted again", async () => {
  const source = await readFile(SOURCE, "utf8");
  assert.match(
    source,
    /omitted\.length > 0\s*&&\s*input\.request\.proposalPurpose !== "clarificationContinuation"/u,
  );
});

test("the server-written clarification is a valid Form draft that lowers to the pending-input path", () => {
  // The exact draft shape the adapter builds for a missing `desiredInformation`.
  const draft = {
    goal: "看看桌上那封信写了什么",
    question: "要裁定这项行动，还差一点：你想知道的具体是什么？请用一句话补充。",
    choices: ["你想知道的具体是什么"],
  };

  const validation = validateKpFormDraft("clarification.v1", draft);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.ok, true);

  // `requestClarification` is the primitive Rules turns into `awaitingInput`.
  const program = compileKpFormDraft("clarification.v1", draft);
  assert.equal(program.nodes[0].primitive, "requestClarification");
  assert.equal(program.nodes[0].arguments.question, draft.question);
});

test("the question is built from the player's own frozen goal, never invented", async () => {
  const source = await readFile(SOURCE, "utf8");
  const body = source.slice(
    source.indexOf("function clarificationForOmittedSemantics"),
    source.indexOf("function buildV3Proposal"),
  );

  // The goal is reused from the rejected draft; only a missing one falls back.
  assert.match(body, /typeof prior\.goal === "string"/u);
  assert.match(body, /\? prior\.goal/u);

  // No frozen semantic hash is carried over: the clarification is a new,
  // server-authored frame, so the hash is recomputed rather than reused from
  // a Form whose semantics it does not share.
  assert.doesNotMatch(body, /input\.semanticFreezeHash/u);
});

test("no model call is spent on the clarification", async () => {
  const source = await readFile(SOURCE, "utf8");
  const body = source.slice(
    source.indexOf("function clarificationForOmittedSemantics"),
    source.indexOf("function buildV3Proposal"),
  );
  // SPEC 0015 §6.1 freezes the budget at two invocations. The clarification
  // reuses the repair's receipt and issues no third prompt.
  assert.doesNotMatch(body, /invokeModel|runInvocation|await /u);
  assert.match(body, /invocationReceipt/u);
});
