import assert from 'node:assert/strict';
import { storyContextFixture, ARCHIVIST, ARCHIVE, BOATMAN, HARBOR } from './story-context.mjs';
import { dueActorPlanChildRoot } from '../../app/_runtime/lib/rules/v2/actor-plans.ts';
import { dueActivityDescriptors } from '../../app/_runtime/lib/rules/v2/due-activities.ts';
import { buildStoryLibraryCatalogForScope } from '../../app/_runtime/lib/room/story-library.ts';

export const WORLD_PLAN = 'plan:story:remote-work', WORLD_ACTIVITY = 'activity:story:remote-work';
export const WORLD_TRACE = 'fact:story:remote-trace';
export const worldStoryEmptyCatalog = trigger => buildStoryLibraryCatalogForScope({
  room: { roomId: trigger.source.roomId, runtimeEpochId: trigger.source.runtimeEpochId, branchId: trigger.source.branchId },
  scopeRefs: [...trigger.scope.sceneIds, ...trigger.scope.entityIds], entries: [], jobs: [],
});
export function worldStoryFixture({ faction = false, decision = 'execute' } = {}) {
  const f = storyContextFixture('investigation'), factionRef = faction ? 'faction:story:archive' : null;
  // Supply the remote scene's tactical fixture as well, so the ordinary NPC
  // projector can expose its limited view without an author-context fallback.
  f.state.combatRuntime.scenes[ARCHIVE] = { ...structuredClone(f.state.combatRuntime.scenes[HARBOR]), sceneId: ARCHIVE };
  f.state.combatRuntime.scenes[ARCHIVE].geometry.obstacles[0].featureId = 'feature:story:archive-cabinet';
  f.state.combatRuntime.scenes[ARCHIVE].geometry.obstacles[0].label = '登记柜';
  f.state.entities[ARCHIVIST] = { ...structuredClone(f.state.entities[BOATMAN]), id: ARCHIVIST, name: '许录', sceneId: ARCHIVE };
  f.state.combatRuntime.entities[ARCHIVIST] = { ...structuredClone(f.state.combatRuntime.entities[BOATMAN]),
    id: ARCHIVIST, entityId: ARCHIVIST, name: '许录', sceneId: ARCHIVE };
  Object.assign(f.state.campaignRuntime.sourceClaims['knowledge:source-claim'], {
    sourceBasis: ['knowledge:source-claim'], motive: '记下尚待核对的报告', formedAtFictionMicros: '0',
  });
  f.state.campaignRuntime.npcPlans[WORLD_PLAN] = {
    npcId: ARCHIVIST, actorKind: 'npc', actorRef: ARCHIVIST, decisionNpcId: ARCHIVIST, planId: WORLD_PLAN,
    revision: '1', status: 'scheduled', factionRef, goal: '查找征用登记副本的矛盾', premiseRefs: ['knowledge:source-claim'],
    nextStep: '核对库房登记，并在柜门留下实际完成的登记条', resourceRefs: faction ? [factionRef] : [],
    activity: { activityId: WORLD_ACTIVITY, activityKind: 'archiveInspection', intendedDurationMicros: '1' },
    due: { kind: 'fictionTime', atFictionMicros: '0' }, trigger: null,
    trace: { factRef: WORLD_TRACE, description: '档案柜门出现了已核对封存登记的蓝纸条。', visibilityPolicyRef: 'visibility:scene-observers' },
    alternateTarget: { targetRef: ARCHIVE, reason: '登记柜的位置是已知的。' },
  };
  f.state.campaignRuntime.activities[WORLD_ACTIVITY] = { activityId: WORLD_ACTIVITY, characterId: ARCHIVIST,
    activityKind: 'archiveInspection', status: 'active', startedAtFictionMicros: '0', intendedDurationMicros: '1',
    completion: { kind: 'actorPlan', planId: WORLD_PLAN } };
  if (faction) {
    f.state.campaignRuntime.factions[factionRef] = { factionId: factionRef, memberRefs: [ARCHIVIST], resourceRefs: [] };
    f.state.campaignRuntime.factionPlans[WORLD_PLAN] = { ...structuredClone(f.state.campaignRuntime.npcPlans[WORLD_PLAN]),
      factionId: factionRef, actingNpcId: ARCHIVIST };
  }
  const rulesInput = { kind: 'resolveDueActorPlan', proposalId: dueActorPlanChildRoot(f.state.campaignRuntime.npcPlans[WORLD_PLAN]),
    affectedCharacterId: ARCHIVIST, causedByRootActionId: 'root:story:world-cause', planId: WORLD_PLAN,
    decision, mechanicalProposal: null, ...(decision === 'cancel' ? { reason: '发现原定核对方式已不可行。' } : {}) };
  const due = dueActivityDescriptors(f.state).find(candidate => candidate.actorPlan?.planId === WORLD_PLAN);
  assert.ok(due);
  f.resolve = (state = f.state) => {
    const result = f.runtime.step(f.profiles, state, rulesInput);
    assert.equal(result.kind, 'committed', JSON.stringify(result));
    return result;
  };
  f.commitInput = (result = f.resolve(), beforeState = f.state) => ({ beforeState, due, rulesInput,
    committedEvents: result.events, afterState: result.state, profiles: f.profiles,
    budgetSource: { roomId: f.state.roomId, runtimeEpochId: f.state.runtimeEpochId, branchId: f.state.activeBranchId,
      kind: 'playerAction', sourceId: 'root:story:world-cause', budgetAccountId: `source-budget:${f.state.runtimeEpochId}:root:story:world-cause` } });
  return { ...f, due, rulesInput };
}
