import assert from "node:assert/strict";
import test from "node:test";
import { prepareExport, prepareHistoricalBranch } from "../app/_runtime/lib/room/story-history/index.ts";
import { archiveSha256, buildAuthoritativeArchive } from "../app/_runtime/lib/room/archive.ts";
import { ACTOR, ARCHIVIST, BOATMAN, ACCESS, HARBOR, LIBRARY, at, createHistoryFixture, historyHost } from "./fixtures/story-history.mjs";

const denial = code => ({ kind: "rejected", code });
async function prepared(fixture, changes) {
  const adapter = historyHost(fixture, changes);
  return { ...adapter, result: await prepareHistoricalBranch(fixture.request, adapter.host) };
}
async function rehashMaterial(material) {
  material.preparationHash = await archiveSha256(material.preparation);
}

for (const variant of ["boat", "archive"]) test(`${variant}: an exact historical prefix retains both places and only eligible late memories`, async () => {
  const fixture = await createHistoryFixture(variant);
  const original = structuredClone({ state: fixture.state, archive: fixture.archive, preparations: fixture.preparations });
  const { result, calls } = await prepared(fixture);
  assert.equal(result.kind, "branchPrepared", JSON.stringify(result));
  const { seed } = result;
  assert.deepEqual(seed.cutState, fixture.cutState);
  assert.equal(seed.cutState.entities[ACTOR].kind, "player");
  assert.equal(seed.cutState.entities[BOATMAN].name, "原有船夫");
  assert.equal(seed.identity.kind, "newCharacter");
  assert.equal(seed.cutState.entities[seed.identity.characterId], undefined, "new identity is not spliced into source authority");
  assert.doesNotMatch(JSON.stringify(seed.identity), /ORIGINAL-CHARACTER-PRIVATE|ORIGINAL-FUTURE-OUTCOME|controllerPrincipal|seat:/);
  assert.equal(seed.prefixEvents.length, Number(fixture.cutSeq));
  assert.doesNotMatch(JSON.stringify(seed.prefixEvents), /ORIGINAL-FUTURE-OUTCOME/);
  assert.equal(seed.preparations.length, 0, "a later manuscript is not copied into historical hosting context");
  assert.equal(seed.lateFacts.length, 1);
  assert.equal(seed.lateFacts[0].candidate.layer, variant === "archive" ? "statement" : "worldTruth");
  assert.equal(seed.lateFacts[0].candidate.knowledge, undefined, "future knowledge candidates are not smuggled inside the fact body");
  assert.deepEqual(seed.lateFacts[0].knowledge.map(entry => entry.record.characterId), [BOATMAN]);
  assert.equal(seed.lateFacts[0].knowledge[0].candidate.acquisition.start.micros, "80");
  assert.ok(BigInt(seed.lateFacts[0].recordedBy.eventSeq) > BigInt(fixture.cutSeq));
  assert.equal(seed.verification.lateFactsRequireSourceArchive, true);
  assert.notEqual(seed.verification.cutVerificationHash, seed.verification.identityVerificationHash);
  const harbor = fixture.cutState.multiplayerRuntime.characterTimelineIds[BOATMAN];
  const library = fixture.cutState.multiplayerRuntime.characterTimelineIds[ARCHIVIST];
  assert.equal(seed.cut.timelines.find(point => point.timelineId === harbor).micros, "300");
  assert.equal(seed.cut.timelines.find(point => point.timelineId === library).micros, "150");
  const { seedHash, ...unsigned } = seed;
  assert.equal(seedHash, await archiveSha256(unsigned));
  assert.equal(fixture.runtime.replay(seed.sourceGenesis, seed.prefixEvents).kind, "replayed");
  assert.deepEqual(calls, { source: 1, viewer: 0, cut: 1, identity: 1 });
  assert.deepEqual({ state: fixture.state, archive: fixture.archive, preparations: fixture.preparations }, original);
});

