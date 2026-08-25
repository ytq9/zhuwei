import type { Ability, D20Mode, Duration, RulesetVersion } from "./ruleset";

export type EntityId = string;
export type SceneId = string;
export type ArtifactId = string;

export type Predicate =
  | { kind: "actorAt"; sceneId: SceneId }
  | { kind: "entityAt"; entityId: EntityId; sceneId: SceneId }
  | { kind: "artifactAt"; artifactId: ArtifactId; sceneId: SceneId }
  | { kind: "artifactHeldByActor"; artifactId: ArtifactId }
  | { kind: "artifactHeldByEntity"; artifactId: ArtifactId; entityId: EntityId }
  | { kind: "portalState"; portalId: string; state: PortalState }
  | { kind: "flagEquals"; flag: string; value: string | number | boolean }
  | { kind: "actorKnows"; clueId: string; minimumLayer?: ClueLayer }
  | { kind: "actorHasCapability"; capability: string }
  | { kind: "not"; predicate: Predicate };

export type RuleEffect =
  | { kind: "transferArtifact"; artifactId: ArtifactId; to: "actor" }
  | { kind: "moveActor"; portalId: string; to: SceneId }
  | { kind: "setPortalState"; portalId: string; state: PortalState }
  | { kind: "revealClue"; clueId: string; layer: ClueLayer }
  | { kind: "setFlag"; flag: string; value: string | number | boolean }
  | { kind: "damage"; target: "actor"; amount: number; damageType: string }
  | { kind: "heal"; target: "actor"; amount: number }
  | { kind: "spendResource"; resource: string; amount: number };

export type PortalState = "open" | "closed" | "locked" | "destroyed";

export type PortalDefinition = {
  id: string;
  from: SceneId;
  to: SceneId;
  initialState: PortalState;
  prerequisites?: Predicate[];
  traversalTime: Duration;
};

export type ArtifactDefinition = {
  id: ArtifactId;
  name: string;
  initialSceneId: SceneId;
  initialHolderId?: EntityId;
  aliases?: string[];
  initialVisibility: "obvious" | "hidden";
};

export type InteractionDefinition = {
  id: string;
  name: string;
  sceneId: SceneId;
  targetId?: string;
  aliases?: string[];
  verbs?: string[];
  prerequisites?: Predicate[];
  resolution:
    | { kind: "automatic" }
    | {
        kind: "check";
        ability: Ability;
        skill?: string;
        dc: number;
        mode?: D20Mode;
        reason: string;
      };
  success: RuleEffect[];
  failure?: RuleEffect[];
  duration: Duration;
  spotlightBeats: number;
};

export type NpcPlanDefinition = {
  id: string;
  actorId: EntityId;
  requiredKnowledge?: string[];
  requiredCapabilities?: string[];
  prerequisites?: Predicate[];
  effects: RuleEffect[];
  duration: Duration;
};

export type ScheduledEventDefinition = {
  id: string;
  atSeconds: number;
  scope:
    | { kind: "location"; sceneId: SceneId }
    | { kind: "entity"; entityId: EntityId }
    | { kind: "global" };
  conditions?: Predicate[];
  npcPlanId: string;
  cancelIf?: Predicate[];
  interruption: "none" | "mayInterruptActivity" | "mustResolveFirst";
};

export type WorldPredicate =
  | { kind: "flagEquals"; flag: string; value: string | number | boolean }
  | { kind: "flagAtLeast"; flag: string; value: number }
  | { kind: "portalState"; portalId: string; state: PortalState }
  | {
      kind: "artifactStatus";
      artifactId: ArtifactId;
      status: ArtifactState["status"];
      holderId?: EntityId;
    }
  | { kind: "entityAt"; entityId: EntityId; sceneId: SceneId }
  | { kind: "entityKnows"; entityId: EntityId; clueId: string; minimumLayer?: ClueLayer }
  | { kind: "allPlayersKnow"; clueId: string; minimumLayer?: ClueLayer }
  | { kind: "not"; predicate: WorldPredicate };

