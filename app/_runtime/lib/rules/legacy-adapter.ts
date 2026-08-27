import {
  applyEvents,
  createWorldState,
  project,
  step,
  type InitialEntity,
} from "./engine";
import type {
  Command,
  Decision,
  PlayerProjection,
  SquadState,
  WorldDefinition,
  WorldEvent,
  WorldState,
} from "./model";
import { RULESET_VERSION } from "./ruleset";

export type LegacyInitialEntity = InitialEntity;

export type LegacyRulesAdapter = {
  readonly rulesetVersion: typeof RULESET_VERSION;
  initializeWorld(
    definition: WorldDefinition,
    entities: LegacyInitialEntity[],
    squads?: SquadState[],
  ): WorldState;
  adjudicate(
    definition: WorldDefinition,
    state: WorldState,
    command: Command,
  ): Decision;
  applyCommittedEvents(state: WorldState, events: WorldEvent[]): WorldState;
  projectViewer(
    definition: WorldDefinition,
    state: WorldState,
    viewerId: string,
  ): PlayerProjection;
};

function assertLegacyDefinition(definition: WorldDefinition): void {
  if (definition.rulesetVersion !== RULESET_VERSION) {
    throw new Error(`Legacy rules adapter only supports ${RULESET_VERSION}.`);
  }
}

function assertLegacyState(state: WorldState): void {
  if (state.rulesetVersion !== RULESET_VERSION) {
    throw new Error(`Legacy rules adapter only accepts ${RULESET_VERSION} state.`);
  }
}

const adapter: LegacyRulesAdapter = Object.freeze({
  rulesetVersion: RULESET_VERSION,
  initializeWorld(definition, entities, squads = []) {
    assertLegacyDefinition(definition);
    return createWorldState(definition, entities, squads);
  },
  adjudicate(definition, state, command) {
    assertLegacyDefinition(definition);
    assertLegacyState(state);
    return step(definition, state, command);
  },
  applyCommittedEvents(state, events) {
    assertLegacyState(state);
    return applyEvents(state, events);
  },
  projectViewer(definition, state, viewerId) {
    assertLegacyDefinition(definition);
    assertLegacyState(state);
    return project(definition, state, viewerId);
  },
});

/**
 * Returns the only supported Legacy facade. Callers must supply the persisted
 * room ruleset so an authoritative or unknown version cannot reach v1 internals.
 */
export function legacyRulesAdapterFor(rulesetVersion: string): LegacyRulesAdapter {
  if (rulesetVersion !== RULESET_VERSION) {
    throw new Error(`Legacy rules adapter is unavailable for ${rulesetVersion}.`);
  }
  return adapter;
}