test("preparation is repeatable and host callbacks cannot mutate the frozen cut or source", async () => {
  const fixture = await createHistoryFixture();
  const first = await prepared(fixture);
  const normal = historyHost(fixture).host;
  const second = await prepared(fixture, { async validateHistoricalCut(input) {
    const response = await normal.validateHistoricalCut(input);
    input.value.cutState.entities[ACTOR].name = "HOST-MUTATION";
    input.value.request.identity.character.name = "HOST-MUTATION";
    return response;
  } });
  assert.equal(first.result.kind, "branchPrepared");
  assert.deepEqual(second.result, first.result);
  assert.equal(fixture.state.entities[ACTOR].name, "原团主角");
});

test("viewer export uses only the trusted projection and retained own transcript, with no system read", async () => {
  const fixture = await createHistoryFixture();
  const { host, calls } = historyHost(fixture);
  const request = { kind: "viewer", access: ACCESS, source: fixture.source, characterId: ACTOR, cursor: null };
  const result = await prepareExport(request, host);
  assert.equal(result.kind, "viewerExportPrepared", JSON.stringify(result));
  assert.deepEqual(calls, { source: 0, viewer: 1, cut: 0, identity: 0 });
  assert.equal(result.record.transcript[0].body, "ONLY-EXPERIENCED-TEXT");
  assert.doesNotMatch(JSON.stringify(result.record), /ORIGINAL-FUTURE-OUTCOME|zhuwei.story-preparation|candidate:history|亲历证据/);
  const { contentHash, ...unsigned } = result.record;
  assert.equal(contentHash, await archiveSha256(unsigned));
  for (const change of [{ characterId: ARCHIVIST }, { access: { ...ACCESS, principalId: "principal:unknown" } }, { access: { ...ACCESS, authorizationVersion: "6" } }]) {
    assert.deepEqual(await prepareExport({ ...request, ...change }, host), denial("STORY_HISTORY_SOURCE_UNAVAILABLE"));
  }
  assert.equal(calls.source, 0);
});

test("viewer export preserves the actual roll transcript DTO and rejects undeclared private fields", async () => {
  const fixture = await createHistoryFixture(), base = historyHost(fixture).host;
  const request = { kind: "viewer", access: ACCESS, source: fixture.source, characterId: ACTOR, cursor: null };
  const { host, calls } = historyHost(fixture, { async readViewerExport(input) {
    const response = await base.readViewerExport(input);
    response.value.transcript.push({ ...response.value.transcript[0], ordinal: 2, messageId: "message:roll:2",
      kind: "roll", speakerCharacterId: ACTOR, speakerName: "原团主角", body: "调查检定：14，成功。" });
    return response;
  } });
  const result = await prepareExport(request, host);
  assert.equal(result.kind, "viewerExportPrepared", JSON.stringify(result));
  assert.deepEqual(result.record.transcript.map(message => message.kind), ["kp", "roll"]);
  assert.equal(result.record.transcript[1].body, "调查检定：14，成功。");
  assert.equal(calls.source, 0);
  assert.deepEqual(await prepareExport(request, { ...host, async readViewerExport(input) {
    const response = await host.readViewerExport(input);
    response.value.transcript[1].privateAdjudication = "PRIVATE-ROLL-SECRET";
    return response;
  } }), denial("STORY_HISTORY_BINDING_INVALID"));
});

