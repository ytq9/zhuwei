// Behavior assertions grouped by function; see README.md in this directory.
/**
 * Gate for SPEC 0016 §8.3: continuity review reports contradicting facts
 * instead of building a per-fragment evidence matrix.
 *
 * A passing review carries no per-fragment or per-fact proof; completeness is
 * checked once per committed mechanical group; a zero-mechanical review omits
 * resultChecks entirely, which is also the shape the real provider accepts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { frozenNarrationContextConform } from "../../../app/_runtime/lib/kp/narration-context.ts";
import { roomNarrationContext } from "../../../app/_runtime/lib/room/narration-context.ts";
import { frozenNarrationReviewContext, naturalNarrationContext, decodeNarrationReview } from "../../../app/_runtime/lib/kp/narration-vnext.ts";
import { actor, viewer, requestFor, transfer, problem } from '../../support/fixtures/narration.mjs';


test('a wait freezes same-scene heard dialogue in fiction order without treating raw player requests as heard speech', () => {
  const request = requestFor([{ kind: 'mechanicalOutcome', targetRefs: [viewer], outcomeCode: 'timePassageCompleted', summary: '等待已结束，实际经过 60 秒，原计划为 60 秒。' }]);
  const projection = { viewer: { kind: 'player', subjectId: viewer }, controlledCharacter: { name: '药师', sceneId: 'scene:hall' }, entities: {},
    publicExpression: { scene: { name: '厅堂', tone: '克制' }, characters: [] }, visibleFacts: [],
    activities: [{ kind: 'timePassage', activityId: 'activity:wait', characterId: viewer, status: 'completed', startedAtFictionMicros: '2000000000', endedAtFictionMicros: '2060000000' }],
    conversationThreads: [
      { threadRef: 'thread:hall', sourceSceneId: 'scene:hall', claimRef: 'source:ask', responseClaimRef: 'source:reply' },
      { threadRef: 'thread:old', sourceSceneId: 'scene:hall', claimRef: 'source:old', responseClaimRef: null },
      { threadRef: 'thread:later', sourceSceneId: 'scene:hall', claimRef: 'source:after', responseClaimRef: null },
      { threadRef: 'thread:elsewhere', sourceSceneId: 'scene:gate', claimRef: 'source:gate', responseClaimRef: null }],
    sourceClaims: [
      { claimId: 'source:reply', speakerId: 'npc:a', semanticContent: '半分钟到了我敲两下。', acquiredAtFictionMicros: '1999000000', motive: 'PRIVATE_MOTIVE' },
      { claimId: 'source:ask', speakerId: viewer, semanticContent: '给我半分钟。', acquiredAtFictionMicros: '1999000000' },
      { claimId: 'source:old', speakerId: 'npc:a', semanticContent: 'STALE_LINE', acquiredAtFictionMicros: '100000000' },
      { claimId: 'source:gate', speakerId: 'npc:a', semanticContent: 'OTHER_SCENE_LINE', acquiredAtFictionMicros: '2000000000' },
      { claimId: 'source:after', speakerId: 'npc:a', semanticContent: 'FUTURE_LINE', acquiredAtFictionMicros: '2070000000' }] };
  const frozen = roomNarrationContext({ claims: request.renderableClaims, projection, actorCharacterId: viewer, experiencedTranscript: { messages: [
    { kind: 'player', body: '我等半分钟。', speakerName: '药师', speakerCharacterId: viewer },
    { kind: 'kp', body: 'UNRELATED_OPENING', speakerName: 'KP', speakerCharacterId: null },
    { kind: 'player', body: 'OTHER_PLAYER_LINE', speakerName: '远行者', speakerCharacterId: actor }] } });
  assert.deepEqual(frozen.expression.recentDialogue.map(entry => [entry.kind, entry.body]),
    [['player', '给我半分钟。'], ['npc', '半分钟到了我敲两下。']]);
  assert.deepEqual(frozen.expression.recentDialogue[0].source,
    { kind: 'sourceClaim', claimRef: 'source:ask', acquiredAtFictionMicros: '1999000000' });
  assert.doesNotMatch(JSON.stringify(frozen), /STALE_LINE|OTHER_SCENE_LINE|FUTURE_LINE|UNRELATED_OPENING|OTHER_PLAYER_LINE|PRIVATE_/);
  assert.ok(frozenNarrationContextConform(JSON.parse(JSON.stringify(frozen)), request.renderableClaims));
  // Without a wait, the same projection lends no dialogue to an unrelated result.
  const plain = roomNarrationContext({ claims: transfer().renderableClaims, projection, actorCharacterId: actor, experiencedTranscript: { messages: [] } });
  assert.deepEqual(plain.expression.recentDialogue, []);
});


test('SPEC 0016 §8.3: a previous raw action cannot become dialogue or proof of a new result just because its actor speaks again', () => {
  const request = requestFor([{ kind: 'sourceClaim', speakerRef: actor, statement: '你父亲现在情况如何？' }], true);
  const projection = { viewer: { kind: 'player', subjectId: actor }, controlledCharacter: { name: '远行者', sceneId: 'hall' },
    entities: {}, publicExpression: { scene: null, characters: [] }, visibleFacts: [], sourceClaims: [], conversationThreads: [] };
  for (const body of ['我拿起一根蜡烛。', '我把门闩插好。']) {
    const context = roomNarrationContext({ claims: request.renderableClaims, projection, actorCharacterId: actor,
      experiencedTranscript: { messages: [{ kind: 'player', body, speakerName: '远行者', speakerCharacterId: actor,
        messageId: 'action:old', receiptId: 'receipt:old', sourceEventSeq: '1' }] } });
    assert.equal(context.expression.actorIntent, null);
    assert.deepEqual(context.expression.recentDialogue, []);
    assert.doesNotMatch(JSON.stringify(context), /蜡烛|门闩/);
  }
});


test('SPEC 0016 §8.3: frozen intent and heard-history origins survive recovery and bind the same generation and review materials', () => {
  const request = requestFor([{ kind: 'sourceClaim', speakerRef: 'npc:a', statement: '我会在这里等你。' }], true);
  const origin = { rootActionId: 'root:original', receiptId: 'receipt:original', messageId: 'action:original',
    sourceEventSeq: '10', inputKind: 'intent', activityId: 'activity:original' };
  const projection = { viewer: { kind: 'player', subjectId: actor }, controlledCharacter: { name: '远行者', sceneId: 'hall' },
    entities: {}, publicExpression: { scene: null, characters: [] }, visibleFacts: [], sourceClaims: [], conversationThreads: [] };
  request.narrationContext = roomNarrationContext({ claims: request.renderableClaims, projection, actorCharacterId: actor,
    actorIntent: { characterId: actor, body: '请在这里等我。', origin }, experiencedTranscript: { messages: [{
      kind: 'npc', body: '我刚才在桥边。', speakerName: '林', speakerCharacterId: 'npc:a',
      messageId: 'message:history', receiptId: 'receipt:history', sourceEventSeq: '8' }] } });
  const generation = naturalNarrationContext(request), review = frozenNarrationReviewContext(request, '林答应在这里等你。');
  for (const key of ['currentResult', 'facts', 'payloads', 'expression']) assert.deepEqual(review[key], generation[key]);
  assert.deepEqual(generation.expression.actorIntentOrigin, origin);
  assert.deepEqual(generation.expression.recentDialogue[0].source,
    { kind: 'experiencedMessage', messageId: 'message:history', receiptId: 'receipt:history', sourceEventSeq: '8' });
  assert.ok(review.constraintRefs.includes('/expression/recentDialogue/0'));
  const restored = JSON.parse(JSON.stringify(request.narrationContext));
  assert.ok(frozenNarrationContextConform(restored, request.renderableClaims));
  const oldVersion = structuredClone(restored); oldVersion.schema = 'zhuwei.frozen-narration-context/v1';
  assert.equal(frozenNarrationContextConform(oldVersion, request.renderableClaims), false, 'old frozen bytes require their own interpreter');
  const body = '林刚刚在桥边。';
  const report = problem(request, body, 'FACT_CONFLICT', 'continuity', '/expression/recentDialogue/0');
  assert.throws(() => decodeNarrationReview(report, request, body), error => error.reason === 'continuityMismatch');
});
