import assert from "node:assert/strict";
import test from "node:test";
import { healingPotionItemDefinition, ITEM_ENTRY_SCHEMA } from "../../../app/_runtime/lib/rules/v2/items.ts";
import { authorityRevisionOrHash } from "../../../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { createEventTransition } from "../../../app/_runtime/lib/rules/v2/events.ts";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_TARGET as GIVER,
  PROBE_SCENE as SCENE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { proposalModelContext, recallKnowledge, withRecalledKnowledge } from "../../../app/_runtime/lib/kp/vnext/proposal-context.ts";
import { encodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { vnextProposalRevisionCandidate } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { authorityProposalDiagnostics } from "../../../app/_runtime/lib/kp/vnext/proposal-diagnostics.ts";
import { VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE } from "../../../app/_runtime/lib/kp/vnext/room-bridge.ts";
import { vnextRulesRevisionDiagnostics } from "../../../app/_runtime/lib/room/vnext-proposal-invocation.ts";

// An audit of how the KP is helped to name the right carried item, over the
// ways an item comes to hand, where same-named items sit and the operations
// that name one -- not over one sentence. Each check runs the production
// freeze, form validation and Room's Rules preflight; no model is called.
// What it finds today is listed in KNOWN_GAPS, and the test fails when a gap
// appears that is not listed or a listed one no longer reproduces.

/** What the audit finds on 2026-10-10 at 36e6a76d, each a piece of later
 * work. Close one and remove it here; a new one fails the test. */
const KNOWN_GAPS = new Map([
  // Context: nothing the KP is sent tells the referent apart.
  ["context:taken-from-two-containers:merged-with-alternative", "two alike pieces taken out join one stack; the earlier one's source is overwritten"],
  ["context:picked-up-from-floor:no-fact-for-recent", "picking an item up records nothing, so 'the key I just picked up' matches every key"],
  ["context:handed-over-by-other:no-fact-for-giver", "an item handed over records no giver, so 'the rope he just gave me' matches every rope"],
  // Location: the diagnostic does not point at the field that is wrong.
  ["location:put-in-closed-box-declared-open:points-at-operation", "an undeclared opening is reported at the declaration, not at access"],
  ["location:take-out-of-the-wrong-container:points-at-operation", "a source in another container is reported at the declaration, not at entryRef"],
  ["location:store-into-other-holders-satchel:points-at-", "storing into another character's bag is refused with a bare code, no path or requirement"],
  ["location:store-what-another-holds:points-at-", "storing another character's item is refused with a message, no path"],
  ["location:take-what-another-holds:points-at-", "taking another character's item is refused with a message, no path"],
  ["location:give-what-lies-on-the-floor:points-at-", "giving an item on the floor is refused as the recipient being unavailable, no path"],
  // Candidates: a wrong reference is not answered with the ones that would do.
  ["candidates:store-what-another-holds:none-offered", "no list of items the actor could store"],
  ["candidates:take-out-of-the-wrong-container:none-offered", "no list of what is in that container"],
  ["candidates:give-what-lies-on-the-floor:none-offered", "no list of items the actor holds"],
  // One round: Rules stops at the first refused step, and a refused
  // declaration stops every other step from being checked.
  ["one-round:put-back-the-stack-left-inside+store-what-another-holds:missing-A verified shared check is required to take another holder's item.",
    "a refused containerTransfer declaration keeps the plain store from being checked"],
  ["one-round:store-into-other-holders-satchel+take-what-another-holds:missing-A verified shared check is required to take another holder's item.",
    "Rules reports only the first refused step"],
  ["one-round:store-into-closed-box+drop-what-is-in-the-box:missing-inventory:open-container-before-accessing-known-entry",
    "Rules reports only the first refused step"],
]);
function assertGaps(found, kinds) {
  const known = [...KNOWN_GAPS.keys()].filter(gap => kinds.some(kind => gap.startsWith(`${kind}:`)));
  assert.deepEqual({ new: found.filter(gap => !KNOWN_GAPS.has(gap)), closed: known.filter(gap => !found.includes(gap)) }, { new: [], closed: [] },
    "a new gap needs fixing; a closed one is removed from KNOWN_GAPS");
}

const definition = (id, label, extra = {}) => { const value = healingPotionItemDefinition(); value.definitionId = `item-definition:audit:${id}`;
  Object.assign(value.content, { label, aliases: [label], description: `一件${label}。`, category: "object", tags: [], use: null, ...extra });
  return value; };
const DEF = { cloth: definition("cloth", "干净布条"), box: definition("box", "随身木盒", { stackable: false }),
  barrel: definition("barrel", "敞口木桶", { stackable: false }), pouch: definition("pouch", "布袋", { stackable: false }),
  satchel: definition("satchel", "挎包", { stackable: false }), key: definition("key", "铜钥匙", { stackable: false }),
  rope: definition("rope", "麻绳", { stackable: false }) };
const E = { box: "item-entry:audit:box", barrel: "item-entry:audit:barrel", pouch: "item-entry:audit:pouch", satchel: "item-entry:audit:satchel",
  cloth: "item-entry:audit:cloth", keyA: "item-entry:audit:key-a", keyB: "item-entry:audit:key-b", keyGround: "item-entry:audit:key-ground",
  ropeOwn: "item-entry:audit:rope-own", ropeGift: "item-entry:audit:rope-gift" };
const held = (entryId, def, holderRef = ACTOR, extra = {}) => ({ definitionRef: def.definitionId, entry: { entryId, quantity: 1, ...extra,
  placement: { kind: "held", holderRef, equippedSlot: null }, ownership: { kind: "character", ownerRef: holderRef } } });
const ground = (entryId, def, extra = {}) => ({ definitionRef: def.definitionId, entry: { entryId, quantity: 1, ...extra,
  placement: { kind: "scene", sceneRef: SCENE }, ownership: { kind: "unowned", ownerRef: null }, visibilityPolicyRef: "visibility:scene-observers" } });

/** One authority shared by every scenario: the actor carries a closed box,
 * an open pouch, five cloths, two keys and a rope; an open barrel and a key
 * lie in the room; the other character carries a satchel and a rope. Each
 * scenario then plays its own history through Rules. */
function world() {
  const f = createAuthoredProbeFixture("item-reference-audit", { itemDefinitions: Object.values(DEF), itemEntries: [
    held(E.box, DEF.box, ACTOR, { initialState: "open" }), held(E.pouch, DEF.pouch, ACTOR, { initialState: "absent" }),
    held(E.cloth, DEF.cloth, ACTOR, { quantity: 5 }), held(E.keyA, DEF.key), held(E.keyB, DEF.key), held(E.ropeOwn, DEF.rope),
    ground(E.barrel, DEF.barrel, { initialState: "absent" }), ground(E.keyGround, DEF.key),
    held(E.satchel, DEF.satchel, GIVER, { initialState: "absent" }), held(E.ropeGift, DEF.rope, GIVER)] });
  const w = { f, state: f.state, ordinal: 0 };
  w.inventory = (operation, actor = ACTOR) => {
    const refs = [...new Set([actor, operation.entryRef, operation.containerRef, operation.targetCharacterRef, SCENE].filter(Boolean))];
    const result = f.runtime.step(f.profiles, w.state, { kind: "inventoryOperation", rootActionId: `root:audit:history:${++w.ordinal}`,
      actorCharacterId: actor, plan: { schema: "zhuwei.inventory-operation-plan/vnext-1", contextHash: `sha256:${"c".repeat(64)}`,
        readSet: refs.map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(w.state, ref) })), basisRefs: [SCENE],
        summary: "审计前史。", operation } });
    assert.equal(result.kind, "committed", JSON.stringify(result.rejection ?? result));
    w.state = result.state;
    return result.events.find(event => event.eventType === "InventoryOperationApplied").payload.targetEntryId;
  };
  w.lid = (entryRef, fromState, toState) => {
    w.state = createEventTransition(w.state, f.profiles, { rootActionId: `root:audit:history:${++w.ordinal}`, eventType: "ItemStateTransitioned",
      payload: { actorCharacterId: ACTOR, sceneId: SCENE, entryRef, fromState, toState, intent: toState === "open" ? "open" : "close" },
      visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" }).state;
  };
  // The common history: three cloths into the box, two into the barrel, one
  // key into the pouch; the box is closed.
  E.boxStack = w.inventory({ kind: "store", entryRef: E.cloth, quantity: 3, containerRef: E.box });
  w.inventory({ kind: "store", entryRef: E.cloth, quantity: 2, containerRef: E.barrel });
  E.barrelStack = E.cloth;
  w.inventory({ kind: "store", entryRef: E.keyB, quantity: 1, containerRef: E.pouch });
  w.lid(E.box, "open", "closed");
  w.takeFromBox = () => { w.lid(E.box, "closed", "open"); const piece = w.inventory({ kind: "acquire", entryRef: E.boxStack, quantity: 1 });
    w.lid(E.box, "open", "closed"); return piece; };
  w.takeFromBarrel = () => w.inventory({ kind: "acquire", entryRef: E.barrelStack, quantity: 1 });
  return w;
}

/** How the KP sees each carried or reachable item: frozen in the context,
 * or a row of the carried-item directory it may name (ADR 0132). */
function itemViews(context) {
  const model = proposalModelContext(context);
  const views = new Map();
  for (const entry of model.entries) {
    if (entry.kind !== "known") continue;
    const value = entry.value?.adjudication ?? entry.value;
    if (value?.schema === ITEM_ENTRY_SCHEMA && value.entryId === entry.entryRef) views.set(entry.entryRef, { shown: "frozen",
      containerRef: value.containerRef ?? null, takenFrom: Array.isArray(value.takenFrom) ? value.takenFrom[0] : undefined });
  }
  for (const row of model.references.possessionRecall?.requestable ?? []) views.set(row.ref, { shown: "listed",
    containerRef: row.containerRef ?? null, takenFrom: row.takenFrom });
  return views;
}

/** What tells the referent apart from the same-named alternatives, for the
 * cue the sentence gives. */
const CUES = {
  // "the one I just took out / picked up": a record of how it came to hand,
  // newer than any alternative's.
  recent: (view, others) => view.takenFrom !== undefined && others.every(other => other.takenFrom === undefined
    || BigInt(other.takenFrom.eventSeq) < BigInt(view.takenFrom.eventSeq)),
  // "the one I took from the barrel": that container named as its source.
  source: (view, others, ref) => view.takenFrom?.containerRef === ref && others.every(other => other.takenFrom?.containerRef !== ref),
  // "the one he gave me": the giver named as its source.
  giver: (view, others, ref) => view.receivedFrom?.characterRef === ref && others.every(other => other.receivedFrom?.characterRef !== ref),
  // "the key in the pouch": where it is now.
  location: (view, others, ref) => view.containerRef === ref && others.every(other => other.containerRef !== ref),
};

const SCENARIOS = [
  { id: "taken-from-closed-box", text: "我把刚拿出的那一块放回同一个盒子，再合上盒盖。", cue: "recent",
    play: w => ({ referent: w.takeFromBox(), others: [E.boxStack, E.barrelStack] }) },
  { id: "taken-from-box-named", text: "我把刚从随身木盒里拿出的那块干净布条放回去。", cue: "source", cueRef: () => E.box,
    play: w => ({ referent: w.takeFromBox(), others: [E.boxStack, E.barrelStack] }) },
  { id: "taken-from-open-barrel", text: "我把刚从木桶里拿的那块布条放回木桶。", cue: "source", cueRef: () => E.barrel,
    play: w => ({ referent: w.takeFromBarrel(), others: [E.boxStack, E.barrelStack] }) },
  { id: "taken-from-two-containers", text: "我把从木桶里拿的那块布条放回木桶，盒子里拿的留着。", cue: "source", cueRef: () => E.barrel,
    play: w => { const fromBox = w.takeFromBox(); const fromBarrel = w.takeFromBarrel();
      return { referent: fromBarrel, others: [fromBox, E.boxStack, E.barrelStack] }; } },
  { id: "taken-then-other-acts", text: "我把之前从随身木盒里拿出的那块布条放回去。", cue: "source", cueRef: () => E.box,
    play: w => { const piece = w.takeFromBox(); w.inventory({ kind: "store", entryRef: E.keyA, quantity: 1, containerRef: E.pouch });
      w.inventory({ kind: "acquire", entryRef: E.keyA, quantity: 1 }); return { referent: piece, others: [E.boxStack, E.barrelStack] }; } },
  { id: "picked-up-from-floor", text: "我把刚捡起来的铜钥匙放进布袋。", cue: "recent",
    play: w => ({ referent: w.inventory({ kind: "acquire", entryRef: E.keyGround, quantity: 1 }), others: [E.keyA, E.keyB] }) },
  { id: "handed-over-by-other", text: "我把他刚给我的那段麻绳收进布袋。", cue: "giver", cueRef: () => GIVER,
    play: w => ({ referent: w.inventory({ kind: "transfer", entryRef: E.ropeGift, quantity: 1, targetCharacterRef: ACTOR,
      ownershipDisposition: "transferToRecipient" }, GIVER), others: [E.ropeOwn] }) },
  { id: "in-pouch-control", text: "我把布袋里的铜钥匙拿出来。", cue: "location", cueRef: () => E.pouch,
    play: () => ({ referent: E.keyB, others: [E.keyA] }) },
];

/** Context sufficiency: the sentence's referent reaches the KP, and something
 * the KP is sent tells it apart from the same-named alternatives. */
function contextGaps() {
  const gaps = [];
  for (const scenario of SCENARIOS) {
    const w = world();
    const { referent, others } = scenario.play(w);
    const context = freezeAuthoredProbeContext(w.f, w.state, { rootActionId: `root:audit:context:${scenario.id}`,
      focusRefs: [ACTOR], intentText: scenario.text }).context;
    // Pieces that joined one stack cannot be told apart by anything the KP
    // is sent; the stack has one record.
    if (others.includes(referent)) { gaps.push(`context:${scenario.id}:merged-with-alternative`); continue; }
    const views = itemViews(context);
    const view = views.get(referent);
    if (view === undefined) { gaps.push(`context:${scenario.id}:referent-not-reachable`); continue; }
    const alternatives = others.map(ref => views.get(ref)).filter(other => other !== undefined);
    if (!CUES[scenario.cue](view, alternatives, scenario.cueRef?.())) gaps.push(`context:${scenario.id}:no-fact-for-${scenario.cue}`);
  }
  return gaps;
}

// ---- Forms: what a filling that names the wrong thing is told ----------

const transfer = (direction, containerRef, entryRef, extra = {}) => ({ kind: "containerTransfer", direction, containerRef, entryRef,
  quantity: 1, access: "openNormally", after: "close", ...extra });
/** A filling of inventory steps, with containerTransfer declarations put in
 * as the model writes them (ADR 0131). */
function filling(operations) {
  const document = encodeVNextStrictToolBundle({ mode: "adjudication", basisRefs: [ACTOR], terminal: null,
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "正常取放。", successOutcome: "取放完成。" },
    proposals: operations.map(operation => ({ kind: "inventoryOperation", basisRefs: [ACTOR], consumes: [], produces: [], outcomeBinding: "always",
      operation: operation.direction === undefined ? operation : { kind: "store", entryRef: operation.entryRef, quantity: 1, containerRef: operation.containerRef },
      summary: "按玩家意图取放原物品。" })) });
  operations.forEach((operation, index) => { if (operation.direction !== undefined) document.steps.inventoryOperation[index].operation = structuredClone(operation); });
  return document;
}
const reply = value => ({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ type: "function",
  function: { name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: JSON.stringify(value) } }] } }] });