test("an earlier preparation retains only each fact and knowledge mapping actually admitted by the cut", async () => {
  const fixture = await createHistoryFixture(), material = fixture.preparations[0], original = material.facts[0];
  const factEvent = fixture.events.find(event => event.eventId === original.recordedByEventId);
  material.recordedAtEventSeq = fixture.state.receipts[factEvent.rootActionId].eventRange.toEventSeq;
  const firstKnowledgeEvent = fixture.events.find(event => event.eventId === original.knowledge[0].recordedByEventId);
  fixture.cutSeq = fixture.state.receipts[firstKnowledgeEvent.rootActionId].eventRange.toEventSeq;
  fixture.cutState = fixture.runtime.replay(fixture.genesis, fixture.events.slice(0, Number(fixture.cutSeq))).state;
  fixture.request.cut.eventSeq = fixture.cutSeq;
  const future = fixture.state.canonicalFacts["fact:history:future"], futureEvent = fixture.events.find(event => event.eventSeq === future.validFromEventSeq);
  material.preparation.facts.push({ ...structuredClone(material.preparation.facts[0]), ref: "candidate:future",
    content: future.value, occurrence: at(material.preparation.facts[0].occurrence.start.timelineId, "301"), knowledge: [] });
  material.facts.push({ candidateRef: "candidate:future", factRef: future.id, recordedByEventId: futureEvent.eventId,
    definitionRefs: [], knowledge: [] });
  await rehashMaterial(material);
  const { result } = await prepared(fixture);
  assert.equal(result.kind, "branchPrepared", JSON.stringify(result));
  assert.equal(result.seed.preparations.length, 1);
  assert.deepEqual(result.seed.preparations[0].facts, [{ ...original, knowledge: [original.knowledge[0]] }]);
  assert.deepEqual(result.seed.preparations[0].definitions, []);
  assert.deepEqual(result.seed.lateFacts, []);
  assert.equal(material.facts.length, 2, "source remains unchanged");
  assert.equal(material.facts[0].knowledge.length, 2);
});

test("system export preserves the exact source and manuscript closure in a service-only envelope", async () => {
  const fixture = await createHistoryFixture();
  const { host } = historyHost(fixture);
  const result = await prepareExport({ kind: "system", access: ACCESS, source: fixture.source }, host);
  assert.equal(result.kind, "systemExportPrepared", JSON.stringify(result));
  assert.equal(result.record.audience, "trustedSystemOnly");
  assert.deepEqual(result.record.archive, fixture.archive);
  assert.deepEqual(result.record.preparations, fixture.preparations);
  const { contentHash, ...unsigned } = result.record;
  assert.equal(contentHash, await archiveSha256(unsigned));
});

test("archive corruption and unknown exact profiles reject before any host cut attestation", async () => {
  for (const mode of ["gap", "profile", "head"]) {
    const fixture = await createHistoryFixture();
    const base = historyHost(fixture).host;
    const { result, calls } = await prepared(fixture, { async readSource(input) {
      const response = await base.readSource(input);
      if (mode === "gap") response.value.archive.events.splice(1, 1);
      if (mode === "profile") response.value.archive.signedGenesis.profiles.manifest.profileHash = `sha256:${"f".repeat(64)}`;
      if (mode === "head") response.value.archive.head.stateHash = `sha256:${"f".repeat(64)}`;
      return response;
    } });
    assert.deepEqual(result, denial(mode === "profile" ? "STORY_HISTORY_PROFILE_UNSUPPORTED" : "STORY_HISTORY_ARCHIVE_INVALID"));
    assert.equal(calls.cut, 0); assert.equal(calls.identity, 0);
  }
});

test("missing manuscripts, changed manuscript bytes and forged fact bindings fail closed", async () => {
  for (const mode of ["missing", "changed", "binding", "extraField"]) {
    const fixture = await createHistoryFixture();
    const base = historyHost(fixture).host;
    const { result, calls } = await prepared(fixture, { async readSource(input) {
      const response = await base.readSource(input);
      if (mode === "missing") response.value.preparations = [];
      if (mode === "changed") response.value.preparations[0].preparation.cause = "replaced";
      if (mode === "binding") response.value.preparations[0].facts[0].recordedByEventId = fixture.events.at(-1).eventId;
      if (mode === "extraField") {
        response.value.preparations[0].preparation.facts[0].controlGrant = "forged";
        await rehashMaterial(response.value.preparations[0]);
        response.value.requiredPreparationHashes = [response.value.preparations[0].preparationHash];
      }
      return response;
    } });
    assert.deepEqual(result, denial(mode === "binding" ? "STORY_HISTORY_BINDING_INVALID" : "STORY_HISTORY_MATERIALS_MISSING"));
    assert.equal(calls.cut, 0);
  }
});

