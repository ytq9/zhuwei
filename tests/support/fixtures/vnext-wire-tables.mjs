// The strict-tool wire is a decision, a check object and a steps object, the
// last two keyed by the loaded capability. check holds the one step whose
// outcome the check decides, with success and failure; every other step sits in
// steps with at most one result. Tests that hand-edit a wire address a step by
// its position in the domain fixture, and read the decoded bundle at the
// position the fixed group order gives it.
import { vnextProposalCapabilityForEntry } from '../../../app/_runtime/lib/kp/vnext/proposal-capabilities.ts';
import { VNEXT_FILLING_STEP_KEYS, proposalFillingSteps } from '../../../app/_runtime/lib/kp/vnext/proposal-filling-interface.ts';

const keyOf = entry => vnextProposalCapabilityForEntry(entry) ?? String(entry?.kind);
const RESULT_KINDS = ['worldInteraction', 'observe', 'social'];
/** A domain step the check decides: a result type whose failure is written. */
export function isCheckStep(entry) {
  const failure = entry?.branches?.failure;
  return RESULT_KINDS.includes(entry?.kind) && failure !== null && typeof failure === 'object'
    && !(Object.keys(failure).length === 1 && failure.kind === 'none');
}
const containerOf = entry => isCheckStep(entry) ? 'check' : 'steps';
/** Wire path of a domain bundle's proposals[index]: [container, key, ordinal within that container's group]. */
export function stepPath(bundle, index) {
  const entry = bundle.proposals[index], key = keyOf(entry), container = containerOf(entry);
  return [container, key, bundle.proposals.slice(0, index).filter(other => keyOf(other) === key && containerOf(other) === container).length];
}
/** The wire step written for a domain bundle's proposals[index]. */
export function stepOf(wire, bundle, index) {
  const [container, key, ordinal] = stepPath(bundle, index);
  return wire[container][key][ordinal];
}
/** The domain indices in decode order: group by group in the fixed order, a
 * group's check step first, each list in written order. */
export function groupedOrder(bundle) {
  const rank = entry => VNEXT_FILLING_STEP_KEYS.indexOf(keyOf(entry)) * 2 + (containerOf(entry) === 'check' ? 0 : 1);
  return bundle.proposals.map((_, index) => index).sort((a, b) => rank(bundle.proposals[a]) - rank(bundle.proposals[b]) || a - b);
}
/** Where proposals[index] of a domain bundle sits in the decoded bundle. */
export const decodedIndex = (bundle, index) => groupedOrder(bundle).indexOf(index);
/** The domain bundle with its proposals in decode order. */
export const reordered = bundle => ({ ...bundle, proposals: groupedOrder(bundle).map(index => bundle.proposals[index]) });
/** The wire with every group of the full catalogue present, [] where unused: what a form selecting every type requires. */
const allGroups = steps => Object.fromEntries(VNEXT_FILLING_STEP_KEYS.map(key => [key, steps?.[key] ?? []]));
const allCheckGroups = check => Object.fromEntries(VNEXT_FILLING_STEP_KEYS.filter(key => RESULT_KINDS.includes(key)).map(key => [key, check?.[key] ?? []]));
const allOf = filling => ({ ...filling, check: allCheckGroups(filling.check), steps: allGroups(filling.steps) });
export function withAllGroups(wire) {
  const decision = Array.isArray(wire.decision?.choices) ? { ...wire.decision, choices: wire.decision.choices.map(choice =>
    choice?.continuation?.steps === undefined ? choice : { ...choice, continuation: allOf(choice.continuation) }) } : wire.decision;
  return { ...allOf(wire), decision };
}
/** Every step of a wire in decode order with its wire path. */
export const flatSteps = wire => proposalFillingSteps(wire).map(step => ({ ...step, path: [step.container, step.key, step.index] }));
// A clarification continuation is the same decision with its own check and steps objects.
export function nestedDecision(wire) {
  return { ...wire.decision, ...(wire.check === undefined ? {} : { check: wire.check }), steps: wire.steps ?? {} };
}
export const continuationOf = nestedDecision;
