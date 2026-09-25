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
import { createAuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative.ts";
import { deriveAuthorityClaims, projectRenderableClaims } from "../../../app/_runtime/lib/rules/v2/claims.ts";
import { freezeNarrationContext, frozenNarrationContextConform } from "../../../app/_runtime/lib/kp/narration-context.ts";
import { roomNarrationContext } from "../../../app/_runtime/lib/room/narration-context.ts";
import { deepSeekRequestBody } from "../../../app/_runtime/lib/kp/deepseek.ts";
import { conservativeInputTokens } from "../../../app/_runtime/lib/kp/vnext/invocation/budget.ts";
import { frozenNarrationReviewContext, narrationReviewModelInput, naturalNarrationModelInput } from "../../../app/_runtime/lib/kp/narration-vnext.ts";
import { actor, viewer, basis, requestFor, transfer, reviewFor, response } from '../../support/fixtures/narration.mjs';


test('Room freezes only authorized relevant expression, linked heard dialogue, historical details and own intent', () => {
  const request = requestFor([{ kind: 'sourceClaim', speakerRef: 'npc:a', statement: '门后没有人。', basis: { authorityRefs: [], viewerRefs: ['source:current'] } }]);
  const claims = request.renderableClaims;
  const projection = { viewer: { kind: 'player', subjectId: viewer }, controlledCharacter: { name: '药师', sceneId: 'scene:hall' },
    entities: {}, publicExpression: { scene: { name: '厅堂', tone: '克制' }, characters: structuredClone(request.narrationContext.expression.characters) },
    visibleFacts: [{ id: 'detail:chair', kind: 'narrativeCommitment', value: { sceneRef: 'scene:hall', description: '椅子曾在窗边。' } }],
    sourceClaims: [{ claimId: 'source:current', speakerId: 'npc:a', semanticContent: '我先前没有见到人。', motive: 'PRIVATE_MOTIVE', sourceBasis: 'PRIVATE_BASIS' },
      { claimId: 'source:unrelated', speakerId: 'npc:a', semanticContent: 'UNRELATED_HISTORY' }], conversationThreads: [] };
  // Rebuild claims with the one explicit source grant.
  const granted = projectRenderableClaims(deriveAuthorityClaims({ receiptId: claims.receiptId, rootActionId: claims.rootActionId,
    materials: [{ claimRef: 'claim:source', kind: 'sourceClaim', speakerRef: 'npc:a', statement: '门后没有人。',
      basis: { authorityRefs: [], viewerRefs: ['source:current'] }, visibility: { kind: 'public' } }] }),
    { viewerKey: claims.viewerKey, refs: ['npc:a', 'source:current'], displayNames: { 'npc:a': '林' } });
  const frozen = roomNarrationContext({ claims: granted, projection, actorCharacterId: actor,
    actorIntent: { characterId: actor, body: 'OTHER_PLAYER_SECRET', origin: { rootActionId: claims.rootActionId, receiptId: claims.receiptId,
      messageId: 'action:other', sourceEventSeq: '1', inputKind: 'intent', activityId: null } }, experiencedTranscript: { messages: [{ kind: 'kp', body: 'UNRELATED_OPENING', speakerName: 'KP', speakerCharacterId: null }] } });
  assert.equal(frozen.expression.actor, null); assert.equal(frozen.expression.actorIntent, null);
  assert.deepEqual(frozen.expression.characters.map(c => c.characterRef), ['npc:a']);
  assert.equal(frozen.expression.recentDialogue[0].speakerRef, 'npc:a');
  assert.equal(frozen.expression.establishedDetails[0].description, '椅子曾在窗边。');
  assert.doesNotMatch(JSON.stringify(frozen), /PRIVATE_|UNRELATED_HISTORY|UNRELATED_OPENING|OTHER_PLAYER_SECRET/);
  const restored = JSON.parse(JSON.stringify(frozen)); assert.ok(frozenNarrationContextConform(restored, granted));
  projection.publicExpression.characters[0].voice = '后来改变';
  assert.equal(restored.expression.characters[0].voice, '简短、直率');
});


test('typed Claim corruption is rejected and required material never truncates to fit input', () => {
  const request = transfer(), body = '结果。';
  const broken = structuredClone(request); broken.renderableClaims.claims[0].kind = 'fabricated';
  assert.throws(() => frozenNarrationReviewContext(broken, body), e => e.reason === 'invalidClaimFacts');
  const large = { ...request, narrationContext: freezeNarrationContext(request.renderableClaims, {
    ...request.narrationContext.expression, establishedDetails: [{ detailRef: 'detail:long', description: '历史'.repeat(16000) }],
  }) };
  for (const build of [r => naturalNarrationModelInput(r), r => narrationReviewModelInput(r, body)]) {
    assert.throws(() => build(large), e => e.reason === 'materialBudget');
  }
  assert.ok(conservativeInputTokens(JSON.stringify(deepSeekRequestBody('deepseek-v4-flash', narrationReviewModelInput(request, body)))) < 12000);
});


test('the adapter snapshots the reviewed material before either asynchronous provider call', async () => {
  const request = transfer(), original = structuredClone(request), body = '远行者把两面玻璃镜交给药师。';
  const ai = { async run(_model, input) {
    if (input.tools?.[0]?.function?.name === 'submit_frozen_narration') {
      request.narrationContext = freezeNarrationContext(request.renderableClaims, {
        ...request.narrationContext.expression, actor: { characterRef: actor, name: '外部异步篡改' },
      });
      return response('submit_frozen_narration', { body });
    }
    assert.equal(JSON.parse(input.messages[1].content).expression.actor.name, original.narrationContext.expression.actor.name);
    return response('review_frozen_narration', reviewFor(original, body));
  } };
  assert.equal((await createAuthoritativeKpAdapter({ ai }).narrate(request)).body, body);
});
