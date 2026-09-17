// Shared deterministic setup; no test registration or real model calls.
/**
 * Gate for SPEC 0016 §8.3: continuity review reports contradicting facts
 * instead of building a per-fragment evidence matrix.
 *
 * A passing review carries no per-fragment or per-fact proof; completeness is
 * checked once per committed mechanical group; a zero-mechanical review omits
 * resultChecks entirely, which is also the shape the real provider accepts.
 */
import assert from "node:assert/strict";
import { createAuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative.ts";
import { deriveAuthorityClaims, projectRenderableClaims } from "../../../app/_runtime/lib/rules/v2/claims.ts";
import { freezeNarrationContext } from "../../../app/_runtime/lib/kp/narration-context.ts";
import { frozenNarrationReviewContext } from "../../../app/_runtime/lib/kp/narration-vnext.ts";


const actor = 'character:zed', viewer = 'character:amy';

const basis = { authorityRefs: [], viewerRefs: [] };

function requestFor(materials, own = false, extraRefs = []) {
  const receipt = { rootActionId: 'root:narration', receiptId: 'receipt:narration', status: 'committed' };
  const viewerRef = own ? actor : viewer;
  const renderableClaims = projectRenderableClaims(deriveAuthorityClaims({ ...receipt,
    materials: materials.map((material, i) => ({ claimRef: `claim:${i}`, basis, visibility: { kind: 'public' }, ...material })),
  }), { viewerKey: `principal:reader\u001f${viewerRef}`, refs: [actor, viewer, 'item:mirror', 'item:bolts', 'feature:door', 'npc:a', 'npc:b', ...extraRefs],
    displayNames: { [actor]: '远行者', [viewer]: '药师', 'item:mirror': '玻璃镜', 'item:bolts': '弩矢', 'npc:a': '林', 'npc:b': '林' } });
  return { ...receipt, receipt, narrationInputMode: 'frozenRenderableClaims-vnext-1', viewerKey: renderableClaims.viewerKey, renderableClaims,
    narrationContext: freezeNarrationContext(renderableClaims, {
      viewer: { characterRef: viewerRef, name: own ? '远行者' : '药师' }, actor: { characterRef: actor, name: '远行者' },
      actorIntent: own ? '把两面镜子交给药师。' : null, scene: { name: '会客室', tone: '克制、悬疑' },
      actorIntentOrigin: own ? { rootActionId: receipt.rootActionId, receiptId: receipt.receiptId,
        messageId: 'action:declared', sourceEventSeq: '1', inputKind: 'intent', activityId: null } : null,
      characters: [{ characterRef: 'npc:a', name: '林', voice: '简短、直率', attitude: null },
        { characterRef: 'npc:b', name: '林', voice: '用词正式，称对方阁下', attitude: '礼貌地保持距离' }],
      establishedDetails: [], recentDialogue: [],
    }),
  };
}

function transfer() { return requestFor([{ kind: 'inventoryOutcome', itemRef: 'item:mirror', change: 'transferred',
  characterRefs: [viewer, actor], operation: { kind: 'transfer', actorRef: actor, recipientRef: viewer, quantity: 2 }, summary: '完成转交。' }]); }

function reviewFor(request, body) {
  const context = frozenNarrationReviewContext(request, body);
  return { reviewId: context.reviewId,
    checks: { results: 'pass', continuity: 'pass', attribution: 'pass', agency: 'pass', presentation: 'pass' },
    ...(context.mechanicalResults.length ? { resultChecks: Object.fromEntries(context.mechanicalResults.map(result => [result.key, 'complete'])) } : {}), issues: [] };
}

function problem(request, body, code, check, constraintRef, quote = body, verdict = 'fail') {
  const value = reviewFor(request, body); value.checks[check] = verdict;
  value.issues.push({ code, check, constraintRef, quote, occurrence: 0, reason: '具体原文与所指冻结约束不符。' });
  for (const result of frozenNarrationReviewContext(request, body).mechanicalResults) {
    if (check === 'results' && (result.constraintRef === constraintRef || result.factRefs.includes(constraintRef)))
      value.resultChecks[result.key] = code === 'RESULT_CHANGED' ? 'changed' : code === 'RESULT_OMITTED' ? 'omitted' : 'uncertain';
  }
  return value;
}

function response(name, value) { return { choices: [{ message: { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(value) } }] }, finish_reason: 'tool_calls' }],
  usage: { prompt_tokens: 101, completion_tokens: 23, total_tokens: 124 } }; }

function jsonResponse(value) { return { choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 101, completion_tokens: 23, total_tokens: 124 } }; }


function binding(request, body, review, options = {}) {
  const calls = [], receipts = [];
  const ai = { async run(model, input, signal) {
    calls.push({ model, input, signal });
    assert.ok(calls.length <= 4, 'At most one rewrite and review');
    if (calls.length === 1 || calls.length === 3) return options.candidateResponse ?? response('submit_frozen_narration', options.candidate ?? { body });
    if (options.reviewError) throw options.reviewError;
    if (options.hang) return new Promise(() => {});
    return options.reviewResponse ?? response('review_frozen_narration', review);
  } };
  return { calls, receipts, adapter: createAuthoritativeKpAdapter({ ai, onInvocationReceipt: r => receipts.push(r), ...options.adapter }) };
}
export { actor, viewer, basis, requestFor, transfer, reviewFor, problem, response, jsonResponse, binding };
