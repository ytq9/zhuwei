import assert from 'node:assert/strict';
import { dueActivityDescriptors } from '../../app/_runtime/lib/rules/v2/due-activities.ts';
import { foldEvent } from '../../app/_runtime/lib/rules/v2/events.ts';

// Direct Rules consumers must explicitly drive the same staged action that
// Room drains. This helper stops at native dice/choice, a notification, or work
// belonging to another actor. It never answers decisions or changes the input.
// `events` is the complete journal; each real receipt and its own event range
// remain available in `activityStages`. No Activity bookkeeping is filtered out.
export function stepActionToDecision(runtime, profiles, state, input) {
  let result = runtime.step(profiles, state, input);
  if (result.kind !== 'committed') return result;
  const started = result.events.find(event => event.eventType === 'ActivityStarted'
    && event.payload.activityKind === 'actionExecution');
  if (started === undefined) return result;
  const activityId = started.payload.activityId;
  const activityStages = [{ priorState: state, input, result }];
  const events = [...result.events];
  let completionPriorState;
  for (let index = 0; index < 16; index++) {
    const due = dueActivityDescriptors(result.state).find(entry => entry.activityId === activityId);
    if (due?.activityProgress === undefined) break;
    const completing = due.activityProgress.phase === 'complete';
    const nextInput = { kind: completing ? 'completeActionActivity' : 'advanceActivity',
      proposalId: due.childRootActionId, activityId };
    const priorState = result.state;
    if (completing) completionPriorState = priorState;
    result = runtime.step(profiles, priorState, nextInput);
    activityStages.push({ priorState, input: nextInput, result });
    events.push(...result.events);
    if (result.kind !== 'committed' || completing || due.activityProgress.phase === 'attention') break;
    assert.notEqual(index, 15, 'action activity exceeded the fixture stage bound');
  }
  return { ...result, events, activityStages, completionPriorState };
}

// A staged action has several real receipts. Project exactly the requested
// receipt, replaying the preceding journal to obtain its actual prior state.
export function committedActionRange(state, range) {
  const receipt = Object.values(state.receipts).find(value => value.receiptId === range.receiptId);
  assert.ok(receipt?.eventRange, 'projection needs an authoritative receipt');
  const from = BigInt(receipt.eventRange.fromEventSeq), to = BigInt(receipt.eventRange.toEventSeq);
  const prefix = range.events.filter(event => BigInt(event.eventSeq) < from);
  const priorState = prefix.reduce((before, event) => foldEvent(before, event), range.priorState);
  assert.equal(BigInt(priorState.version) + 1n, from, 'projection prefix must be complete');
  return { ...range, priorState, events: range.events.filter(event => BigInt(event.eventSeq) >= from && BigInt(event.eventSeq) <= to) };
}