/** The production path a filling takes: Room reads a listed carried item the
 * filling names (ADR 0133), the form is checked, and an accepted plan is
 * lowered and preflighted by Rules exactly as Room does before any dice. */
function checkFilling(w, frozen, document) {
  const rows = new Set((frozen.references.possessionRecall ?? []).map(row => row.entryRef));
  const named = [...new Set(JSON.stringify(document).match(/item-entry:[^"]+/g) ?? [])].filter(ref => rows.has(ref));
  const context = named.length === 0 ? frozen : withRecalledKnowledge(frozen, recallKnowledge(frozen, named, w.state));
  const candidate = vnextProposalRevisionCandidate(reply(document), ["inventoryOperation"], [], context, []);
  if (candidate.kind !== "accepted") return candidate.diagnostics;
  const rootActionId = context.binding.rootActionId;
  const lowered = VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE.lowerProposal({ proposal: candidate.bundle, preparedActionId: `prepared:${rootActionId}`,
    rootActionId, actorCharacterId: ACTOR, principalId: "principal:probe-actor", requiredContext: context, profiles: w.f.profiles, state: w.state });
  if (lowered.kind === "rejected") return authorityProposalDiagnostics(lowered.diagnostics ?? []);
  const outcome = w.f.runtime.step(w.f.profiles, w.state, lowered.input);
  return outcome.kind === "committed" ? [] : vnextRulesRevisionDiagnostics(outcome, { bundle: candidate.bundle, rulesInput: lowered.input });
}
const at = (document, path) => path.reduce((value, key) => value?.[key], document);
const put = (document, path, value) => { const copy = structuredClone(document); at(copy, path.slice(0, -1))[path.at(-1)] = value; return copy; };
const field = diagnostic => (diagnostic.path ?? []).filter(part => typeof part === "string").at(-1);

/** One wrong thing each, on the world after the actor took one cloth out of
 * the closed box. `field` is what is wrong and `fix` a value that makes the
 * filling pass; `offers` marks a wrong choice of reference, where the
 * diagnostic should offer the references that would do. Storing a key from
 * the floor straight into one's pouch is allowed, so it is no fault here. */
const FAULTS = [
  { id: "put-back-the-stack-left-inside", ops: () => [transfer("putIn", E.box, E.boxStack)], field: "entryRef", fix: s => s.loose, offers: true },
  { id: "put-the-box-into-itself", ops: () => [transfer("putIn", E.box, E.box)], field: "entryRef", fix: s => s.loose, offers: true },
  { id: "put-in-closed-box-declared-open", ops: s => [transfer("putIn", E.box, s.loose, { access: "alreadyOpen" })], field: "access", fix: () => "openNormally" },
  { id: "put-in-with-kind-dropped", ops: s => [(({ kind: _kind, ...rest }) => rest)(transfer("putIn", E.box, s.loose))], field: "kind", fix: () => "containerTransfer" },
  { id: "store-into-closed-box", ops: s => [{ kind: "store", entryRef: s.loose, quantity: 1, containerRef: E.box }], field: "containerRef", fix: () => E.pouch },
  { id: "store-into-other-holders-satchel", ops: s => [{ kind: "store", entryRef: s.loose, quantity: 1, containerRef: E.satchel }], field: "containerRef", fix: () => E.pouch },
  { id: "store-what-another-holds", ops: () => [{ kind: "store", entryRef: E.ropeGift, quantity: 1, containerRef: E.pouch }], field: "entryRef", fix: () => E.keyA, offers: true },
  { id: "take-out-of-the-wrong-container", ops: () => [transfer("takeOut", E.pouch, E.boxStack, { after: "leaveAsIs" })], field: "entryRef", fix: () => E.keyB, offers: true },
  { id: "take-what-another-holds", ops: () => [{ kind: "acquire", entryRef: E.ropeGift, quantity: 1 }], field: "entryRef", fix: () => E.keyGround },
  { id: "give-what-lies-on-the-floor", ops: () => [{ kind: "transfer", entryRef: E.keyGround, quantity: 1, targetCharacterRef: GIVER,
    ownershipDisposition: "transferToRecipient" }], field: "entryRef", fix: () => E.keyA, offers: true },
  { id: "drop-what-is-in-the-box", ops: () => [{ kind: "release", entryRef: E.boxStack, quantity: 1, sceneRef: SCENE, releaseKind: "drop" }],
    field: "entryRef", fix: () => E.keyA },
];
/** Faults on different things, filled together. */
const COMBINED = [["put-back-the-stack-left-inside", "store-what-another-holds"], ["put-the-box-into-itself", "take-out-of-the-wrong-container"],
  ["store-into-other-holders-satchel", "take-what-another-holds"], ["store-into-closed-box", "drop-what-is-in-the-box"]];

function formGaps() {
  const w = world();
  const s = { loose: w.takeFromBox() };
  const name = ref => Object.entries(E).find(([, value]) => value === ref)?.[0] ?? (ref === s.loose ? "loosePiece" : ref);
  // The freeze of a put-back that names the box; the rest of what the
  // fillings name is frozen with it so each filling meets only its fault.
  const frozen = freezeAuthoredProbeContext(w.f, w.state, { rootActionId: "root:audit:forms", intentText: "我把刚拿出的那一块放回同一个盒子，再合上盒盖。",
    focusRefs: [ACTOR, GIVER, E.box, E.boxStack, E.pouch, E.keyB, E.satchel, E.barrel, E.keyGround, E.ropeGift, E.keyA, s.loose] }).context;
  const gaps = [], results = new Map();
  for (const fault of FAULTS) {
    const document = filling(fault.ops(s));
    const diagnostics = checkFilling(w, frozen, document);
    results.set(fault.id, diagnostics);
    // Location: the fault is refused, at the field that is wrong, and
    // correcting that field alone passes.
    if (diagnostics.length === 0) { gaps.push(`location:${fault.id}:not-refused`); continue; }
    if (!diagnostics.some(diagnostic => field(diagnostic) === fault.field))
      gaps.push(`location:${fault.id}:points-at-${[...new Set(diagnostics.map(field))].join("+")}`);
    const fixed = checkFilling(w, frozen, put(document, ["steps", "inventoryOperation", 0, "operation", fault.field], fault.fix(s)));
    if (fixed.length > 0) gaps.push(`location:${fault.id}:fix-still-refused:${[...new Set(fixed.map(d => d.constraint))].join("+")}`);
    // Candidates: a wrong reference is answered with the ones that would do,
    // and every value a diagnostic offers for a field clears that field.
    if (fault.offers && !diagnostics.some(diagnostic => field(diagnostic) === fault.field && (diagnostic.expected?.enum ?? []).length > 0))
      gaps.push(`candidates:${fault.id}:none-offered`);
    for (const diagnostic of diagnostics) {
      const offered = [...new Set([...(diagnostic.expected?.enum ?? []), ...(diagnostic.expected?.sameName ?? [])])];
      if (offered.length === 0 || diagnostic.pathBase !== "arguments") continue;
      for (const candidate of offered) {
        const after = checkFilling(w, frozen, put(document, diagnostic.path, candidate));
        const left = after.filter(other => JSON.stringify(other.path) === JSON.stringify(diagnostic.path));
        if (left.length > 0) gaps.push(`candidates:${fault.id}:${diagnostic.constraint}:${name(candidate)}-still-refused:${[...new Set(left.map(d => d.constraint))].join("+")}`);
      }
    }
  }
  // One round: faults filled together are each reported.
  for (const ids of COMBINED) {
    const document = filling(ids.flatMap(id => FAULTS.find(fault => fault.id === id).ops(s)));
    const reported = new Set(checkFilling(w, frozen, document).map(diagnostic => diagnostic.constraint));
    const missing = [...new Set(ids.flatMap(id => results.get(id).map(diagnostic => diagnostic.constraint)))].filter(constraint => !reported.has(constraint));
    if (missing.length > 0) gaps.push(`one-round:${ids.join("+")}:missing-${missing.join("+")}`);
  }
  return gaps;
}

// SPEC 0001 §16, SPEC 0016 §4.3: the referent of a sentence reaches the KP
// with a fact that tells it from same-named items, for each way it came to hand.
test("the context tells the referent apart for each way an item came to hand, except the known gaps", () => {
  assertGaps(contextGaps(), ["context"]);
});

// SPEC 0016 §7.2: a revision is told every problem, where it is, and with
// only candidates that clear it.
test("a wrong filling is refused at its field, offers only candidates that clear it, and reports every fault at once, except the known gaps", () => {
  assertGaps(formGaps(), ["location", "candidates", "one-round"]);
});