test("knowledge bindings cannot substitute another holder, fact, layer or source before historical filtering", async () => {
  for (const mode of ["holder", "recordFact", "candidateFact", "layer", "source"]) {
    const fixture = await createHistoryFixture();
    const material = fixture.preparations[0], binding = material.facts[0];
    const candidate = material.preparation.facts[0].knowledge[0];
    if (mode === "holder") {
      binding.knowledge = [{ ...binding.knowledge[1], candidateRef: binding.knowledge[0].candidateRef }];
    } else if (mode === "recordFact") {
      fixture.run({ kind: "acquireSensoryEvidence", proposalId: "root:history:future-knowledge",
        characterId: BOATMAN, factId: "fact:history:future", sense: "hearing", clarity: "obvious",
        publicEvidence: "FUTURE-KNOWLEDGE-CANARY" });
      const record = fixture.state.knowledge[BOATMAN]["fact:history:future"];
      binding.knowledge = [{ candidateRef: candidate.ref, holderRef: BOATMAN,
        knowledgeRef: record.knowledgeRef, recordedByEventId: record.acquiredByEventId }];
      fixture.archive = await buildAuthoritativeArchive({ roomId: fixture.state.roomId, signedGenesis: fixture.genesis,
        events: fixture.events, receiptRefs: [], projectionAudits: [] });
      fixture.request.source = { ...fixture.source, archiveHash: fixture.archive.archiveHash };
    } else {
      if (mode === "candidateFact") candidate.factRef = "candidate:another-fact";
      if (mode === "layer") candidate.layer = "truth";
      if (mode === "source") candidate.sourceRef = "fact:history:future";
      await rehashMaterial(material);
    }
    const { result, calls } = await prepared(fixture);
    assert.equal(result.kind, "rejected", mode);
    assert.equal(result.code, "STORY_HISTORY_BINDING_INVALID", mode);
    assert.equal(calls.cut, 0, mode);
    assert.equal(calls.identity, 0, mode);
    assert.doesNotMatch(JSON.stringify(result), /FUTURE-KNOWLEDGE-CANARY/);
  }
});

test("ambiguous occurrence bounds, unknown timelines and uncomparable acquisitions never guess a date", async () => {
  for (const mode of ["range", "before", "timeline", "knowledge"]) {
    const fixture = await createHistoryFixture();
    const fact = fixture.preparations[0].preparation.facts[0];
    const timelineId = fact.occurrence.start.timelineId;
    if (mode === "range") fact.occurrence = { kind: "between", start: { timelineId, micros: "250" }, end: { timelineId, micros: "350" }, basisRefs: ["fact:history:origin"] };
    if (mode === "before") fact.occurrence = { kind: "before", start: { timelineId, micros: "350" }, end: null, basisRefs: ["fact:history:origin"] };
    if (mode === "timeline") fact.occurrence = at("timeline:missing", "20");
    if (mode === "knowledge") fact.knowledge[0].acquisition = at("timeline:missing", "20");
    await rehashMaterial(fixture.preparations[0]);
    const { result, calls } = await prepared(fixture);
    assert.deepEqual(result, denial("STORY_HISTORY_TIME_UNRESOLVED"));
    assert.equal(calls.cut, 0);
  }
});

test("an explicitly earlier bound is eligible while an explicitly future occurrence is excluded", async () => {
  const fixture = await createHistoryFixture();
  const fact = fixture.preparations[0].preparation.facts[0];
  fact.occurrence = { kind: "before", start: { ...fact.occurrence.start, micros: "100" }, end: null, basisRefs: ["fact:history:origin"] };
  await rehashMaterial(fixture.preparations[0]);
  const earlier = await prepared(fixture);
  assert.equal(earlier.result.kind, "branchPrepared");
  assert.equal(earlier.result.seed.lateFacts.length, 1);
  fact.occurrence = at(fact.occurrence.start.timelineId, "301");
  await rehashMaterial(fixture.preparations[0]);
  const later = await prepared(fixture);
  assert.equal(later.result.kind, "branchPrepared");
  assert.deepEqual(later.result.seed.lateFacts, []);
  assert.equal(later.result.seed.verification.lateFactsRequireSourceArchive, false);
});