export type EndingDefinition = {
  id: string;
  name: string;
  outcome: "success" | "mixed" | "failure";
  when: WorldPredicate[];
  /** 只在 when 已满足后进入玩家投影；不能包含模组 truth。 */
  publicText: string;
};

export type WorldDefinition = {
  rulesetVersion: RulesetVersion;
  initialSceneId: SceneId;
  locationSceneIds: SceneId[];
  portals: PortalDefinition[];
  artifacts: ArtifactDefinition[];
  interactions: InteractionDefinition[];
  npcInitialKnowledge: Record<EntityId, Record<string, ClueLayer>>;
  npcCapabilities: Record<EntityId, string[]>;
  npcPlans: NpcPlanDefinition[];
  scheduledEvents: ScheduledEventDefinition[];
  endings: EndingDefinition[];
};

export type ClueLayer = "hint" | "partial" | "full";

export type AttackProfile = {
  id: string;
  name: string;
  attackBonus: number;
  kind?: "melee" | "ranged";
  ammoResource?: "arrow" | "bolt";
  reachFeet?: number;
  normalRangeFeet?: number;
  longRangeFeet?: number;
  damage: { count: number; sides: number; bonus: number; damageType: string };
};

export type EntityState = {
  id: EntityId;
  kind: "player" | "npc";
  name: string;
  active: boolean;
  level: number;
  sceneId: SceneId;
  visitedSceneIds: SceneId[];
  abilityScores: Record<Ability, number>;
  proficiencyBonus: number;
  proficientSkills: string[];
  expertiseSkills: string[];
  capabilities: string[];
  spellLevels: Record<string, number>;
  spellActionCosts: Record<string, "action" | "bonusAction" | "reaction">;
  featureIds: string[];
  activeEffects: string[];
  attacks: AttackProfile[];
  /** 当前可用量；消耗与恢复都只能由规则事件修改。 */
  resources: Record<string, number>;
  resourceRules: Record<
    string,
    { max: number; recovery: "none" | "short" | "long" | "shortOrLong"; die?: number }
  >;
  hp?: { current: number; max: number };
  deathSaves: { successes: number; failures: number };
  ac: number;
  speedFeet: number;
  lastLongRestCompletedAt?: number;
};

export type ArtifactState = {
  artifactId: ArtifactId;
  status: "placed" | "held" | "consumed" | "destroyed";
  sceneId?: SceneId;
  holderId?: EntityId;
};

export type TimelineState = {
  spotlightBeat: number;
  fictionSeconds: number;
  causalVersion: number;
};

export type PendingRoll = {
  id: string;
  actorId: EntityId;
  interactionId: string;
  ability: Ability;
  skill?: string;
  dc: number;
  mode: D20Mode;
  reason: string;
  success: RuleEffect[];
  failure: RuleEffect[];
  duration: Duration;
  spotlightBeats: number;
};

export type RollBoosts = {
  guidanceRoll?: number;
  useInspiration?: boolean;
  luckyReplacedOnes?: number;
};

export type RestOptions = { hitDiceRolls?: number[]; arcaneRecovery?: 1 | 2 };

export type RestAttempt = {
  actorId: EntityId;
  kind: "short" | "long";
  startedAt: number;
  requiredSeconds: number;
  status: "resting" | "interrupted" | "completed";
  options?: RestOptions;
};

export type ActivityState = {
  id: string;
  actorId: EntityId;
  kind: "interaction" | "npcPlan" | "general";
  sourceId: string;
  name: string;
  startedAt: number;
  completesAt: number;
  status: "active" | "interrupted" | "completed" | "failed";
};

export type SquadState = { id: string; captainId: EntityId; memberIds: EntityId[] };

export type SquadInviteState = {
  id: string;
  fromId: EntityId;
  toId: EntityId;
  sceneId: SceneId;
};

