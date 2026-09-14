// The strict-tool wire is a decision and a steps object keyed by the loaded
// capability, each step carrying its own success and failure. Tests that
// hand-edit a wire address a step by its position in the domain fixture, and
// read the decoded bundle at the position the fixed group order gives it.
import { vnextProposalCapabilityForEntry } from '../../app/_runtime/lib/kp/vnext/proposal-capabilities.ts';
import { VNEXT_FILLING_STEP_KEYS, proposalFillingSteps } from '../../app/_runtime/lib/kp/vnext/proposal-filling-interface.ts';

const keyOf = entry => vnextProposalCapabilityForEntry(entry) ?? String(entry?.kind);
/** Wire path of a domain bundle's proposals[index]: ['steps', key, ordinal within the group]. */
export function stepPath(bundle, index) {
  const key = keyOf(bundle.proposals[index]);
  return ['steps', key, bundle.proposals.slice(0, index).filter(entry => keyOf(entry) === key).length];
}
/** The wire step written for a domain bundle's proposals[index]. */
export function stepOf(wire, bundle, index) {
  const [, key, ordinal] = stepPath(bundle, index);
  return wire.steps[key][ordinal];
}
/** The domain indices in decode order: group by group in the fixed order, each group in written order. */
export function groupedOrder(bundle) {
  const rank = entry => VNEXT_FILLING_STEP_KEYS.indexOf(keyOf(entry));
  return bundle.proposals.map((_, index) => index).sort((a, b) => rank(bundle.proposals[a]) - rank(bundle.proposals[b]) || a - b);
}
/** Where proposals[index] of a domain bundle sits in the decoded bundle. */
export const decodedIndex = (bundle, index) => groupedOrder(bundle).indexOf(index);
/** The domain bundle with its proposals in decode order. */
export const reordered = bundle => ({ ...bundle, proposals: groupedOrder(bundle).map(index => bundle.proposals[index]) });
/** The wire with every group of the full catalogue present, [] where unused: what a form selecting every type requires. */
const allGroups = steps => Object.fromEntries(VNEXT_FILLING_STEP_KEYS.map(key => [key, steps?.[key] ?? []]));
export function withAllGroups(wire) {
  const decision = Array.isArray(wire.decision?.choices) ? { ...wire.decision, choices: wire.decision.choices.map(choice =>
    choice?.continuation?.steps === undefined ? choice : { ...choice, continuation: { ...choice.continuation, steps: allGroups(choice.continuation.steps) } }) } : wire.decision;
  return { ...wire, decision, steps: allGroups(wire.steps) };
}
/** Every step of a wire in decode order with its wire path. */
export const flatSteps = wire => proposalFillingSteps(wire.steps).map(step => ({ ...step, path: ['steps', step.key, step.index] }));
// A clarification continuation is the same decision with its own steps object.
export function nestedDecision(wire) {
  return { ...wire.decision, steps: wire.steps ?? {} };
}
export const continuationOf = nestedDecision;
