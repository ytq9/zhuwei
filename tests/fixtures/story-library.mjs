import assert from 'node:assert/strict';
import { freezeAuthoredProbeContext } from '../../tools/lib/vnext-authored-probe-fixture.mjs';
import { canonicalHash } from '../../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { storyHostingArtifact, storyLibraryEntry, storyLibraryOwner, storyLibraryMappings,
  buildStoryLibraryCatalog } from '../../app/_runtime/lib/room/story-library.ts';
import { bindStoryLibraryCatalog, roomStoryReuseRequest, bindStoryLibrarySelection } from '../../app/_runtime/lib/room/story-library-context.ts';
import { buildRoomStoryContext } from '../../app/_runtime/lib/room/story-context.ts';
import { lowerVNext2ProposalBundle } from '../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { encodeVNextStrictToolBundle } from '../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { prepareStoryAdmissionBinding, storyAdmissionReceipt } from '../../app/_runtime/lib/room/story-admission.ts';
import { bundle, ACTOR, SCENE } from './kp-vnext-story-materialization.mjs';

/** Full source drafts/reviews come from createStoryMaterializationFixture.
 * This port is an immutable read fixture, never a budget or invocation mock. */
export function storyLibraryFixture(f, entries) {
  const job = { request: f.request, context: f.storyContext, checkpoint: f.checkpoint };
  const room = { roomId: f.state.roomId, runtimeEpochId: f.state.runtimeEpochId, branchId: f.state.activeBranchId };
  const entry = entries?.[0] ?? storyLibraryEntry(room, storyHostingArtifact(job), { kind: 'creationJob', jobId: f.request.jobId });
  const admissions = f.admission ? [f.admission] : [];
  const jobs = entries ? [] : [job];
  const journal = { readCreationJob: id => jobs.find(value => value.request.jobId === id), listCreationJobs: () => jobs,
    readAdmissions: owner => admissions.filter(value => canonicalHash(value.owner) === canonicalHash(owner)) };
  return { job, room, entry, entries: entries ?? [entry], jobs, admissions, journal };
}

/** A genuine later frozen player action. The source manuscript is neither
 * rewritten nor run through a creation method again. */
export function freezeStoryReuse(f, library, { rootActionId = `${f.rootActionId}:reuse`, focusRefs = [],
  intentText = '继续核对既有登记材料，选择我现在愿意做的事。' } = {}) {
  const raw = freezeAuthoredProbeContext(f, f.state, { rootActionId, focusRefs: [SCENE, ...focusRefs], intentText }).context;
  const catalog = buildStoryLibraryCatalog({ ...library, requiredContext: raw });
  const offered = bindStoryLibraryCatalog(raw, catalog, 48_000);
  assert.equal(offered.kind, 'accepted', JSON.stringify(offered));
  const entry = library.entry, mappings = storyLibraryMappings(entry, library.journal.readAdmissions(storyLibraryOwner(entry)));
  const currentRequest = roomStoryReuseRequest(offered.context, f.state, entry, mappings);
  const current = buildRoomStoryContext({ ...f, request: currentRequest, requiredContext: offered.context, maxUnits: 48_000 });
  assert.equal(current.kind, 'ready', JSON.stringify(current));
  const bound = bindStoryLibrarySelection({ ...f, entry, mappings, currentRequest, currentContext: current.context,
    selectionContext: offered.context, maxUnits: 48_000 });
  assert.equal(bound.kind, 'ready', JSON.stringify(bound));
  return { catalog, selectionContext: offered.context, context: bound.context, binding: bound.binding };
}

export function admitStoryReuse(f, library, frozen, selectors) {
  const rootActionId = frozen.context.binding.rootActionId;
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle(selectors))));
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
  const proposal = parsed.bundle;
  const lowered = lowerVNext2ProposalBundle({ value: proposal, requiredContext: frozen.context,
    state: f.state, profiles: f.profiles, rootActionId, actorCharacterId: ACTOR });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  const rulesInput = lowered.command.rulesInput;
  const body = prepareStoryAdmissionBinding({ library: frozen.binding.library, preparationHash: f.preparationHash,
    preparedActionId: `prepared:${rootActionId}`, proposal, rulesInput, requiredContext: frozen.context, state: f.state, profiles: f.profiles });
  assert.ok(body);
  const binding = { ...body, bindingHash: canonicalHash(body) }, before = structuredClone(f.state), result = f.run(rulesInput);
  const admission = storyAdmissionReceipt({ binding, preparation: f.preparation, state: f.state, events: f.events,
    receiptId: result.receipt.receiptId, recordedAtEventSeq: result.receipt.eventRange.toEventSeq, rulesInput });
  library.admissions.push(admission);
  return { before, result, binding, admission, rulesInput, proposal };
}