export type RestVoteState = {
  id: string;
  squadId: string;
  kind: "short" | "long";
  proposerId: EntityId;
  eligibleIds: EntityId[];
  agreedIds: EntityId[];
  options: Record<EntityId, RestOptions>;
};

export type CombatTurnEconomy = {
  action: boolean;
  bonusAction: boolean;
  reaction: boolean;
  movement: boolean;
  objectInteraction: boolean;
  movementFeet: number;
};

export type RulesCombatant = {
  entityId: EntityId;
  side: string;
  initiative: number;
  economy: CombatTurnEconomy;
  attackedThisTurn: boolean;
  deathSaveRolledThisTurn: boolean;
  positionFeet: number;
};

export type RulesCombatState = {
  id: string;
  sceneId: SceneId;
  initiatorSide: string;
  oppositionSide: string;
  round: number;
  activeIndex: number;
  order: RulesCombatant[];
  status: "active" | "ended";
};

export type WorldState = {
  rulesetVersion: RulesetVersion;
  version: number;
  entities: Record<EntityId, EntityState>;
  portals: Record<string, PortalState>;
  artifacts: Record<ArtifactId, ArtifactState>;
  knowledge: Record<EntityId, Record<string, ClueLayer>>;
  timelines: Record<EntityId, TimelineState>;
  causalFrontierSeconds: number;
  pendingRolls: Record<string, PendingRoll>;
  activities: Record<string, ActivityState>;
  rests: Record<EntityId, RestAttempt>;
  squads: Record<string, SquadState>;
  squadInvites: Record<string, SquadInviteState>;
  restVote?: RestVoteState;
  combats: Record<SceneId, RulesCombatState>;
  scheduledEvents: Record<string, "pending" | "attempted" | "cancelled">;
  flags: Record<string, string | number | boolean>;
  processedCommandIds: string[];
};

type CommandBase = { id: string; actorId: EntityId; expectedVersion: number };

export type Command =
  | (CommandBase & { kind: "interact"; interactionId: string })
  | (CommandBase & {
      kind: "resolveRoll";
      requestId: string;
      rolls: number[];
      boosts?: RollBoosts;
    })
  | (CommandBase & {
      kind: "move";
      portalId: string;
      destinationId: SceneId;
      mode: "personal" | "squad";
    })
  | (CommandBase & { kind: "advanceTime"; duration: Duration; spotlightBeats?: number })
  | (CommandBase & { kind: "castSpell"; spellId: string; slotLevel?: 1 | 2 })
  | (CommandBase & { kind: "useFeature"; featureId: string; rolls?: number[] })
  | (CommandBase & {
      kind: "startCombat";
      targetIds: EntityId[];
      initiativeRolls: Record<EntityId, number>;
    })
  | (CommandBase & {
      kind: "joinCombat";
      combatId: string;
      initiativeRoll: number;
      sideWithId?: EntityId;
    })
  | (CommandBase & {
      kind: "spendCombatAction";
      combatId: string;
      cost: "action" | "bonusAction" | "reaction" | "movement" | "objectInteraction";
    })
  | (CommandBase & {
      kind: "combatAttack";
      combatId: string;
      targetId: EntityId;
      attackId: string;
      mode: D20Mode;
      d20Rolls: number[];
      damageRolls: number[];
      cost?: "action" | "bonusAction";
    })
  | (CommandBase & {
      kind: "combatMove";
      combatId: string;
      toPositionFeet: number;
      mode: "normal" | "dash" | "disengage";
      opportunityRolls: Record<string, { d20Roll: number; damageRolls: number[] }>;
    })
  | (CommandBase & { kind: "rollDeathSave"; d20Roll: number })
  | (CommandBase & { kind: "endCombatTurn"; combatId: string })
  | (CommandBase & { kind: "startRest"; rest: "short" | "long"; options?: RestOptions })
  | (CommandBase & { kind: "interruptRest" })
  | (CommandBase & { kind: "leaveSquad" })
  | (CommandBase & { kind: "inviteSquad"; targetId: EntityId })
  | (CommandBase & { kind: "cancelSquadInvite"; inviteId: string })
  | (CommandBase & { kind: "respondSquadInvite"; inviteId: string; accept: boolean })
  | (CommandBase & { kind: "transferSquadCaptain"; squadId: string; targetId: EntityId })
  | (CommandBase & { kind: "proposeGroupRest"; squadId: string; rest: "short" | "long"; options?: RestOptions })
  | (CommandBase & { kind: "voteGroupRest"; voteId: string; agree: boolean; options?: RestOptions });

