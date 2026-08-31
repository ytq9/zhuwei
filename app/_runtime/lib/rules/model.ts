import type { Ability, D20Mode, Duration, RulesetVersion } from "./ruleset";

export type EntityId = string;
export type SceneId = string;
export type ModuleItemId = string;

export type Predicate =
  | { kind: "actorAt"; sceneId: SceneId }
  | { kind: "entityAt"; entityId: EntityId; sceneId: SceneId }
  | { kind: "itemAt"; itemId: ModuleItemId; sceneId: SceneId }
  | { kind: "itemHeldByActor"; itemId: ModuleItemId }
  | { kind: "itemHeldByEntity"; itemId: ModuleItemId; entityId: EntityId }
  | { kind: "portalState"; portalId: string; state: PortalState }
  | { kind: "flagEquals"; flag: string; value: string | number | boolean }
  | { kind: "actorKnows"; clueId: string; minimumLayer?: ClueLayer }
  | { kind: "actorHasCapability"; capability: string }
  | { kind: "not"; predicate: Predicate };

export type RuleEffect =
  | { kind: "transferItem"; itemId: ModuleItemId; to: "actor" }
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

/** Static module vocabulary. Active item state is owned only by the V5 ItemSystem. */
export type ModuleItemDefinition = {
  id: ModuleItemId;
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
      kind: "itemStatus";
      itemId: ModuleItemId;
      status: "placed" | "held" | "consumed" | "destroyed";
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
  items: ModuleItemDefinition[];
  interactions: InteractionDefinition[];
  npcInitialKnowledge: Record<EntityId, Record<string, ClueLayer>>;
  npcCapabilities: Record<EntityId, string[]>;
  npcPlans: NpcPlanDefinition[];
  scheduledEvents: ScheduledEventDefinition[];
  endings: EndingDefinition[];
};

export type ClueLayer = "hint" | "partial" | "full";
