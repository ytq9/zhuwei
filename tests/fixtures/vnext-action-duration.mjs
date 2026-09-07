// A Bundle in which the character acts in the world carries the act's frozen
// fictional duration on its shared ruling; a Bundle that only authors content
// says "0". The domain keeps microseconds; the wire says a tier. Fixture helpers that take their proposals as a parameter derive it
// here so one helper can build both kinds without lying about time.
const IN_WORLD_ACT_KINDS = new Set(['social', 'observe', 'worldInteraction', 'inventoryOperation']);

// One tier (5 minutes): the smallest duration the KP can freeze for an act.
export const FIXTURE_ACT_DURATION_MICROS = '300000000';

export function actDuration(proposals) {
  const list = Array.isArray(proposals) ? proposals : [proposals];
  return list.some(entry => entry && typeof entry === 'object' && IN_WORLD_ACT_KINDS.has(entry.kind))
    ? FIXTURE_ACT_DURATION_MICROS : '0';
}

// Fixtures get mutated after construction -- proposals popped, pushed or
// replaced -- so the duration is read from the Bundle's proposals at the
// moment it is inspected. Assigning the field pins a literal value instead.
export function withActDuration(bundle) {
  const adjudication = bundle.adjudication;
  if (!adjudication || typeof adjudication !== 'object') return bundle;
  Object.defineProperty(adjudication, 'durationMicros', {
    enumerable: true, configurable: true,
    get() { return actDuration(bundle.proposals); },
    set(value) { Object.defineProperty(this, 'durationMicros', { value, writable: true, enumerable: true, configurable: true }); },
  });
  return bundle;
}

// A solo in-world act now lowers to a one-step atomic Bundle so it can spend
// its duration; tests that inspect the step's own Rules plan unwrap it here.
export const soleInput = input => input && input.kind === 'applyAtomicWorldInteractionSteps' ? input.steps[0].rulesInput : input;
export const soleStep = command => soleInput(command.rulesInput);
export const soleFormId = command => command.rulesInput.kind === 'applyAtomicWorldInteractionSteps' ? command.rulesInput.steps[0].formId : command.formId;
export const soleProposalRef = command => command.rulesInput.kind === 'applyAtomicWorldInteractionSteps' ? command.rulesInput.steps[0].proposalRef : command.proposalRef;

// Replace a Bundle's proposals and keep its duration honest for the new set.
export function rebundle(base, proposals) {
  return { ...base, adjudication: { ...base.adjudication, durationMicros: actDuration(proposals) }, proposals };
}

// Combine lowering's own execution costs (the act's duration) with a test's extra costs.
export function mergeExecutionCosts(base, extra) {
  const costs = [...(base?.costs ?? []), ...(extra?.costs ?? [])];
  const byRef = new Map();
  for (const binding of [...(base?.readSet ?? []), ...(extra?.readSet ?? [])]) byRef.set(binding.ref, binding);
  return { costs, readSet: [...byRef.values()].sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0) };
}