type EventBase = {
  id: string;
  commandId: string;
  version: number;
  atSeconds: number;
};

export type WorldEvent = EventBase &
  (
    | { type: "CommandRecorded"; outcome: "committed" | "awaitingRoll" }
    | { type: "EntityJoined"; entity: EntityState; timeline: TimelineState }
    | { type: "EntityRejoined"; entityId: EntityId }
    | { type: "EntityDeparted"; entityId: EntityId }
    | {
        type: "EntityLoadoutSynchronized";
        entityId: EntityId;
        ac: number;
        attacks: AttackProfile[];
        capabilities: string[];
      }
    | { type: "RollRequested"; roll: PendingRoll }
    | { type: "RollResolved"; requestId: string; success: boolean; total: number }
    | { type: "ArtifactTransferred"; artifactId: ArtifactId; holderId: EntityId }
    | { type: "PortalStateChanged"; portalId: string; state: PortalState }
    | { type: "ClueLearned"; viewerId: EntityId; clueId: string; layer: ClueLayer }
    | { type: "FlagSet"; flag: string; value: string | number | boolean }
    | { type: "EntityDamaged"; entityId: EntityId; amount: number; damageType: string }
    | { type: "EntityHealed"; entityId: EntityId; amount: number }
    | { type: "ResourceSpent"; entityId: EntityId; resource: string; amount: number }
    | { type: "ResourceRecovered"; entityId: EntityId; resource: string; amount: number }
    | { type: "SpellCast"; entityId: EntityId; spellId: string; slotLevel: 0 | 1 | 2 }
    | { type: "FeatureUsed"; entityId: EntityId; featureId: string; total?: number }
    | { type: "ActiveEffectSet"; entityId: EntityId; effectId: string; active: boolean }
    | { type: "CombatStarted"; combat: RulesCombatState }
    | { type: "CombatEnded"; sceneId: SceneId; reason: string }
    | { type: "CombatantSideChanged"; sceneId: SceneId; entityId: EntityId; side: string }
    | { type: "CombatantJoined"; sceneId: SceneId; combatant: RulesCombatant }
    | {
        type: "CombatActionSpent";
        sceneId: SceneId;
        entityId: EntityId;
        cost: "action" | "bonusAction" | "reaction" | "movement" | "objectInteraction";
      }
    | {
        type: "CombatAttackResolved";
        sceneId: SceneId;
        attackerId: EntityId;
        targetId: EntityId;
        attackId: string;
        attackTotal: number;
        hit: boolean;
        critical: boolean;
        damage: number;
      }
    | {
        type: "CombatantMoved";
        sceneId: SceneId;
        entityId: EntityId;
        fromPositionFeet: number;
        toPositionFeet: number;
        feet: number;
        mode: "normal" | "dash" | "disengage";
      }
    | {
        type: "EntityDropped";
        entityId: EntityId;
        outcome: "unconscious" | "dead";
      }
    | {
        type: "DeathSaveResolved";
        entityId: EntityId;
        d20Roll: number;
        successes: number;
        failures: number;
        outcome: "pending" | "stable" | "revived" | "dead";
      }
    | {
        type: "CombatTurnAdvanced";
        sceneId: SceneId;
        fromEntityId: EntityId;
        toEntityId: EntityId;
        round: number;
      }
    | { type: "EntityMoved"; entityId: EntityId; from: SceneId; to: SceneId; portalId: string }
    | {
        type: "FictionTimeAdvanced";
        entityIds: EntityId[];
        fromSeconds: number;
        toSeconds: number;
        spotlightBeats: number;
      }
    | {
        type: "TimelinesSynchronized";
        entityIds: EntityId[];
        toSeconds: number;
        toSpotlightBeat: number;
      }
    | { type: "SpotlightAdvanced"; entityId: EntityId; beats: number }
    | { type: "ScheduledEventAttempted"; scheduledEventId: string; npcPlanId: string }
    | { type: "ScheduledEventCancelled"; scheduledEventId: string }
    | { type: "ActivityStarted"; activity: ActivityState }
    | { type: "ActivityCompleted"; activityId: string }
    | { type: "ActivityFailed"; activityId: string; reason: string }
    | {
        type: "ActivityInterrupted";
        actorId: EntityId;
        activityId?: string;
        scheduledEventId: string;
      }
    | { type: "RestStarted"; rest: RestAttempt }
    | { type: "RestInterrupted"; actorId: EntityId }
    | { type: "RestCompleted"; actorId: EntityId; rest: "short" | "long" }
    | { type: "SquadLeft"; squadId: string; actorId: EntityId }
    | { type: "SquadInvited"; invite: SquadInviteState }
    | { type: "SquadInviteCleared"; inviteId: string }
    | { type: "SquadUpserted"; squad: SquadState }
    | { type: "SquadCaptainTransferred"; squadId: string; captainId: EntityId }
    | { type: "RestVoteProposed"; vote: RestVoteState }
    | { type: "RestVoteCast"; voteId: string; actorId: EntityId; agree: boolean; options?: RestOptions }
    | { type: "RestVoteCleared"; voteId: string }
  );