test("pending player choices remain in source authority and make that historical cut unsupported", async () => {
  const fixture = await createHistoryFixture();
  fixture.run({ kind: "resolveImprovisedAction", rootActionId: "root:history:pending", actorCharacterId: ACTOR,
    ruling: { kind: "clarification", pendingInputId: "pending:history", question: "检查左边还是右边？" } });
  fixture.archive = await buildAuthoritativeArchive({ roomId: fixture.state.roomId, signedGenesis: fixture.genesis, events: fixture.events, receiptRefs: [], projectionAudits: [] });
  fixture.request.source = { ...fixture.source, archiveHash: fixture.archive.archiveHash };
  fixture.request.cut.eventSeq = fixture.state.version;
  const { result, calls } = await prepared(fixture);
  assert.deepEqual(result, denial("STORY_HISTORY_CUT_UNSUPPORTED"));
  assert.equal(calls.cut, 0);
  assert.ok(fixture.state.pendingInputs["pending:history"]);
});

test("host attestation must bind authorization and exact cut; a bare true cannot approve it", async () => {
  for (const response of [true, { kind: "verified", authorizationBindingHash: `sha256:${"0".repeat(64)}`, verificationHash: `sha256:${"0".repeat(64)}` }]) {
    const fixture = await createHistoryFixture();
    const { result, calls } = await prepared(fixture, { async validateHistoricalCut() { return response; } });
    assert.deepEqual(result, denial("STORY_HISTORY_BINDING_INVALID"));
    assert.equal(calls.identity, 0);
  }
  const fixture = await createHistoryFixture();
  const denied = await prepared(fixture, { async validateHistoricalCut() { return denial("STORY_HISTORY_CUT_UNSUPPORTED"); } });
  assert.deepEqual(denied.result, denial("STORY_HISTORY_CUT_UNSUPPORTED"), "the trusted host can reject unsupported correction/causal closure");
  assert.equal(denied.calls.identity, 0);
});

test("new identity rejects existing entity IDs, copied identities, unique possessions and implicit takeover", async () => {
  for (const mode of ["sameId", "copy", "unique", "takeover"]) {
    const fixture = await createHistoryFixture();
    if (mode === "sameId") fixture.request.identity.characterId = BOATMAN;
    if (mode === "copy") fixture.request.identity.character.copyOf = BOATMAN;
    if (mode === "unique") fixture.request.identity.character.uniqueItemRef = "item:existing-unique";
    if (mode === "takeover") fixture.request.identity = { kind: "existingCharacter", characterId: BOATMAN };
    const { result } = await prepared(fixture);
    assert.deepEqual(result, denial(mode === "takeover" ? "STORY_HISTORY_IDENTITY_UNSUPPORTED" : "STORY_HISTORY_IDENTITY_CONFLICT"));
    assert.equal(fixture.state.entities[ACTOR].kind, "player");
    assert.equal(fixture.state.entities[BOATMAN].kind, "npc");
  }
});

test("source access and technical failure remain explicit and disclose no private diagnostics", async () => {
  const fixture = await createHistoryFixture();
  fixture.request.access = { ...ACCESS, authorizationVersion: "old" };
  assert.deepEqual((await prepared(fixture)).result, denial("STORY_HISTORY_SOURCE_UNAVAILABLE"));
  fixture.request.access = ACCESS;
  const failed = await prepared(fixture, { async readSource() { throw new Error("PRIVATE-SOURCE-DIAGNOSTIC"); } });
  assert.deepEqual(failed.result, denial("STORY_HISTORY_UNAVAILABLE"));
  assert.doesNotMatch(JSON.stringify(failed.result), /PRIVATE/);
});