export type RuleRejection = {
  code:
    | "ruleset_mismatch"
    | "stale_state"
    | "duplicate_command"
    | "unknown_actor"
    | "unknown_target"
    | "unreachable"
    | "precondition_failed"
    | "already_resolved"
    | "invalid_roll"
    | "not_allowed"
    | "rest_ineligible";
  message: string;
};

export type DecisionOutcome =
  | { kind: "rejected"; rejection: RuleRejection }
  | { kind: "awaitingRoll"; roll: PendingRoll; events: WorldEvent[] }
  | { kind: "committed"; events: WorldEvent[] };

/** 同一 commandId 的规则裁决拥有稳定 decisionId，供重试、日志和回放核对。 */
export type Decision = DecisionOutcome & {
  decisionId: string;
  commandId: string;
};

export type PlayerProjection = {
  rulesetVersion: RulesetVersion;
  version: number;
  viewer: {
    id: EntityId;
    name: string;
    sceneId: SceneId;
    visitedSceneIds: SceneId[];
    timeline: TimelineState;
    rest?: RestAttempt;
    hp?: { current: number; max: number };
    ac: number;
    speedFeet: number;
    deathSaves: { successes: number; failures: number };
    activeEffects: string[];
    availableRollBoosts: Array<"guidance" | "inspiration" | "lucky">;
    resources: Array<{ id: string; current: number; max?: number }>;
    attacks: AttackProfile[];
  };
  visibleEntities: Array<{
    id: EntityId;
    name: string;
    kind: "player" | "npc";
    condition: "active" | "down" | "dead";
  }>;
  visibleArtifacts: Array<{ id: ArtifactId; name: string; status: "placed" | "held"; holderId?: EntityId }>;
  knowledge: Array<{ clueId: string; layer: ClueLayer }>;
  portals: Array<{ id: string; to: SceneId; state: PortalState }>;
  pendingRolls: Array<{
    id: string;
    ability: Ability;
    skill?: string;
    dc: number;
    mode: D20Mode;
    reason: string;
  }>;
  squad?: SquadState;
  squadInvites: SquadInviteState[];
  restVote?: RestVoteState;
  combat?: RulesCombatState;
  reachedEndings: Array<Pick<EndingDefinition, "id" | "name" | "outcome" | "publicText">>;
};
