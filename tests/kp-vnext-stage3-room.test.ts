import { encodeVNextStrictToolBundle } from "../app/_runtime/lib/kp/vnext/proposal-schema";
import { worldFactSocialBundle } from "./fixtures/vnext-world-facts.mjs";
import { frozenNarrationContextConform } from "../app/_runtime/lib/kp/narration-context";
import { VNEXT_SEMANTIC_TEMPLATES } from "../app/_runtime/lib/rules/profiles/semantic-templates";
import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  handleRoomAction,
  handleViewerNarrationRecovery,
  type RoomActionInput,
} from "../app/_runtime/lib/room/action";
import {
  VNEXT_MATERIALIZATION_FORM_ID,
  VNEXT_WORLD_INTERACTION_FORM_ID,
} from "../app/_runtime/lib/kp/vnext/proposals";
import {
  VNEXT1_PROPOSAL_BUNDLE_SCHEMA,
  validateVNextProposalBundle,
} from "../app/_runtime/lib/kp/vnext/proposal-bundle";
import {
  VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
  VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA,
} from "../app/_runtime/lib/kp/vnext/proposal-schema";
import { validateVNextProposalBundle as validateVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-validator";
import {
  applyVNextProposalBundleCorrection,
  repairableVNextProposalBundlePaths,
} from "../app/_runtime/lib/kp/vnext/proposal-correction";
import { canonicalHash } from "../app/_runtime/lib/kp/vnext/canonical-json";
import { npcDecisionContext } from "../app/_runtime/lib/kp/vnext/context/npc-decision";
import { authoritativeModuleProfile } from "../app/_runtime/lib/module/authoritative";
import type { VNextRequiredContext } from "../app/_runtime/lib/kp/vnext/required-context";
import {
  WORLD_INTERACTION_PROFILE,
} from "../app/_runtime/lib/rules/profiles/vnext-world-interaction";
import type { VersionedRulesRuntime } from "../app/_runtime/lib/rules/v2-runtime";
import {
  createDefinitionSnapshot,
  isStoredSemanticDefinition,
  semanticDefinitionSnapshot,
  storedSemanticDefinition,
  type SemanticDefinitionKind,
  type StoredSemanticDefinition,
} from "../app/_runtime/lib/rules/v2/semantic-definitions";
import { isItemDefinitionV1 } from "../app/_runtime/lib/rules/v2/items";
import { itemBundle, hazardBundle } from "./fixtures/vnext-authored-bundles.mjs";
import { sharedCheckBundle } from "./fixtures/vnext-shared-check.mjs";
import capturedItemWire from "./fixtures/deepseek-authored-item-wire.json";
import { parseSubmitKpProposalBundleArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider";

type JsonRecord = Record<string, unknown>;

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(principal: unknown, input: unknown): Promise<unknown>;
  commit(principal: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(principal: unknown, query?: unknown): Promise<unknown>;
  acknowledge(principal: unknown, deliveryId: string): Promise<unknown>;
  deliveryPublicationStatus(query: unknown): Promise<unknown>;
  beginDeliveryAudiencePublication(query: unknown): Promise<unknown>;
  failDeliveryAudiencePublication(authorization: unknown, failure: unknown): Promise<unknown>;
  publishDelivery(authorization: unknown, publication: unknown): Promise<unknown>;
  beginViewerNarrationRecovery(principal: unknown, capability: string): Promise<unknown>;
  publishViewerNarrationRecovery(
    principal: unknown,
    capability: string,
    publication: unknown,
  ): Promise<unknown>;
  failViewerNarrationRecovery(
    principal: unknown,
    capability: string,
    failure: unknown,
  ): Promise<unknown>;
};

type RoomInternals = Authority & {
  authorityRoll(sides: number): number;
  rulesRuntime: VersionedRulesRuntime;
  authoritativeReplay(): {
    state: JsonRecord;
    replay: JsonRecord;
  };
  authorityStore: {
    events(): JsonRecord[];
  };
};

type ActionCounters = {
  prepare: number;
  commit: number;
  beginPublication: number;
  publishDelivery: number;
  failedPublication: number;
  rolls: number;
};

type KpCounters = {
  propose: number;
  narrate: number;
  decideDueActorPlan: number;
};

type PreparedCapture = {
  latest?: JsonRecord;
  all: JsonRecord[];
};

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:stage3:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:stage3:bob", sessionVersion: 1 }),
});
const ALICE_ID = "character:stage3:alice";
const BOB_ID = "character:stage3:bob";
const LIAN_ID = "npc:black-oak-will:lian";
const SCENE_REF = "wake";

const NPC_DEFINITION_REF = "definition:stage3:npc:lian";
const NPC_KNOWLEDGE_REF = "knowledge:stage3:lian-saw-returned-ledger";
const PLAYER_SECRET_CANARY = "PLAYER-SECRET-CANARY-NPC-MUST-NOT-KNOW";
const NPC_SUMMARY_CANARY = "AUTHORITY-ONLY-NPC-SUMMARY-CANARY";

const PISTOL_DEFINITION_REF = "item-definition:stage3:pistol:1";
const AMMO_DEFINITION_REF = "item-definition:stage3:pistol-ammunition:1";
const STONE_DEFINITION_REF = "item-definition:stage3:testing-stone:1";
const FIRE_SOURCE_DEFINITION_REF = "item-definition:stage3:steady-fire-source:1";
const LIAN_LEDGER_DEFINITION_REF = "item-definition:stage3:lian-ledger:1";
const PISTOL_ENTRY_REF = "item-entry:stage3:pistol";
const AMMO_ENTRY_REF = "item-entry:stage3:pistol-ammunition";
const STONE_ENTRY_REF = "item-entry:stage3:testing-stone";
const FIRE_SOURCE_ENTRY_REF = "item-entry:stage3:steady-fire-source";
const LIAN_LEDGER_ENTRY_REF = "item-entry:stage3:lian-ledger";
const SCENE_LEDGER_ENTRY_REF = "item-entry:stage3:scene-ledger";

const CHAIN_REF = "feature:stage3:chandelier-chain";
const CHANDELIER_REF = "feature:stage3:chandelier";
const IMPACT_ZONE_REF = "zone:stage3:falling-impact";
const CHAIN_SUPPORT_REF = "relation:stage3:chain-supports-chandelier";
const HIDDEN_TARGET_RELATION_CANARY = "relation:stage3:HIDDEN-TARGET-CANARY";

const ROPE_REF = "feature:stage3:hemp-rope";
const WEIGHT_REF = "feature:stage3:suspended-weight";
const ROPE_SUPPORT_REF = "relation:stage3:rope-supports-weight";

const PRESSURE_PLATE_REF = "feature:stage3:pressure-plate";
const TRAP_MECHANISM_REF = "feature:stage3:hidden-trap-mechanism";
const HIDDEN_TRIGGER_RELATION_CANARY = "relation:stage3:HIDDEN-TRIGGER-CANARY";
const TRAP_SENSORY_EVIDENCE = "石头落下时压板下沉，墙缝传来一声清楚的机括轻响。";

function record(value: unknown, label: string): JsonRecord {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as JsonRecord;
}

function list(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), label).toBe(true);
  return value as unknown[];
}

function vnextRoom(name: string): Authority {
  return env.VNEXT_ROOMS.getByName(name) as unknown as Authority;
}

function semanticDefinition(
  semanticKind: SemanticDefinitionKind,
  definitionRef: string,
  visibilityPolicyRef: string,
  content: JsonRecord,
): StoredSemanticDefinition {
  const snapshot = createDefinitionSnapshot(definitionRef, "1", content);
  return storedSemanticDefinition(semanticKind, visibilityPolicyRef, snapshot, {
    templateRef: definitionRef,
    templateHash: snapshot.definitionHash,
  });
}

function sceneFeature(
  definitionRef: string,
  input: {
    label: string;
    description: string;
    materialDescription?: string;
    mechanicDefinitionRefs?: string[];
    observableState: string;
    affordances: string[];
    visibilityPolicyRef?: string;
  },
): StoredSemanticDefinition {
  return semanticDefinition(
    "sceneFeature",
    definitionRef,
    input.visibilityPolicyRef ?? "visibility:scene-observers",
    {
      sceneRef: SCENE_REF,
      label: input.label,
      description: input.description,
      ...(input.materialDescription === undefined
        ? {}
        : { materialDescription: input.materialDescription }),
      ...(input.mechanicDefinitionRefs === undefined
        ? {}
        : { mechanicDefinitionRefs: [...input.mechanicDefinitionRefs].sort() }),
      observableState: input.observableState,
      affordances: [...input.affordances],
    },
  );
}

function relation(
  definitionRef: string,
  kind: "supports" | "attachedTo" | "contains" | "blocks" | "triggers",
  subjectRef: string,
  objectRef: string,
  visibilityPolicyRef = "visibility:scene-observers",
): StoredSemanticDefinition {
  return semanticDefinition("worldRelation", definitionRef, visibilityPolicyRef, {
    relationRef: definitionRef,
    kind,
    subjectRef,
    objectRef,
    state: "active",
  });
}

function itemDefinitions(): JsonRecord[] {
  return [{
    schema: "zhuwei.item-definition/v1",
    definitionKind: "item",
    definitionId: PISTOL_DEFINITION_REF,
    revision: "1",
    rulesBasis: { kind: "zhuwei-product-ruling", profileRef: WORLD_INTERACTION_PROFILE },
    causalBasisRefs: [],
    visibilityPolicyRef: `visibility:character-controller:${ALICE_ID}`,
    content: {
      schema: "zhuwei.item-definition-content/v1",
      label: "燧发手枪",
      description: "一把可用的单手燧发手枪。",
      category: "weapon",
      aliases: [],
      tags: ["firearm", "stage3"],
      stackable: false,
      equipment: {
        allowedSlots: ["main"],
        twoHanded: false,
        armor: null,
        weapon: {
          attackAbility: "dex",
          ammunitionDefinitionRef: AMMO_DEFINITION_REF,
          damageDice: "1d10",
          damageType: "piercing",
          reachInches: null,
          rangeNormalInches: "1200",
          rangeLongInches: "3600",
          requiresSight: true,
        },
      },
      equippedAbilityRefs: [],
      use: null,
      chargesMaximum: null,
      durabilityMaximum: null,
    },
  }, {
    schema: "zhuwei.item-definition/v1",
    definitionKind: "item",
    definitionId: LIAN_LEDGER_DEFINITION_REF,
    revision: "1",
    rulesBasis: { kind: "zhuwei-product-ruling", profileRef: WORLD_INTERACTION_PROFILE },
    causalBasisRefs: [],
    visibilityPolicyRef: "visibility:scene-observers",
    content: {
      schema: "zhuwei.item-definition-content/v1",
      label: "归还的账册",
      description: "莉安正在核对的旧账册，封面带着新近归还留下的泥痕。",
      category: "object",
      aliases: [],
      tags: ["ledger", "stage3"],
      stackable: false,
      equipment: null,
      equippedAbilityRefs: [],
      use: null,
      chargesMaximum: null,
      durabilityMaximum: null,
    },
  }, {
    schema: "zhuwei.item-definition/v1",
    definitionKind: "item",
    definitionId: FIRE_SOURCE_DEFINITION_REF,
    revision: "1",
    rulesBasis: { kind: "zhuwei-product-ruling", profileRef: WORLD_INTERACTION_PROFILE },
    causalBasisRefs: [],
    visibilityPolicyRef: `visibility:character-controller:${ALICE_ID}`,
    content: {
      schema: "zhuwei.item-definition-content/v1",
      label: "稳定燃烧的火把",
      description: "一支已经点燃、火焰稳定且当前可用的普通火把。",
      category: "tool",
      aliases: [],
      tags: ["fire-source", "stage3"],
      stackable: false,
      equipment: null,
      equippedAbilityRefs: [],
      use: null,
      chargesMaximum: null,
      durabilityMaximum: null,
    },
  }, {
    schema: "zhuwei.item-definition/v1",
    definitionKind: "item",
    definitionId: AMMO_DEFINITION_REF,
    revision: "1",
    rulesBasis: { kind: "zhuwei-product-ruling", profileRef: WORLD_INTERACTION_PROFILE },
    causalBasisRefs: [],
    visibilityPolicyRef: `visibility:character-controller:${ALICE_ID}`,
    content: {
      schema: "zhuwei.item-definition-content/v1",
      label: "手枪弹药",
      description: "与燧发手枪配套的弹丸与火药。",
      category: "ammunition",
      aliases: [],
      tags: ["ammunition", "stage3"],
      stackable: true,
      equipment: {
        allowedSlots: ["ammo"],
        twoHanded: false,
        armor: null,
        weapon: null,
      },
      equippedAbilityRefs: [],
      use: null,
      chargesMaximum: null,
      durabilityMaximum: null,
    },
  }, {
    schema: "zhuwei.item-definition/v1",
    definitionKind: "item",
    definitionId: STONE_DEFINITION_REF,
    revision: "1",
    rulesBasis: { kind: "zhuwei-product-ruling", profileRef: WORLD_INTERACTION_PROFILE },
    causalBasisRefs: [],
    visibilityPolicyRef: `visibility:character-controller:${ALICE_ID}`,
    content: {
      schema: "zhuwei.item-definition-content/v1",
      label: "测试用石块",
      description: "一块拳头大小、可以投掷的普通石头。",
      category: "object",
      aliases: [],
      tags: ["stage3", "testing"],
      stackable: false,
      equipment: null,
      equippedAbilityRefs: [],
      use: null,
      chargesMaximum: null,
      durabilityMaximum: null,
    },
  }];
}

function worldSeed(npcHazardTarget = false): {
  vNextSeed: JsonRecord;
  initialNpcDefinition: StoredSemanticDefinition;
} {
  const npc = semanticDefinition(
    "npc",
    NPC_DEFINITION_REF,
    "visibility:scene-observers",
    {
      label: "莉安·黑橡",
      description: "她认出了新归还的账册，但仍保持警惕。",
      links: { entityRef: LIAN_ID },
      semantics: {
        attitude: "警惕而克制",
        goals: [{ goalRef: "goal:stage3:protect-home", description: "守住房屋与家人留下的秘密。" }],
        plans: [{ planRef: "plan:stage3:inspect-ledger", description: "核对账册上的新痕迹。" }],
      },
      privateNotes: PLAYER_SECRET_CANARY,
    },
  );
  const semanticDefinitions: StoredSemanticDefinition[] = [
    npc,
    sceneFeature(CHAIN_REF, {
      label: "吊灯铁链",
      description: "一条把吊灯固定在横梁上的旧铁链。",
      materialDescription: "D&D 5e 世界中的普通锻铁，链环已有锈迹。",
      mechanicDefinitionRefs: ["feature:wake:hearth"],
      observableState: "仍在承重",
      affordances: ["可以瞄准链环", "可以近距离检查"],
    }),
    sceneFeature(CHANDELIER_REF, {
      label: "悬挂吊灯",
      description: "沉重吊灯悬在房间中央。",
      materialDescription: "木制灯架包有普通铁件。",
      mechanicDefinitionRefs: ["feature:wake:hearth"],
      observableState: "悬挂在半空",
      affordances: ["可以观察下方区域"],
    }),
    sceneFeature(IMPACT_ZONE_REF, {
      label: "吊物下方区域",
      description: "吊灯或重物一旦坠落就会覆盖的地面区域。",
      observableState: "有人站在下方",
      affordances: ["可以离开坠落区域"],
    }),
    relation(CHAIN_SUPPORT_REF, "supports", CHAIN_REF, CHANDELIER_REF),
    relation(
      HIDDEN_TARGET_RELATION_CANARY,
      "contains",
      IMPACT_ZONE_REF,
      npcHazardTarget ? LIAN_ID : BOB_ID,
      "visibility:room-authority-only",
    ),
    sceneFeature(ROPE_REF, {
      label: "干燥麻绳",
      description: "一条绷紧的麻绳吊着沉重石块。",
      materialDescription: "D&D 5e 世界中的普通干燥麻绳。",
      observableState: "绷紧并承重",
      affordances: ["可以点燃", "可以切断"],
    }),
    sceneFeature(WEIGHT_REF, {
      label: "悬挂重物",
      description: "一块沉重石块悬在麻绳下方。",
      materialDescription: "普通石材。",
      observableState: "悬挂在半空",
      affordances: ["可以让其坠落"],
    }),
    relation(ROPE_SUPPORT_REF, "supports", ROPE_REF, WEIGHT_REF),
    sceneFeature(PRESSURE_PLATE_REF, {
      label: "覆尘压板",
      description: "地面有一块边缘留着细缝的石板。",
      materialDescription: "普通石材表面覆有薄尘。",
      observableState: "尚未被压下",
      affordances: ["可以隔着距离施加重量", "可以检查边缘"],
    }),
    sceneFeature(TRAP_MECHANISM_REF, {
      label: "隐藏机关",
      description: "压板下方连接着未公开的机关。",
      observableState: "待触发",
      affordances: ["可以被压板触发"],
      visibilityPolicyRef: "visibility:room-authority-only",
    }),
    relation(
      HIDDEN_TRIGGER_RELATION_CANARY,
      "triggers",
      PRESSURE_PLATE_REF,
      TRAP_MECHANISM_REF,
      "visibility:room-authority-only",
    ),
  ];
  return {
    initialNpcDefinition: npc,
    vNextSeed: {
      semanticDefinitions,
      itemDefinitions: itemDefinitions(),
      itemEntries: [{
        definitionRef: PISTOL_DEFINITION_REF,
        entry: {
          entryId: PISTOL_ENTRY_REF,
          quantity: 1,
          placement: { kind: "held", holderRef: ALICE_ID, equippedSlot: "main" },
          ownership: { kind: "character", ownerRef: ALICE_ID },
          visibilityPolicyRef: `visibility:character-controller:${ALICE_ID}`,
        },
      }, {
        definitionRef: AMMO_DEFINITION_REF,
        entry: {
          entryId: AMMO_ENTRY_REF,
          quantity: 8,
          placement: { kind: "held", holderRef: ALICE_ID, equippedSlot: "ammo" },
          ownership: { kind: "character", ownerRef: ALICE_ID },
          visibilityPolicyRef: `visibility:character-controller:${ALICE_ID}`,
        },
      }, {
        definitionRef: FIRE_SOURCE_DEFINITION_REF,
        entry: {
          entryId: FIRE_SOURCE_ENTRY_REF,
          quantity: 1,
          placement: { kind: "held", holderRef: ALICE_ID, equippedSlot: null },
          ownership: { kind: "character", ownerRef: ALICE_ID },
          visibilityPolicyRef: `visibility:character-controller:${ALICE_ID}`,
        },
      }, {
        definitionRef: LIAN_LEDGER_DEFINITION_REF,
        entry: {
          entryId: LIAN_LEDGER_ENTRY_REF,
          quantity: 1,
          placement: { kind: "held", holderRef: LIAN_ID, equippedSlot: null },
          ownership: { kind: "character", ownerRef: LIAN_ID },
          visibilityPolicyRef: "visibility:scene-observers",
        },
      }, {
        definitionRef: LIAN_LEDGER_DEFINITION_REF,
        entry: {
          entryId: SCENE_LEDGER_ENTRY_REF,
          quantity: 1,
          placement: { kind: "scene", sceneRef: SCENE_REF },
          ownership: { kind: "unowned", ownerRef: null },
          visibilityPolicyRef: "visibility:scene-observers",
        },
      }, {
        definitionRef: STONE_DEFINITION_REF,
        entry: {
          entryId: STONE_ENTRY_REF,
          quantity: 1,
          placement: { kind: "held", holderRef: ALICE_ID, equippedSlot: null },
          ownership: { kind: "character", ownerRef: ALICE_ID },
          visibilityPolicyRef: `visibility:character-controller:${ALICE_ID}`,
        },
      }],
      entityDefinitionBindings: [{ entityRef: LIAN_ID, definitionRef: NPC_DEFINITION_REF }],
    },
  };
}

function character(characterId: string, principalId: string, name: string, dexterity: number) {
  return {
    characterId,
    controllerPrincipalId: principalId,
    staticCard: {
      name,
      sceneId: SCENE_REF,
      level: 3,
      classId: "fighter",
      raceId: "human",
      subclassId: "champion",
      scores: { str: 12, dex: dexterity, con: 12, int: 10, wis: 12, cha: 10 },
      proficiency: 2,
      skills: ["perception"],
      hp: { current: 20, max: 20, temp: 0 },
      ac: 13,
      speed: 30,
      equipped: {},
      backpack: [],
    },
  };
}

async function initializeRoom(name: string, aliceHitPoints = 20, bobHitPoints = 20, npcHazardTarget = false) {
  const authority = vnextRoom(name);
  const seed = worldSeed(npcHazardTarget);
  const semanticDefinitions = seed.vNextSeed.semanticDefinitions as unknown[];
  const seededItemDefinitions = seed.vNextSeed.itemDefinitions as unknown[];
  expect(semanticDefinitions.every(isStoredSemanticDefinition), "semantic seed conformance").toBe(true);
  expect(seededItemDefinitions.every(isItemDefinitionV1), "item seed conformance").toBe(true);
  const initializationInput = {
    roomId: name,
    moduleId: "black-oak-will",
    members: [
      { principalId: ALICE.principal.id, role: "host" },
      { principalId: BOB.principal.id, role: "player" },
    ],
    characters: [
      character(ALICE_ID, ALICE.principal.id, "阿莱莎", 16),
      character(BOB_ID, BOB.principal.id, "站在吊物下方的对手", 12),
    ],
    fixtureFacts: [{
      knowledgeRef: NPC_KNOWLEDGE_REF,
      holderEntityId: LIAN_ID,
      holderName: "莉安·黑橡",
      sceneId: SCENE_REF,
      content: {
        kind: "observedReturnedLedger",
        statement: "莉安亲眼看见阿莱莎归还了父亲的账册。",
      },
    }, {
      knowledgeRef: "knowledge:stage3:alice-private",
      holderEntityId: ALICE_ID,
      content: PLAYER_SECRET_CANARY,
    }],
    vNextSeed: seed.vNextSeed,
  };
  initializationInput.characters[0]!.staticCard.hp.current = aliceHitPoints;
  initializationInput.characters[1]!.staticCard.hp.current = bobHitPoints;
  const initialized = record(await authority.initializeAuthoritative(initializationInput), `${name} initialization`);
  expect(initialized, JSON.stringify(initialized)).toMatchObject({ created: true });
  return { authority, seed };
}

function emptyActionCounters(): ActionCounters {
  return {
    prepare: 0,
    commit: 0,
    beginPublication: 0,
    publishDelivery: 0,
    failedPublication: 0,
    rolls: 0,
  };
}

function instrumentAuthority(
  target: Authority,
  counters: ActionCounters,
  prepared: PreparedCapture,
): Authority {
  return {
    initializeAuthoritative: (input) => target.initializeAuthoritative(input),
    async prepare(principal, input) {
      counters.prepare += 1;
      const result = await target.prepare(principal, input);
      if (result !== null && typeof result === "object" && !Array.isArray(result)) {
        const snapshot = structuredClone(result) as JsonRecord;
        if (snapshot.kind === "prepared") {
          prepared.latest = snapshot;
          prepared.all.push(snapshot);
        }
      }
      return result;
    },
    async commit(principal, preparedActionId, proposal) {
      counters.commit += 1;
      return target.commit(principal, preparedActionId, proposal);
    },
    observe: (principal, query) => target.observe(principal, query),
    acknowledge: (principal, deliveryId) => target.acknowledge(principal, deliveryId),
    deliveryPublicationStatus: (query) => target.deliveryPublicationStatus(query),
    async beginDeliveryAudiencePublication(query) {
      counters.beginPublication += 1;
      return target.beginDeliveryAudiencePublication(query);
    },
    async failDeliveryAudiencePublication(authorization, failure) {
      counters.failedPublication += 1;
      return target.failDeliveryAudiencePublication(authorization, failure);
    },
    async publishDelivery(authorization, publication) {
      counters.publishDelivery += 1;
      return target.publishDelivery(authorization, publication);
    },
    beginViewerNarrationRecovery: (principal, capability) =>
      target.beginViewerNarrationRecovery(principal, capability),
    publishViewerNarrationRecovery: (principal, capability, publication) =>
      target.publishViewerNarrationRecovery(principal, capability, publication),
    failViewerNarrationRecovery: (principal, capability, failure) =>
      target.failViewerNarrationRecovery(principal, capability, failure),
  };
}

function requiredContext(request: JsonRecord): VNextRequiredContext {
  const context = record(request.requiredContext, "frozen RequiredContext");
  expect(context.schema).toBe("zhuwei.adjudication-context/vnext-1");
  return context as unknown as VNextRequiredContext;
}

function contextEntry(context: VNextRequiredContext, entryRef: string): JsonRecord {
  const entry = context.entries.find((candidate) => candidate.entryRef === entryRef);
  expect(entry, `RequiredContext entry ${entryRef}`).toBeDefined();
  expect(entry?.kind, `RequiredContext entry ${entryRef}`).toBe("known");
  return record((entry as { value?: unknown }).value, `RequiredContext value ${entryRef}`);
}

function singleProposalBundleEntry(value: JsonRecord): JsonRecord {
  expect(value).toMatchObject({
    schema: VNEXT1_PROPOSAL_BUNDLE_SCHEMA,
    kind: "proposalBundle",
  });
  const entries = list(value.proposals, "proposal bundle entries");
  expect(entries).toHaveLength(1);
  return record(entries[0], "single proposal bundle entry");
}

function pistolAbility(context: VNextRequiredContext): string {
  const abilityRef = context.references.domains.abilityRefs.find((candidate) => {
    const entry = context.entries.find(({ entryRef }) => entryRef === candidate);
    return entry?.kind === "known"
      && typeof (entry.value as JsonRecord).mechanicalKey === "string"
      && String((entry.value as JsonRecord).mechanicalKey).includes(PISTOL_ENTRY_REF);
  });
  expect(abilityRef, "pistol AbilityDefinition selected from RequiredContext").toBeDefined();
  const definition = contextEntry(context, abilityRef!);
  expect(definition).toMatchObject({
    activation: { kind: "attack" },
    target: { kind: "creatureOrEnvironmentFeature" },
    costs: [{ kind: "item", resourceId: AMMO_ENTRY_REF, amount: "1" }],
  });
  return abilityRef!;
}

type ProposalBuilder = (request: JsonRecord) => JsonRecord;

class DeterministicKp {
  readonly counters: KpCounters = { propose: 0, narrate: 0, decideDueActorPlan: 0 };
  readonly proposalRequests: JsonRecord[] = [];
  readonly narrationRequests: JsonRecord[] = [];
  private failedViewer = false;

  constructor(
    private readonly buildProposal: ProposalBuilder,
    private readonly prepared: PreparedCapture,
    private readonly failViewerKeyOnce?: string,
    private readonly validateFixtureProposal = true,
  ) {}

  async propose(requestValue: JsonRecord) {
    this.counters.propose += 1;
    const request = structuredClone(requestValue);
    this.proposalRequests.push(request);
    const frozen = requiredContext(request);
    expect(request).not.toHaveProperty("input");
    expect(request).not.toHaveProperty("projection");
    const preparedContext = record(this.prepared.latest?.requiredContext, "prepared RequiredContext");
    expect(frozen).toEqual(preparedContext);
    expect(frozen.binding.preparedActionId).toBe(request.preparedActionId);
    expect(frozen.binding.rootActionId).toBe(request.rootActionId);
    const proposal = this.buildProposal(request);
    if (this.validateFixtureProposal) {
      const validation = validateVNextProposalBundle(proposal);
      expect(validation, JSON.stringify(validation)).toMatchObject({ kind: "accepted" });
    }
    return proposal;
  }

  async decideDueActorPlan() {
    this.counters.decideDueActorPlan += 1;
    throw new Error("stage-three fixture must not use a second NPC mechanics path");
  }

  async narrate(requestValue: JsonRecord) {
    this.counters.narrate += 1;
    const request = structuredClone(requestValue);
    this.narrationRequests.push(request);
    expect(request).not.toHaveProperty("projection");
    expect(request).not.toHaveProperty("worldState");
    expect(request).not.toHaveProperty("committedDelta");
    expect(request).not.toHaveProperty("audienceId");
    expect(Object.keys(request).sort()).toEqual([
      "deliveryGeneration",
      "narrationInputMode",
      "narrationContext",
      ...(request.narrationPurpose === undefined ? [] : ["narrationPurpose"]),
      "receipt",
      "renderableClaims",
      "rootActionId",
      "viewerKey",
    ].sort());
    expect(request.narrationInputMode).toBe("frozenRenderableClaims-vnext-1");
    const claims = record(request.renderableClaims, "FrozenRenderableClaims narration input");
    expect(claims).toMatchObject({
      schema: "zhuwei.renderable-claims/vnext-1",
      receiptId: record(request.receipt, "narration Receipt").receiptId,
      rootActionId: request.rootActionId,
      viewerKey: request.viewerKey,
      projectionHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      claimsHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      claims: expect.any(Array),
    });
    expect(frozenNarrationContextConform(request.narrationContext, claims as never)).toBe(true);
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain(HIDDEN_TARGET_RELATION_CANARY);
    expect(serialized).not.toContain(HIDDEN_TRIGGER_RELATION_CANARY);
    expect(serialized).not.toContain(PLAYER_SECRET_CANARY);
    expect(serialized).not.toContain(NPC_SUMMARY_CANARY);

    if (!this.failedViewer
      && this.failViewerKeyOnce !== undefined
      && request.viewerKey === this.failViewerKeyOnce) {
      this.failedViewer = true;
      throw Object.assign(new Error("deterministic narration timeout"), {
        code: "modelTransient",
      });
    }
    const body = { body: `已依据 ${String(claims.claimsHash)} 冻结材料叙述。` };
    return body;
  }
}

function npcRevisionProposal(
  request: JsonRecord,
  overrides: { staleBase?: StoredSemanticDefinition } = {},
): JsonRecord {
  const context = requiredContext(request);
  const stored = contextEntry(context, NPC_DEFINITION_REF) as unknown as StoredSemanticDefinition;
  const snapshot = semanticDefinitionSnapshot(stored);
  expect(snapshot, "current NPC semantic snapshot").toBeDefined();
  const selected = overrides.staleBase === undefined
    ? stored
    : overrides.staleBase;
  return {
    schema: VNEXT1_PROPOSAL_BUNDLE_SCHEMA,
    kind: "proposalBundle",
    proposals: [{
      formId: VNEXT_MATERIALIZATION_FORM_ID,
      proposalRef: `proposal:npc-revision:${String(request.rootActionId)}`,
      basisRefs: [context.references.citations.npcKnowledge.find(({ npcRef }) => npcRef === LIAN_ID)!.refs
        .find(ref => ref === `knowledge:${LIAN_ID}:${NPC_KNOWLEDGE_REF}`)!],
      consumes: [],
      produces: [],
      outcomeBinding: "always",
      ruling: {
        kind: "directSuccess",
        risk: "本次修订只改变已允许的 NPC 语义字段。",
        successOutcome: "NPC 的新定义版本将被原子提交。",
        failureOutcome: "不产生定义修订。",
      },
      proposal: {
        kind: "reviseSemanticDefinition",
        definitionRef: NPC_DEFINITION_REF,
        semanticKind: "npc",
        npcRef: LIAN_ID,
        baseRevision: selected.revision,
        baseHash: selected.definitionHash,
        templateRef: selected.templateRef,
        templateHash: selected.templateHash,
        operations: [{
          kind: "set",
          path: ["semantics", "attitude"],
          value: "确认账册后愿意谨慎协助",
        }],
        summary: NPC_SUMMARY_CANARY,
      },
    }],
  };
}

function retiredCoarseNpcRevisionProposal(request: JsonRecord): JsonRecord {
  const context = requiredContext(request);
  const entry = singleProposalBundleEntry(npcRevisionProposal(request));
  return {
    schema: "zhuwei.kp-coarse-form-proposal/vnext-1",
    kind: "vnextCoarseFormProposal",
    formId: entry.formId,
    proposalRef: entry.proposalRef,
    contextHash: context.binding.contextHash,
    basisRefs: entry.basisRefs,
    proposal: entry.proposal,
  };
}

type WorldProposalConfig = {
  proposalRef: string;
  targetRefs: string[];
  directTargetRefs: string[];
  instrumentRefs: string[];
  ability: "pistol" | null;
  intent: string;
  method: string;
  dc?: number;
  successEffects: JsonRecord[];
  failureEffects?: JsonRecord[];
  successEvidence: string;
  failureEvidence: string;
  evidenceSubjectRef: string;
  sensoryBasisRefs?: string[];
  basisRefs: string[];
  pressure: string;
  opportunity: string;
};

function worldInteractionProposal(request: JsonRecord, config: WorldProposalConfig): JsonRecord {
  const context = requiredContext(request);
  const abilityRef = config.ability === "pistol" ? pistolAbility(context) : null;
  const ruling = config.dc === undefined
    ? {
        kind: "directSuccess",
        risk: "已根据冻结对象语义判断该做法可以直接产生所述结果。",
        successOutcome: "互动产生预先固化的成功后果。",
        failureOutcome: "没有失败分支。",
      }
    : {
        kind: "check",
        checkKind: "attack",
        ability: "dex",
        skill: null,
        dc: config.dc,
        mode: "normal",
        risk: "会消耗一次弹药；命中才会改变支撑关系。",
        successOutcome: "支撑关系结束，吊物按已存在区域结算。",
        failureOutcome: "弹药仍消耗，但支撑关系和吊物状态保持不变。",
      };
  const branch = (
    name: "success" | "failure",
    effects: JsonRecord[],
    evidence: string,
  ) => ({
    outcomeCode: `outcome:stage3:${config.proposalRef}:${name}`,
    summary: name === "success" ? "冻结成功分支已经结算。" : "冻结失败分支已经结算。",
    effects,
    sensoryEvidence: [{
      observerRef: ALICE_ID,
      subjectRef: config.evidenceSubjectRef,
      sense: "sight",
      evidence,
      basisRefs: config.sensoryBasisRefs ?? [config.evidenceSubjectRef],
    }],
    pressures: [{
      description: config.pressure,
      sourceRef: config.evidenceSubjectRef,
      basisRefs: [SCENE_REF],
    }],
    opportunities: [{
      description: config.opportunity,
      targetRef: config.evidenceSubjectRef,
      actionHint: "玩家仍可选择其他自然语言做法。",
      basisRefs: [config.evidenceSubjectRef],
    }],
  });
  return {
    schema: VNEXT1_PROPOSAL_BUNDLE_SCHEMA,
    kind: "proposalBundle",
    proposals: [{
      formId: VNEXT_WORLD_INTERACTION_FORM_ID,
      proposalRef: config.proposalRef,
      basisRefs: [...config.basisRefs],
      consumes: [],
      produces: [],
      outcomeBinding: "always",
      ruling,
      proposal: {
        kind: "worldInteraction",
        sceneRef: SCENE_REF,
        targetRefs: [...config.targetRefs],
        directTargetRefs: [...config.directTargetRefs],
        instrumentRefs: [...config.instrumentRefs],
        abilityRef,
        intent: config.intent,
        method: config.method,
        branches: {
          success: branch("success", config.successEffects, config.successEvidence),
          failure: branch("failure", config.failureEffects ?? [], config.failureEvidence),
        },
      },
    }],
  };
}

function gunProposal(request: JsonRecord, dc: number): JsonRecord {
  return worldInteractionProposal(request, {
    proposalRef: `proposal:stage3:gun:${String(request.rootActionId)}`,
    targetRefs: [CHAIN_REF, CHANDELIER_REF],
    directTargetRefs: [CHAIN_REF],
    instrumentRefs: [PISTOL_ENTRY_REF],
    ability: "pistol",
    intent: "打断吊灯的支撑，使它砸向下方区域。",
    method: "使用已持有的燧发手枪瞄准可见铁链。",
    dc,
    basisRefs: [SCENE_REF, CHAIN_REF, CHANDELIER_REF, CHAIN_SUPPORT_REF],
    successEffects: [{
      kind: "relationTransition",
      relationRef: CHAIN_SUPPORT_REF,
      toState: "ended",
    }, {
      kind: "definitionRevision",
      definitionRef: CHANDELIER_REF,
      operations: [{ kind: "set", path: ["observableState"], value: "已坠落并形成残骸" }],
      summary: "吊灯不再悬挂。",
    }, {
      kind: "registeredHazard",
      sourceDefinitionRef: CHANDELIER_REF,
      zoneRef: IMPACT_ZONE_REF,
      damage: { kind: "profile", damageProfileRef: "world-damage:falling-object:moderate" },
    }],
    successEvidence: "枪响后铁链断开，吊灯砸落在地。",
    failureEvidence: "枪响后铁链仍然承重，吊灯只轻微晃动。",
    evidenceSubjectRef: CHANDELIER_REF,
    pressure: "枪声已经在房间内造成明显动静。",
    opportunity: "坠落区域与残骸形成了新的可互动局面。",
  });
}

function ropeProposal(request: JsonRecord): JsonRecord {
  return worldInteractionProposal(request, {
    proposalRef: `proposal:stage3:rope:${String(request.rootActionId)}`,
    targetRefs: [ROPE_REF, WEIGHT_REF],
    directTargetRefs: [ROPE_REF],
    instrumentRefs: [FIRE_SOURCE_ENTRY_REF],
    ability: null,
    intent: "烧断麻绳使重物坠落。",
    method: "用稳定火源持续灼烧已知为干燥麻绳的承重点。",
    basisRefs: [
      SCENE_REF,
      FIRE_SOURCE_ENTRY_REF,
      ROPE_REF,
      WEIGHT_REF,
      ROPE_SUPPORT_REF,
    ],
    successEffects: [{
      kind: "relationTransition",
      relationRef: ROPE_SUPPORT_REF,
      toState: "ended",
    }, {
      kind: "definitionRevision",
      definitionRef: WEIGHT_REF,
      operations: [{ kind: "set", path: ["observableState"], value: "已经坠落在地" }],
      summary: "重物已经坠落。",
    }, {
      kind: "registeredHazard",
      sourceDefinitionRef: WEIGHT_REF,
      zoneRef: IMPACT_ZONE_REF,
      damage: { kind: "profile", damageProfileRef: "world-damage:falling-object:moderate" },
    }],
    successEvidence: "麻绳焦黑断裂，重物随即坠地。",
    failureEvidence: "麻绳表面焦黑但仍未断裂。",
    evidenceSubjectRef: ROPE_REF,
    pressure: "燃烧产生的烟味正在扩散。",
    opportunity: "断裂后的绳端和坠落重物都可以继续利用。",
  });
}

function trapProbeProposal(request: JsonRecord): JsonRecord {
  return worldInteractionProposal(request, {
    proposalRef: `proposal:stage3:trap-probe:${String(request.rootActionId)}`,
    targetRefs: [PRESSURE_PLATE_REF],
    directTargetRefs: [PRESSURE_PLATE_REF],
    instrumentRefs: [STONE_ENTRY_REF],
    ability: null,
    intent: "隔着距离用石头测试压板是否会触发机关。",
    method: "把拳头大小的石头投到覆尘压板上，并观察具体感官证据。",
    basisRefs: [
      SCENE_REF,
      PRESSURE_PLATE_REF,
      STONE_ENTRY_REF,
      HIDDEN_TRIGGER_RELATION_CANARY,
    ],
    sensoryBasisRefs: [PRESSURE_PLATE_REF, HIDDEN_TRIGGER_RELATION_CANARY],
    successEffects: [{
      kind: "definitionRevision",
      definitionRef: PRESSURE_PLATE_REF,
      operations: [{ kind: "set", path: ["observableState"], value: "被石头压下后又缓慢复位" }],
      summary: "压板发生了可见位移。",
    }],
    successEvidence: TRAP_SENSORY_EVIDENCE,
    failureEvidence: "石头落下后压板没有出现可见位移，也没有听见机括声。",
    evidenceSubjectRef: PRESSURE_PLATE_REF,
    pressure: "压板是否连接危险装置仍需依据后续证据判断。",
    opportunity: "角色可以继续检查墙缝声响的来源。",
  });
}

const ALCOVE_HANDLE = "prospective:stage3-new-alcove";
const ALCOVE_UNPRODUCED_HANDLE = "prospective:stage3-unproduced-handle";

// Both entries of an atomic Bundle must share byte-identical rulings
// (validateVNextProposalBundle/lowerAtomicMultiStep compare their canonical
// hash), so the materialize and interact proposals below reuse this same
// object rather than each writing out their own risk/outcome text.
const ALCOVE_SHARED_RULING: JsonRecord = Object.freeze({
  kind: "directSuccess",
  risk: "让一个先前没被注意到的壁龛显形并靠近查看，不会带来额外风险。",
  successOutcome: "壁龛作为新的场景对象被固化，角色随即查看了它的内部。",
  failureOutcome: "不会产生新的场景对象，也不会发生查看。",
});

function materializeAlcoveProposal(
  request: JsonRecord,
  overrides: { produces?: JsonRecord[] } = {},
): JsonRecord {
  return {
    formId: VNEXT_MATERIALIZATION_FORM_ID,
    proposalRef: `proposal:stage3:materialize-alcove:${String(request.rootActionId)}`,
    basisRefs: [SCENE_REF],
    consumes: [],
    produces: overrides.produces ?? [
      { handle: ALCOVE_HANDLE, kind: "semanticDefinition", outcomeBinding: "always" },
    ],
    outcomeBinding: "always",
    ruling: ALCOVE_SHARED_RULING,
    proposal: {
      kind: "materializeObject",
      semanticKind: "sceneFeature",
      templateRef: VNEXT_SEMANTIC_TEMPLATES.sceneFeature.templateRef,
      templateHash: VNEXT_SEMANTIC_TEMPLATES.sceneFeature.templateHash,
      visibilityPolicyRef: "visibility:scene-observers",
      definition: {
        sceneRef: SCENE_REF,
        visibilityFactId: null,
        label: "新出现的壁龛",
        description: "墙面上露出一个先前没有被注意到的浅壁龛。",
        observableState: "刚刚露出",
        affordances: ["可以靠近查看"],
        mechanicDefinitionRefs: [],
      },
      summary: "根据角色仔细检查墙面，固化出一个新的可互动壁龛。",
    },
  };
}

function inspectAlcoveProposal(request: JsonRecord, handle: string): JsonRecord {
  const branch = (name: "success" | "failure") => ({
    outcomeCode: `outcome:stage3:inspect-alcove:${name}`,
    summary: name === "success" ? "角色查看了新出现的壁龛内部。" : "没有发生什么特别的事。",
    effects: [],
    sensoryEvidence: [{
      observerRef: ALICE_ID,
      subjectRef: null,
      sense: "sight",
      evidence: "壁龛内壁干净，没有藏着别的东西。",
      basisRefs: [SCENE_REF],
    }],
    pressures: [],
    opportunities: [],
  });
  return {
    formId: VNEXT_WORLD_INTERACTION_FORM_ID,
    proposalRef: `proposal:stage3:inspect-alcove:${String(request.rootActionId)}`,
    basisRefs: [SCENE_REF],
    consumes: [{ kind: "prospective", handle }],
    produces: [],
    outcomeBinding: "always",
    ruling: ALCOVE_SHARED_RULING,
    proposal: {
      kind: "worldInteraction",
      sceneRef: SCENE_REF,
      targetRefs: [handle],
      directTargetRefs: [handle],
      instrumentRefs: [],
      abilityRef: null,
      intent: "靠近查看墙面新出现的浅壁龛。",
      method: "伸手探查壁龛内部。",
      branches: { success: branch("success"), failure: branch("failure") },
    },
  };
}

/** materialize + interact, atomically: goal 1's representative vertical. */
function materializeAndInspectAlcoveProposal(request: JsonRecord): JsonRecord {
  return {
    schema: VNEXT1_PROPOSAL_BUNDLE_SCHEMA,
    kind: "proposalBundle",
    proposals: [
      materializeAlcoveProposal(request),
      inspectAlcoveProposal(request, ALCOVE_HANDLE),
    ],
  };
}

/** Same two Forms, but the interact entry consumes a handle nothing in the
 * Bundle produces -- a broken produces/consumes graph, used to prove that an
 * otherwise independently-valid materialize step never commits alone when
 * its atomic partner cannot attach to it. */
function materializeAndInspectBrokenGraphProposal(request: JsonRecord): JsonRecord {
  return {
    schema: VNEXT1_PROPOSAL_BUNDLE_SCHEMA,
    kind: "proposalBundle",
    proposals: [
      materializeAlcoveProposal(request),
      inspectAlcoveProposal(request, ALCOVE_UNPRODUCED_HANDLE),
    ],
  };
}

/** The same materialize entry submitted alone, to independently prove it is
 * not itself the reason the broken-graph Bundle above fails to commit. */
function materializeAlcoveAloneProposal(request: JsonRecord): JsonRecord {
  return {
    schema: VNEXT1_PROPOSAL_BUNDLE_SCHEMA,
    kind: "proposalBundle",
    proposals: [materializeAlcoveProposal(request)],
  };
}

// -- vnext-2 shared-check fixtures ---------------------------------------
// One roll decides the whole Bundle. ALICE has str 12, so an abilityCheck on
// str with no skill carries a +1 modifier: against DC 13 a face of 18 totals
// 19 and succeeds, a face of 3 totals 4 and fails. Both branches are
// therefore reachable, which the Rules preflight requires before it will
// request any randomness at all.

const CACHE_HANDLE_V2 = "prospective:stage3-alcove-cache-v2";

const ALCOVE_SHARED_CHECK_V2: JsonRecord = Object.freeze({
  kind: "check", durationMicros: "300000000",
  checkKind: "abilityCheck",
  ability: "str",
  skill: null,
  dc: 13,
  mode: "normal",
  risk: "壁龛内壁的石板卡得很紧，硬掰可能撬开，也可能纹丝不动。",
  successOutcome: "石板被撬开，露出后面的暗格。",
  failureOutcome: "石板纹丝不动，只掉下些许石屑。",
});

const ALCOVE_SHARED_HIGH_RISK_V2: JsonRecord = Object.freeze({
  kind: "highRisk",
  risk: "硬撬石板可能让整面墙塌下来。",
  confirmationQuestion: "确定要用力撬这块石板吗？",
  successOutcome: "石板被撬开，露出后面的暗格。",
  failureOutcome: "石板崩裂，碎石砸了下来。",
  // A high-risk ruling that carries a check is shaped exactly like the
  // shared-check Bundle above, so the validator lets it through and the
  // refusal under test really comes from the lowering gate rather than from
  // an earlier shape rule.
  check: {
    checkKind: "abilityCheck",
    ability: "str",
    skill: null,
    dc: 13,
    mode: "normal",
  },
  acceptedCosts: [],
});

/** The same inspect entry, but with the real, reachable failure branch a
 * shared check requires. */
function pryAlcoveEntryV2(handle: string): JsonRecord {
  const evidence = (text: string) => [{
    observerRef: ALICE_ID,
    subjectRef: null,
    sense: "sight",
    evidence: text,
    basisRefs: [SCENE_REF],
  }];
  return {
    kind: "worldInteraction",
    basisRefs: [SCENE_REF],
    consumes: [{ kind: "prospective", handle }],
    produces: [],
    outcomeBinding: "always",
    sceneRef: SCENE_REF,
    targetRefs: [handle],
    directTargetRefs: [handle],
    instrumentRefs: [],
    abilityRef: null,
    intent: "撬开壁龛内壁卡住的石板。",
    method: "双手扣住石板边缘向外用力。",
    branches: {
      success: {
        outcomeCode: "outcome:stage3:pry-alcove-v2:success",
        summary: "角色撬开了壁龛内壁的石板。",
        effects: [],
        sensoryEvidence: evidence("石板松动后被拉开，后面是一处凹进去的暗格。"),
        pressures: [],
        opportunities: [],
      },
      failure: {
        outcomeCode: "outcome:stage3:pry-alcove-v2:failure",
        summary: "石板纹丝不动。",
        effects: [],
        sensoryEvidence: evidence("石板边缘只掉下些许石屑，位置没有变化。"),
        pressures: [],
        opportunities: [],
      },
    },
  };
}

/** A materialization bound to the success outcome alone: the hidden cache
 * exists only if the roll actually opened the slab. */
function materializeCacheEntryV2(): JsonRecord {
  return {
    kind: "materializeObject",
    basisRefs: [SCENE_REF],
    consumes: [],
    produces: [
      { handle: CACHE_HANDLE_V2, kind: "semanticDefinition", outcomeBinding: "onSuccess" },
    ],
    outcomeBinding: "onSuccess",
    semanticKind: "sceneFeature",
    templateRef: VNEXT_SEMANTIC_TEMPLATES.sceneFeature.templateRef,
    templateHash: VNEXT_SEMANTIC_TEMPLATES.sceneFeature.templateHash,
    visibilityPolicyRef: "visibility:scene-observers",
    definition: {
      sceneRef: SCENE_REF,
      visibilityFactId: null,
      label: "石板后的暗格(v2)",
      description: "石板被撬开后露出的一处浅暗格。",
      observableState: "刚刚露出",
      affordances: ["可以伸手掏取"],
      mechanicDefinitionRefs: [],
    },
    summary: "石板被撬开后，固化出它后面的暗格。",
  };
}

/** The shared-check vertical: reveal the alcove unconditionally, pry its slab
 * on one roll, and materialize what is behind the slab only if that roll
 * succeeded. Exactly one worldInteraction, bound to "always", is what makes
 * this Bundle a legal shared-check owner. */
function checkedPryAlcoveBundleV2(): JsonRecord {
  return adjudicationBundleV2(
    [
      materializeAlcoveEntryV2(),
      pryAlcoveEntryV2(ALCOVE_HANDLE_V2),
      materializeCacheEntryV2(),
    ],
    ALCOVE_SHARED_CHECK_V2,
  );
}

/** A lone checked interaction against an already-frozen scene feature. Rolled
 * at advantage on wisdom against DC 15: ALICE has wis 12, so the modifier is
 * +1 and the higher of two faces decides. Nothing is materialized, so this is
 * the non-atomic single-step path rather than the Bundle path above. */
const ROPE_SHARED_CHECK_V2: JsonRecord = Object.freeze({
  kind: "check", durationMicros: "300000000",
  checkKind: "abilityCheck",
  ability: "wis",
  skill: null,
  dc: 15,
  mode: "advantage",
  risk: "看走眼的话会误判麻绳还能撑多久。",
  successOutcome: "角色看清了绳股的磨损程度。",
  failureOutcome: "角色没能从磨损痕迹里看出什么。",
});

function checkedRopeReadingBundleV2(): JsonRecord {
  const evidence = (text: string) => [{
    observerRef: ALICE_ID,
    subjectRef: ROPE_REF,
    sense: "sight",
    evidence: text,
    // Rules requires every basisRefs list inside sensory evidence to be a
    // strictly ascending canonical set and does not sort it for the proposer,
    // so "feature:..." precedes "wake" here.
    basisRefs: [ROPE_REF, SCENE_REF],
  }];
  return adjudicationBundleV2(
    [{
      kind: "worldInteraction",
      basisRefs: [ROPE_REF, SCENE_REF],
      consumes: [],
      produces: [],
      outcomeBinding: "always",
      sceneRef: SCENE_REF,
      targetRefs: [ROPE_REF],
      directTargetRefs: [ROPE_REF],
      instrumentRefs: [],
      abilityRef: null,
      intent: "判断麻绳还能承重多久。",
      method: "凑近查看承重点绳股的磨损程度。",
      branches: {
        success: {
          outcomeCode: "outcome:stage3:rope-reading-v2:success",
          summary: "角色看清了麻绳承重点的磨损。",
          effects: [],
          sensoryEvidence: evidence("承重点的绳股已经起毛，断口就快出现。"),
          pressures: [],
          opportunities: [],
        },
        failure: {
          outcomeCode: "outcome:stage3:rope-reading-v2:failure",
          summary: "角色没看出麻绳的状态。",
          effects: [],
          sensoryEvidence: evidence("光线太暗，绳股的细节看不真切。"),
          pressures: [],
          opportunities: [],
        },
      },
    }],
    ROPE_SHARED_CHECK_V2,
  );
}

/** A vnext-2 attack: the Bundle's shared ruling is `checkKind: "attack"`, so
 * the entry must carry the Ability the attack is made with. The two are bound
 * to each other by the domain rather than by the schema, because the ruling
 * sits on the Bundle and the Ability on the entry. */
function attackChainBundleV2(request: JsonRecord, dc: number): JsonRecord {
  const abilityRef = pistolAbility(requiredContext(request));
  const evidence = (text: string) => [{
    observerRef: ALICE_ID,
    subjectRef: CHAIN_REF,
    sense: "sight",
    evidence: text,
    basisRefs: [CHAIN_REF, SCENE_REF],
  }];
  return adjudicationBundleV2(
    [{
      kind: "worldInteraction",
      basisRefs: [CHAIN_REF, PISTOL_ENTRY_REF, SCENE_REF],
      consumes: [],
      produces: [],
      outcomeBinding: "always",
      sceneRef: SCENE_REF,
      targetRefs: [CHAIN_REF],
      directTargetRefs: [CHAIN_REF],
      instrumentRefs: [PISTOL_ENTRY_REF],
      abilityRef,
      intent: "用手枪打断吊灯的铁链。",
      method: "举枪瞄准可见的铁链链节并击发。",
      branches: {
        success: {
          outcomeCode: "outcome:stage3:chain-shot-v2:success",
          summary: "子弹击中铁链。",
          effects: [],
          sensoryEvidence: evidence("枪响之后铁链上多出一道新的凹痕。"),
          pressures: [],
          opportunities: [],
        },
        failure: {
          outcomeCode: "outcome:stage3:chain-shot-v2:failure",
          summary: "子弹打偏了。",
          effects: [],
          sensoryEvidence: evidence("弹丸擦过铁链打在墙上，铁链没有变化。"),
          pressures: [],
          opportunities: [],
        },
      },
    }],
    {
      kind: "check", durationMicros: "300000000",
      checkKind: "attack",
      ability: "dex",
      skill: null,
      dc,
      mode: "normal",
      risk: "会消耗一次弹药，且未必命中。",
      successOutcome: "子弹击中铁链。",
      failureOutcome: "子弹打偏，弹药照样消耗。",
    },
  );
}

/** A shared check whose one interaction has no failure branch: a roll that
 * can fail with nothing to commit on failure. */
function checkedBundleWithoutFailureBranchV2(): JsonRecord {
  const entry = pryAlcoveEntryV2(ALCOVE_HANDLE_V2) as JsonRecord & {
    branches: { success: JsonRecord; failure: JsonRecord | null };
  };
  return adjudicationBundleV2(
    [
      materializeAlcoveEntryV2(),
      { ...entry, branches: { success: entry.branches.success, failure: null } },
    ],
    ALCOVE_SHARED_CHECK_V2,
  );
}

/** A high-risk ruling, which is pending until Room supplies a trusted
 * confirmation this transport has no seam for. */
function highRiskPryAlcoveBundleV2(): JsonRecord {
  return adjudicationBundleV2(
    [materializeAlcoveEntryV2(), pryAlcoveEntryV2(ALCOVE_HANDLE_V2)],
    ALCOVE_SHARED_HIGH_RISK_V2,
  );
}

/** Violates the frozen materializeObject contract (semanticKind is only ever
 * "sceneFeature" or "worldFact") -- used for the invalid-schema-fails-closed
 * case. Rejected by validateVNextProposalBundle before Rules ever sees it. */
function invalidSemanticKindAlcoveProposal(request: JsonRecord): JsonRecord {
  const bundle = materializeAndInspectAlcoveProposal(request) as {
    proposals: [JsonRecord, JsonRecord];
  };
  const materialize = record(bundle.proposals[0], "materialize entry");
  const proposal = record(materialize.proposal, "materialize proposal payload");
  return {
    schema: VNEXT1_PROPOSAL_BUNDLE_SCHEMA,
    kind: "proposalBundle",
    proposals: [
      { ...materialize, proposal: { ...proposal, semanticKind: "npc" } },
      bundle.proposals[1],
    ],
  };
}

// -- vnext-2 ProposalBundle fixtures (proposal-schema.ts contract) --------
// Entries carry no model-authored proposalRef/formId/ruling: the server
// derives entryRefs and formIds (proposal-graph.ts) and the whole Bundle
// shares one adjudication. Kept deliberately parallel to the vnext-1 ALCOVE_*
// fixtures just above so the two contracts' equivalent scenarios stay easy
// to compare.

const ALCOVE_HANDLE_V2 = "prospective:stage3-new-alcove-v2";
const ALCOVE_UNPRODUCED_HANDLE_V2 = "prospective:stage3-unproduced-handle-v2";

const ALCOVE_SHARED_RULING_V2: JsonRecord = Object.freeze({
  kind: "directSuccess", durationMicros: "300000000",
  risk: "让一个先前没被注意到的壁龛显形并靠近查看，不会带来额外风险。",
  successOutcome: "壁龛作为新的场景对象被固化，角色随即查看了它的内部。",
});

function materializeAlcoveEntryV2(
  overrides: { produces?: JsonRecord[]; summary?: string } = {},
): JsonRecord {
  return {
    kind: "materializeObject",
    basisRefs: [SCENE_REF],
    consumes: [],
    produces: overrides.produces ?? [
      { handle: ALCOVE_HANDLE_V2, kind: "semanticDefinition", outcomeBinding: "always" },
    ],
    outcomeBinding: "always",
    semanticKind: "sceneFeature",
    templateRef: VNEXT_SEMANTIC_TEMPLATES.sceneFeature.templateRef,
    templateHash: VNEXT_SEMANTIC_TEMPLATES.sceneFeature.templateHash,
    visibilityPolicyRef: "visibility:scene-observers",
    definition: {
      sceneRef: SCENE_REF,
      visibilityFactId: null,
      label: "新出现的壁龛(v2)",
      description: "墙面上露出一个先前没有被注意到的浅壁龛。",
      observableState: "刚刚露出",
      affordances: ["可以靠近查看"],
      mechanicDefinitionRefs: [],
    },
    summary: overrides.summary ?? "根据角色仔细检查墙面，固化出一个新的可互动壁龛。",
  };
}

function inspectAlcoveEntryV2(handle: string): JsonRecord {
  const branch = (name: "success") => ({
    outcomeCode: `outcome:stage3:inspect-alcove-v2:${name}`,
    summary: "角色查看了新出现的壁龛内部。",
    effects: [],
    sensoryEvidence: [{
      observerRef: ALICE_ID,
      subjectRef: null,
      sense: "sight",
      evidence: "壁龛内壁干净，没有藏着别的东西。",
      basisRefs: [SCENE_REF],
    }],
    pressures: [],
    opportunities: [],
  });
  return {
    kind: "worldInteraction",
    basisRefs: [SCENE_REF],
    consumes: [{ kind: "prospective", handle }],
    produces: [],
    outcomeBinding: "always",
    sceneRef: SCENE_REF,
    targetRefs: [handle],
    directTargetRefs: [handle],
    instrumentRefs: [],
    abilityRef: null,
    intent: "靠近查看墙面新出现的浅壁龛。",
    method: "伸手探查壁龛内部。",
    branches: { success: branch("success"), failure: null },
  };
}

const IN_WORLD_ACT_KINDS_V2 = new Set(["social", "observe", "worldInteraction", "inventoryOperation"]);
function adjudicationBundleV2(
  proposals: JsonRecord[],
  adjudication?: JsonRecord,
): JsonRecord {
  // The shared ruling's duration follows the proposals: authoring alone takes no time, an act does.
  const ruling = adjudication ?? { ...ALCOVE_SHARED_RULING_V2,
    durationMicros: proposals.some((entry) => IN_WORLD_ACT_KINDS_V2.has(String(entry.kind))) ? "300000000" : "0" };
  return {
    schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
    kind: "proposalBundle",
    mode: "adjudication",
    basisRefs: [SCENE_REF],
    adjudication: ruling,
    terminal: null,
    proposals,
  };
}

/** materialize + interact, atomically, vnext-2 shape: goal 1's vertical. */
function materializeAndInspectAlcoveBundleV2(): JsonRecord {
  return adjudicationBundleV2([
    materializeAlcoveEntryV2(),
    inspectAlcoveEntryV2(ALCOVE_HANDLE_V2),
  ]);
}

/** Same two entries, but the interact entry consumes a handle nothing in the
 * Bundle produces -- a broken produces/consumes graph. */
function materializeAndInspectBrokenGraphBundleV2(): JsonRecord {
  return adjudicationBundleV2([
    materializeAlcoveEntryV2(),
    inspectAlcoveEntryV2(ALCOVE_UNPRODUCED_HANDLE_V2),
  ]);
}

/** The same materialize entry submitted alone. */
function materializeAlcoveAloneBundleV2(): JsonRecord {
  return adjudicationBundleV2([materializeAlcoveEntryV2()]);
}

/** Violates the frozen materializeObject contract (semanticKind is only ever
 * "sceneFeature" or "worldFact") -- used for the invalid-schema-fails-closed
 * case. Rejected by proposal-validator.ts's validateVNextProposalBundle
 * before lowerVNext2ProposalBundle ever reaches Rules. */
function invalidSemanticKindAlcoveBundleV2(): JsonRecord {
  const bundle = materializeAndInspectAlcoveBundleV2() as { proposals: [JsonRecord, JsonRecord] };
  const [materialize, inspect] = bundle.proposals;
  return adjudicationBundleV2([{ ...materialize, semanticKind: "npc" }, inspect]);
}

/** An intentionally empty `summary` -- the one repairable field
 * proposal-correction.ts's allowlist recognizes for a materializeObject
 * entry -- so the KP's first draft fails local validation and must be
 * corrected exactly once before Room ever sees a propose() call. */
function draftAlcoveAloneBundleV2WithBadSummary(): JsonRecord {
  return adjudicationBundleV2([materializeAlcoveEntryV2({ summary: "" })]);
}

function intent(submissionId: string, text: string): RoomActionInput {
  return { kind: "intent", submissionId, text };
}

async function runAction(input: {
  authority: Authority;
  principal: typeof ALICE | typeof BOB;
  action: RoomActionInput;
  kp: DeterministicKp;
  counters: ActionCounters;
  prepared: PreparedCapture;
  rolls?: number[];
  dieSides?: number[];
  transformCommittedProjection?: (
    projection: ReturnType<VersionedRulesRuntime["project"]>,
  ) => ReturnType<VersionedRulesRuntime["project"]>;
}) {
  return runInDurableObject(input.authority as never, async (instance) => {
    const target = instance as unknown as RoomInternals;
    const originalRoll = target.authorityRoll;
    const originalRulesRuntime = target.rulesRuntime;
    if (input.transformCommittedProjection !== undefined) {
      target.rulesRuntime = {
        ...originalRulesRuntime,
        project: (profiles, state, viewer, query) => {
          const projection = originalRulesRuntime.project(profiles, state, viewer, query);
          return query?.committedRange === undefined
            ? projection
            : input.transformCommittedProjection!(projection);
        },
      };
    }
    const faces = [...(input.rolls ?? [])];
    let rollIndex = 0;
    target.authorityRoll = (sides: number) => {
      expect(sides, "vNext Room authority die").toBe(input.dieSides?.[rollIndex] ?? 20);
      const face = faces[rollIndex];
      expect(face, "unexpected additional vNext authority randomness").toBeDefined();
      rollIndex += 1;
      input.counters.rolls += 1;
      return face!;
    };
    try {
      const outcome = await handleRoomAction({
        principal: input.principal,
        authority: instrumentAuthority(target, input.counters, input.prepared),
        kp: input.kp,
      }, structuredClone(input.action));
      expect(
        rollIndex,
        `frozen authority roll count for ${JSON.stringify(outcome)}`,
      ).toBe(faces.length);
      return outcome;
    } finally {
      target.authorityRoll = originalRoll;
      target.rulesRuntime = originalRulesRuntime;
    }
  });
}

async function roomSnapshot(authority: Authority): Promise<{
  state: JsonRecord;
  events: JsonRecord[];
}> {
  return runInDurableObject(authority as never, async (instance) => {
    const target = instance as unknown as RoomInternals;
    return {
      state: structuredClone(target.authoritativeReplay().state),
      events: structuredClone(target.authorityStore.events()),
    };
  });
}

async function roomStateHash(authority: Authority): Promise<string> {
  return runInDurableObject(authority as never, async (instance) => {
    const target = instance as unknown as RoomInternals;
    const replay = record(target.authoritativeReplay().replay, "authoritative replay result");
    const head = record(replay.head, "authoritative replay head");
    return String(head.stateHash);
  });
}

function campaignRuntime(state: JsonRecord): JsonRecord {
  return record(state.campaignRuntime, "campaign runtime");
}

function definitions(state: JsonRecord): JsonRecord {
  return record(campaignRuntime(state).definitions, "semantic definition catalog");
}

function itemEntries(state: JsonRecord): JsonRecord {
  return record(record(campaignRuntime(state).itemSystem, "item system").entries, "item entries");
}

function entities(state: JsonRecord): JsonRecord {
  return record(state.entities, "entities");
}

function eventPayload(event: JsonRecord): JsonRecord {
  return record(event.payload, `${String(event.eventType)} payload`);
}

function eventsOf(snapshot: { events: JsonRecord[] }, eventType: string): JsonRecord[] {
  return snapshot.events.filter((event) => event.eventType === eventType);
}

function narrationForViewer(kp: DeterministicKp, viewerKey: string): JsonRecord[] {
  return kp.narrationRequests.filter((request) => request.viewerKey === viewerKey);
}

// Fixture setup uses the native public Rules input to complete an existing
// NPC's combat mechanics. This does not claim a vNext NPC creation capability.
async function initializeNpcShieldMechanics(authority: Authority) {
  await runInDurableObject(authority as never, async (instance) => {
    const target = instance as unknown as RoomInternals;
    const replay = target.authoritativeReplay() as ReturnType<RoomInternals["authoritativeReplay"]> & { profiles: unknown };
    const npc = record(entities(replay.state)[LIAN_ID], "existing NPC");
    const combat = record(record(replay.state.combatRuntime, "combat").entities, "combat entities");
    const spatialNpc = record(combat[LIAN_ID], "NPC spatial identity");
    const social = npc.socialMechanics === undefined ? {} : record(npc.socialMechanics, "NPC social mechanics");
    const scores = record(npc.abilityScores ?? social.abilityScores ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, "NPC scores");
    const input = {
      kind: "startEncounter", rootActionId: "root:stage3:npc-shield-fixture",
      proposalAttemptId: "proposal:stage3:npc-shield-fixture", encounterId: "encounter:stage3:npc-shield",
      sceneId: SCENE_REF, participantEntityIds: [ALICE_ID],
      dynamicEntities: [{ entityId: LIAN_ID, name: npc.name,
        placement: { position: structuredClone(spatialNpc.position) },
        mechanics: { kind: "bespokeDefinition", definition: {
          definitionId: "npc-template:stage3:lian-shield", revision: "1", definitionKind: "npcMechanicalTemplate",
          rulesBasis: "srd5.1-2014", causalBasisRefs: [NPC_DEFINITION_REF], visibilityPolicyRef: "visibility:scene-observers",
          content: { schema: "zhuwei.npc-mechanical-template/v1", label: npc.name,
            footprint: structuredClone(spatialNpc.footprint),
            stats: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, String(value)])),
            proficiencyBonus: String(npc.proficiencyBonus ?? social.proficiencyBonus ?? 2),
            armorClass: "12", armorClassModel: { kind: "higherOfBaseAndEquipment", baseArmorClass: "12", shieldBonus: "0" },
            hitPointsMaximum: "20", speedInches: { walk: "360" }, resourceMaximums: { "spellSlot:1": "2" },
            deathPolicy: "deadAtZero", intrinsicAbilities: [{
              definitionId: "ability:stage3:lian-shield", revision: "1", rulesBasis: "srd5.1-2014", mechanicalKey: "shield",
              activation: { kind: "reactionSpell", spellLevel: "1" }, costs: [{ kind: "spellSlot", level: "1", amount: "1" }],
              effect: { kind: "shield", duration: "untilOwnNextTurnStart", armorClassBonus: "5", magicMissileImmunity: true },
            }], itemDefinitions: [], itemDefinitionRefs: [], initialLoadout: { entries: [] },
          },
        } },
      }],
      initiativeGroups: [{ entryId: "initiative:stage3:alice", combatantEntityIds: [ALICE_ID] },
        { entryId: "initiative:stage3:lian", combatantEntityIds: [LIAN_ID] }],
      hostilities: [{ fromEntityIds: [ALICE_ID], toEntityIds: [LIAN_ID] },
        { fromEntityIds: [LIAN_ID], toEntityIds: [ALICE_ID] }], battlefieldFactIds: [],
    };
    let result = target.rulesRuntime.step(replay.profiles, replay.state, input);
    const events: unknown[] = [];
    let rollIndex = 0;
    while (result.kind === "awaitingRandomness") {
      events.push(...result.events);
      const waiting = result;
      result = target.rulesRuntime.step(replay.profiles, waiting.state, {
        kind: "authoritativeRandomness", resolutionId: waiting.resolutionId,
        responseId: `authority:stage3:npc-shield:${rollIndex}`, continuationCapability: waiting.continuationCapability,
        randomnessResults: waiting.randomnessRequests.map(request => ({
          randomnessId: request.randomnessId, requestHash: request.requestHash,
          draws: request.dice.map(term => ({ sides: Number(term.sides),
            faces: Array.from({ length: Number(term.count) }, () => ++rollIndex === 1 ? 20 : 1) })),
        })),
      });
    }
    expect(result.kind, JSON.stringify(result)).toBe("committed");
    if (result.kind !== "committed") return;
    events.push(...result.events);
    const store = target.authorityStore as unknown as {
      appendEvents(events: unknown[]): void; updateState(state: unknown): void; syncAuthorityIndex(state: unknown): void;
    };
    store.appendEvents(events); store.updateState(result.state); store.syncAuthorityIndex(result.state);
    expect(target.authoritativeReplay().state).toEqual(result.state);
  });
}

describe("atomic NPC candidate decisions through Room", () => {
  it("uses the prior hazard's private HP change for the next Shield decision and resumes once after model failure", async () => {
    const { authority } = await initializeRoom("kp-vnext-atomic-npc-candidate", 20, 20, true);
    await initializeNpcShieldMechanics(authority);
    const before = await roomSnapshot(authority), counters = emptyActionCounters(), prepared: PreparedCapture = { all: [] };
    const refs: Record<string, string> = { "character:probe-actor": ALICE_ID, "character:probe-target": LIAN_ID,
      "scene:probe-gallery": SCENE_REF, "definition:probe-valve": CHAIN_REF, "definition:probe-steam-zone": IMPACT_ZONE_REF };
    const bundle = JSON.parse(JSON.stringify(hazardBundle()),
      (_key, value) => typeof value === "string" ? refs[value] ?? value : value) as JsonRecord;
    const proposals = bundle.proposals as JsonRecord[];
    Object.assign(record(record(proposals[0].source, "source").content, "ability"), {
      save: null, attack: { kind: "fixed", bonus: "2" },
      target: { kind: "creature", count: "1", rangeInches: "1200", requiresSight: false },
      damage: [{ type: "force", formula: "1d4", sharedAcrossTargets: false }], effects: [],
    });
    const effects = record(record(proposals[2].branches, "branches").success, "success").effects as unknown[];
    effects.push(structuredClone(effects[0]));
    const kp = new DeterministicKp(() => bundle, prepared, undefined, false);
    const requests: JsonRecord[] = [];
    Object.assign(kp, { decidePendingInput: async (request: JsonRecord) => {
      requests.push(structuredClone(request));
      const projection = record(request.projection, "NPC finite projection");
      expect(record(projection.viewer, "NPC viewer")).toMatchObject({ kind: "npc", subjectId: LIAN_ID });
      const hp = record(record(projection.controlledCharacter, "NPC self").hitPoints, "candidate HP");
      expect(hp.current).toBe(requests.length === 1 ? 20 : 18);
      expect(JSON.stringify(request)).not.toMatch(/candidateState|nativePendingInputId|frozenDamageFaces|ownerFrame|lethalDamagePayload/);
      expect(JSON.stringify(request)).not.toContain(PLAYER_SECRET_CANARY);
      if (requests.length === 2) throw Object.assign(new Error("NPC model temporarily unavailable"), { code: "modelTransient" });
      const pending = record(request.pending, "pending");
      const option = list(pending.answerOptions, "answers").map(value => record(value, "answer option"))
        .find(value => record(value.answer, "answer").kind === (requests.length === 1 ? "decline" : "useReaction"));
      expect(option).toBeDefined();
      return { kind: "npcPendingDecision", capability: request.capability, answer: option!.answer };
    } });
    const action = intent("submission:stage3:atomic-npc-candidate", "扰动吊灯铁链，让莉安所在区域的两次危险依次触发。");
    const paused = await runAction({ authority, principal: ALICE, action, kp, counters, prepared,
      // Each hit freezes damage, critical reserve, two CON and two attack faces.
      rolls: [2, 2, 20, 1, 10, 1, 2, 2, 20, 1, 10, 1],
      dieSides: [4, 4, 20, 20, 20, 20, 4, 4, 20, 20, 20, 20] });
    expect(paused, JSON.stringify(paused)).toMatchObject({ kind: "retryableFailure" });
    expect(requests).toHaveLength(2);
    const waiting = await roomSnapshot(authority);
    expect(entities(waiting.state)).toEqual(entities(before.state));
    expect(definitions(waiting.state)).toEqual(definitions(before.state));
    expect(waiting.events.filter(event => event.eventType === "DamagePacketResolved")).toHaveLength(0);
    expect(kp.counters.narrate).toBe(0);
    await evictDurableObject(authority as never);
    expect(await roomSnapshot(authority)).toEqual(waiting);
    const retry: RoomActionInput = { kind: "retry", submissionId: action.submissionId, rootActionId: String(prepared.latest!.rootActionId) };
    const done = await runAction({ authority, principal: ALICE, action: retry, kp, counters, prepared });
    expect(done, JSON.stringify(done)).toMatchObject({ kind: "committed", narration: "published" });
    expect(requests).toHaveLength(3);
    expect(requests[2]).toEqual(requests[1]);
    const committed = await roomSnapshot(authority);
    expect(record(entities(committed.state)[LIAN_ID], "NPC").hitPoints).toMatchObject({ current: 18 });
    expect(record(entities(committed.state)[LIAN_ID], "NPC").resources).toMatchObject({ "spellSlot:1": 1 });
    expect(eventsOf(committed, "ReactionAnswered")).toHaveLength(2);
    expect(eventsOf(committed, "DamagePacketResolved")).toHaveLength(1);
    expect(eventsOf(committed, "AtomicWorldInteractionStepsResolved")).toHaveLength(1);
    expect(kp.counters.propose).toBe(1);
    expect(counters.rolls).toBe(12);
    await runAction({ authority, principal: ALICE, action: retry, kp, counters, prepared });
    expect(await roomSnapshot(authority)).toEqual(committed);
    expect(requests).toHaveLength(3);
    await evictDurableObject(authority as never);
    expect(await roomSnapshot(authority)).toEqual(committed);
  }, 20_000);
});

function claimKinds(request: JsonRecord): string[] {
  const claims = list(
    record(request.renderableClaims, "renderable claims").claims,
    "renderable claim list",
  );
  return claims.map((claim) => String(record(claim, "renderable claim").kind));
}

// Test level: T2 — these cases cross the real local Room API, identity,
// Durable Object transaction, Rules, projection and recovery seams.
describe("vNext stage-three Room verticals", () => {
  it("normal module initialization preserves each NPC identity and finite context without a synthetic semantic seed", async () => {
    const authority = vnextRoom("vnext-normal-module-npc-context");
    const profile = await authoritativeModuleProfile("black-oak-will");
    const initialized = record(await authority.initializeAuthoritative({
      roomId: "vnext-normal-module-npc-context", moduleId: "black-oak-will",
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [character(ALICE_ID, ALICE.principal.id, "阿莱莎", 16)],
      fixtureFacts: [{ knowledgeRef: "knowledge:normal-player-private", holderEntityId: ALICE_ID, content: PLAYER_SECRET_CANARY }],
    }), "normal module initialization");
    expect(initialized).toMatchObject({ created: true });
    const initial = await roomSnapshot(authority);
    const player = record(await authority.observe(ALICE), "player observation");
    for (const sourceId of ["lian", "varo"]) {
      const npc = profile.storyBible.importantNpcs.find(entry => entry.sourceNpcId === sourceId)!;
      const entity = record(record(initial.state.entities, "entities")[npc.entityId], "module NPC");
      expect(entity.semanticDefinitionRef, "normal genesis must bind the NPC's semantic identity").toBeTypeOf("string");
      expect(JSON.stringify(player)).not.toContain(npc.goal);
      const prepared = record(await authority.prepare(ALICE, intent(`submission:normal-npc:${sourceId}`, `我问${npc.name}：「你愿意和我聊聊吗？」`)), "normal NPC context");
      expect(prepared.kind, JSON.stringify(prepared)).toBe("prepared");
      const context = requiredContext(prepared), decision = npcDecisionContext(context.entries, npc.entityId);
      expect(decision).toBeDefined();
      const identity = record(decision!.records.find(entry => entry.kind === "identity")!.value, "NPC identity");
      expect(identity).toMatchObject({ definitionRef: entity.semanticDefinitionRef,
        label: npc.name, description: npc.publicFace,
        goals: [{ description: npc.goal }], behavioralConstraints: npc.behavioralConstraints, initialUnknowns: npc.declaredUnknowns });
      const bodies = decision!.knowledge.map(entry => context.entries.find(candidate => candidate.kind === "known" && candidate.entryRef === entry.entryRef));
      const isolated = JSON.stringify({ decision, bodies });
      expect(isolated).not.toContain(PLAYER_SECRET_CANARY);
      for (const other of profile.storyBible.importantNpcs.filter(entry => entry.entityId !== npc.entityId)) {
        expect(isolated).not.toContain(other.goal);
        for (const secret of other.initialKnowledge.filter(value => !npc.initialKnowledge.includes(value))) expect(isolated).not.toContain(secret);
      }
      for (const known of npc.initialKnowledge) expect(isolated).toContain(known);
    }
    await evictDurableObject(authority as never);
    expect((await roomSnapshot(authority)).state).toEqual(initial.state);
  });

  it("normal Room materializes a new NPC history, recalls it after eviction and never duplicates it", async () => {
    const authority = vnextRoom("vnext-world-fact-memory-normal");
    const initialized = record(await authority.initializeAuthoritative({
      roomId: "vnext-world-fact-memory-normal", moduleId: "black-oak-will",
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [character(ALICE_ID, ALICE.principal.id, "阿莱莎", 16)],
    }), "normal module initialization");
    expect(initialized).toMatchObject({ created: true });
    const before = await roomSnapshot(authority), actor = record(record(before.state.entities, "entities")[ALICE_ID], "actor");
    const description = "莉安幼年曾跟随祖父学着修补渔网。";
    const counters = emptyActionCounters(), prepared: PreparedCapture = { all: [] };
    const kp = new DeterministicKp(() => parseSubmitKpProposalBundleArguments(JSON.stringify(encodeVNextStrictToolBundle(worldFactSocialBundle({
      sceneRef: String(actor.sceneId), npcRef: LIAN_ID, description,
    })))) as unknown as JsonRecord, prepared, undefined, false);
    const action = intent("submission:world-fact-memory", "我问莉安：你小时候跟家人一起学过什么？");
    const result = await runAction({ authority, principal: ALICE, action, kp, counters, prepared });
    expect(result, JSON.stringify(result)).toMatchObject({ kind: "committed", narration: "published" });
    const committed = await roomSnapshot(authority);
    expect(eventsOf(committed, "CanonicalFactDeclared")).toHaveLength(1);
    const fact = record(record(eventsOf(committed, "CanonicalFactDeclared")[0].payload, "payload").fact, "fact");
    expect(record(record(committed.state.knowledge, "knowledge")[ALICE_ID], "player knowledge")[String(fact.id)]).toBeUndefined();
    await evictDurableObject(authority as never);
    expect(await roomSnapshot(authority)).toEqual(committed);
    await runAction({ authority, principal: ALICE, action, kp, counters, prepared });
    expect(await roomSnapshot(authority)).toEqual(committed);
    expect(kp.counters.propose).toBe(1);
    const next = record(await authority.prepare(ALICE, intent("submission:world-fact-memory-next", "我问莉安：你刚才提到的祖父教了你什么？")), "next preparation");
    expect(next.kind, JSON.stringify(next)).toBe("prepared");
    const decision = npcDecisionContext(requiredContext(next).entries, LIAN_ID);
    expect(JSON.stringify(decision)).toContain(description);
    expect(JSON.stringify(record(await authority.observe(ALICE), "player observation"))).not.toMatch(/PRIVATE-ACQUISITION|PRIVATE-FACT-MOTIVE/);
  });

  for (const roll of [null, 1, 20]) it(`executes social Form through Room, private NPC evidence and eviction (${roll ?? "direct"})`, async () => {
    const { authority } = await initializeRoom(`kp-vnext-social-form-${roll ?? "direct"}`);
    const before = await roomSnapshot(authority), counters = emptyActionCounters(), prepared: PreparedCapture = { all: [] };
    const kp = new DeterministicKp((request) => {
      const context = requiredContext(request), decision = npcDecisionContext(context.entries, LIAN_ID);
      expect(decision).toBeDefined();
      expect(JSON.stringify(decision)).not.toContain(PLAYER_SECRET_CANARY);
      const response = (failure: boolean) => ({ outcomeCode: failure ? "outcome:declined" : "outcome:answered",
        summary: failure ? "莉安暂时不愿回应。" : "莉安回应了账册的问题。",
        response: { kind: "speech", text: failure ? "现在先别问这个。" : "我亲眼看见你归还了父亲的账册。",
          motive: NPC_SUMMARY_CANARY, basis: [{ kind: "npcContext", ref: roll === null ? NPC_KNOWLEDGE_REF : `knowledge:${LIAN_ID}:${NPC_KNOWLEDGE_REF}` }] },
        consequences: failure ? [] : [{ kind: "promise", content: "协助核对账册上的签字。", condition: "先看过账册以后。", authorityRefs: [LIAN_ID] }] });
      const wire = { mode: "adjudication", basisRefs: [LIAN_ID], terminal: { kind: "none" },
        adjudication: roll === null ? { kind: "directSuccess", durationMicros: "300000000", risk: "普通交谈。", successOutcome: "莉安回应。" }
          : { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "cha", skill: "persuasion", dc: 12, mode: "normal",
            risk: "她可能拒绝本次请求。", successOutcome: "愿意协助。", failureOutcome: "拒绝协助。" },
        proposals: [{ kind: "social", basisRefs: [LIAN_ID], consumes: [], produces: [], outcomeBinding: "always",
          sceneRef: SCENE_REF, npcRef: LIAN_ID, addressedThreadRef: { kind: "none" }, goal: "询问归还账册的见闻并请求协助。",
          method: "平静地询问她亲眼见到的事。", communication: "spokenConversation", audience: "participants", retryChange: { kind: "none" },
          branches: { success: response(false), failure: roll === null ? { kind: "none" } : response(true) } }] };
      return parseSubmitKpProposalBundleArguments(JSON.stringify(encodeVNextStrictToolBundle(wire))) as unknown as JsonRecord;
    }, prepared, undefined, false);
    const action = intent(`submission:social-form:${roll ?? "direct"}`, "我问莉安：你亲眼看见我归还账册了吗？可以帮我核对签字吗？");
    const result = await runAction({ authority, principal: ALICE, action, kp, counters, prepared,
      ...(roll === null ? {} : { rolls: [roll], dieSides: [20] }) });
    expect(result, JSON.stringify(result)).toMatchObject({ kind: "committed", narration: "published" });
    expect(counters.rolls).toBe(roll === null ? 0 : 1);
    expect(kp.counters.propose).toBe(1);
    const committed = await roomSnapshot(authority);
    expect(eventsOf(committed, "SourceClaimCreated")).toHaveLength(2);
    expect(eventsOf(committed, "KnowledgeAcquired")).toHaveLength(2);
    expect(eventsOf(committed, "PromiseMade")).toHaveLength(roll === 1 ? 0 : 1);
    expect(itemEntries(committed.state)).toEqual(itemEntries(before.state));
    expect(entities(committed.state)).toEqual(entities(before.state));
    expect(eventsOf(committed, "WorldInteractionResolved")).toHaveLength(1);
    const aliceNarration = narrationForViewer(kp, `${ALICE.principal.id}\u001f${ALICE_ID}`)[0];
    expect(JSON.stringify(aliceNarration)).toContain('"outcomeKind":"social"');
    expect(JSON.stringify(aliceNarration)).not.toContain(NPC_SUMMARY_CANARY);
    expect(JSON.stringify(narrationForViewer(kp, `${BOB.principal.id}\u001f${BOB_ID}`))).not.toContain("亲眼看见你归还");
    await evictDurableObject(authority as never);
    expect(await roomSnapshot(authority)).toEqual(committed);
    await runAction({ authority, principal: ALICE, action, kp, counters, prepared });
    expect(await roomSnapshot(authority)).toEqual(committed);
    expect(kp.counters.propose).toBe(1);
    expect(counters.rolls).toBe(roll === null ? 0 : 1);
    const nextPrepared = record(await authority.prepare(ALICE, intent(`submission:social-memory:${roll ?? "direct"}`,
      "我接着问莉安：你刚才为什么这样回答？")), "next NPC memory preparation");
    expect(nextPrepared.kind, JSON.stringify(nextPrepared)).toBe("prepared");
    const nextDecision = npcDecisionContext(requiredContext(nextPrepared).entries, LIAN_ID);
    const ownClaim = nextDecision?.records.find(entry => entry.kind === "sourceClaim"
      && record(entry.value, "NPC claim").speakerId === LIAN_ID);
    expect(record(ownClaim?.value, "remembered own claim")).toMatchObject({ ownOrigin: { motive: NPC_SUMMARY_CANARY,
      sourceBasis: JSON.stringify([{ kind: "npcContext", ref: `knowledge:${LIAN_ID}:${NPC_KNOWLEDGE_REF}` }]) } });
    expect(JSON.stringify(record(await authority.observe(ALICE), "player after recovery"))).not.toContain(NPC_SUMMARY_CANARY);
  });

  for (const roll of [1, 20]) it(`applies direct sibling consequences of one shared check through Room and eviction (${roll})`, async () => {
    const { authority } = await initializeRoom(`kp-vnext-shared-siblings-${roll}`);
    const counters = emptyActionCounters(), prepared: PreparedCapture = { all: [] };
    const refs: Record<string, string> = { "character:probe-actor": ALICE_ID, "scene:probe-gallery": SCENE_REF,
      "definition:probe-valve": CHAIN_REF };
    const wire = JSON.parse(JSON.stringify(sharedCheckBundle()),
      (_key, value) => typeof value === "string" ? refs[value] ?? value : value);
    const proposal = parseSubmitKpProposalBundleArguments(JSON.stringify(encodeVNextStrictToolBundle(wire))) as unknown as JsonRecord;
    const kp = new DeterministicKp(() => proposal, prepared, undefined, false);
    const action = intent(`submission:shared-siblings:${roll}`, "先听清吊灯铁链附近的声音变化，再调整铁链；判断错误会卡住。");
    const result = await runAction({ authority, principal: ALICE, action, kp, counters, prepared, rolls: [roll], dieSides: [20] });
    expect(result, JSON.stringify(result)).toMatchObject({ kind: "committed", narration: "published" });
    expect(counters.rolls).toBe(1);
    const committed = await roomSnapshot(authority);
    expect(record(definitions(committed.state)[CHAIN_REF], "chain definition").content).toMatchObject({ observableState: roll === 20 ? "opened" : "jammed" });
    expect(eventsOf(committed, "WorldInteractionResolved")).toHaveLength(2);
    expect(eventsOf(committed, "WorldInteractionResolved").filter(event => eventPayload(event).rulingKind === "check")).toHaveLength(1);
    expect(eventsOf(committed, "AtomicWorldInteractionStepsResolved")).toHaveLength(1);
    const narration = narrationForViewer(kp, `${ALICE.principal.id}\u001f${ALICE_ID}`)[0];
    expect(JSON.stringify(narration)).toContain('"outcomeCode":"applied"');
    expect(JSON.stringify(narration)).not.toContain("直接成功");
    await evictDurableObject(authority as never);
    expect(await roomSnapshot(authority)).toEqual(committed);
    const beforeRetryRolls = counters.rolls, beforeRetryProposals = kp.counters.propose;
    await runAction({ authority, principal: ALICE, action, kp, counters, prepared });
    expect(await roomSnapshot(authority)).toEqual(committed);
    expect(counters.rolls).toBe(beforeRetryRolls);
    expect(kp.counters.propose).toBe(beforeRetryProposals);
  });

  it.each([
    "我用枪打断吊灯的支撑，让它砸向下面的敌人。",
    "我用燧发手枪打断吊灯的支撑，让它砸向下面的敌人。",
  ])("prepares the addressed equipped weapon with its frozen executable ability before any model call (%s)", async (text) => {
    const { authority } = await initializeRoom(`kp-vnext-stage3-room-ability-context-${text.length}`);
    const prepared = record(await authority.prepare(ALICE, intent(
      "submission:stage3:ability-context", text,
    )), "prepared equipment context");
    expect(prepared.kind).toBe("prepared");
    const context = requiredContext(prepared);
    const before = await roomSnapshot(authority);
    const runtime = record(before.state.combatRuntime, "runtime");
    const actor = record(record(runtime.entities, "combat entities")[ALICE_ID], "actor");
    const definitions = record(runtime.definitions, "ability catalog");
    const refs = list(actor.abilityRefs, "actor abilities").filter(ref => {
      const definition = record(definitions[String(ref)], "registered ability");
      return String(definition.mechanicalKey).includes(PISTOL_ENTRY_REF);
    });
    expect(refs).toHaveLength(1);

    expect(context.references.domains.abilityRefs).toEqual(expect.arrayContaining(refs));
  });

  it("rejects the retired coarse-form envelope before Rules or persistence", async () => {
    const { authority } = await initializeRoom("kp-vnext-stage3-room-retired-coarse-envelope");
    const counters = emptyActionCounters();
    const prepared: PreparedCapture = { all: [] };
    const kp = new DeterministicKp(
      (request) => retiredCoarseNpcRevisionProposal(request),
      prepared,
      undefined,
      false,
    );
    const before = await roomSnapshot(authority);

    const outcome = record(await runAction({
      authority,
      principal: ALICE,
      action: intent(
        "submission:stage3:retired-coarse-envelope",
        "莉安根据账册重新考虑她的态度。",
      ),
      kp,
      counters,
      prepared,
    }), "retired coarse-form envelope outcome");

    expect(outcome).toMatchObject({
      kind: "rejected",
      code: "PROPOSAL_FORM_INVALID",
      action: "notCommitted",
      narration: "notApplicable",
    });
    expect(kp.counters).toMatchObject({ propose: 1, narrate: 0 });
    expect(counters.rolls).toBe(0);
    expect(await roomSnapshot(authority)).toEqual(before);
  });

  it("runs an existing dynamic NPC sparse revision through frozen context, Rules, claims, narration, replay, and fail-closed stale input", async () => {
    const { authority, seed } = await initializeRoom("kp-vnext-stage3-room-npc");
    const counters = emptyActionCounters();
    const prepared: PreparedCapture = { all: [] };
    const kp = new DeterministicKp((request) => {
      const proposal = npcRevisionProposal(request);
      const entry = record(list(proposal.proposals, "entries")[0], "entry");
      const revision = record(entry.proposal, "revision");
      (revision.operations as JsonRecord[]).push({ kind: "set", path: ["semantics", "publicExpression"],
        value: { voice: "短句、克制，称呼来客为诸位", attitude: "谨慎地表示愿意协助" } });
      return proposal;
    }, prepared);
    const action = intent(
      "submission:stage3:npc-revision",
      "莉安看过归还的账册后，重新考虑她对我们的态度和下一步安排。",
    );

    const outcome = record(await runAction({
      authority,
      principal: ALICE,
      action,
      kp,
      counters,
      prepared,
    }), "NPC sparse revision outcome");
    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      kind: "committed",
      action: "committed",
      narration: "published",
      receipt: { rootActionId: expect.any(String), receiptId: expect.any(String) },
    });
    expect(kp.counters).toMatchObject({ propose: 1, decideDueActorPlan: 0 });
    expect(counters.rolls).toBe(0);

    const request = kp.proposalRequests[0];
    const context = requiredContext(request);
    expect(context.intent.text).toBe(action.text);
    const lianKnowledge = context.references.citations.npcKnowledge
      .find(({ npcRef }) => npcRef === LIAN_ID);
    expect(lianKnowledge, "Lian receives her complete finite knowledge slice").toBeDefined();
    expect(lianKnowledge?.refs).toEqual(expect.arrayContaining([`knowledge:${LIAN_ID}:${NPC_KNOWLEDGE_REF}`]));
    expect(lianKnowledge?.refs).not.toContain(`knowledge:${ALICE_ID}:knowledge:stage3:alice-private`);
    const npcDecision = npcDecisionContext(context.entries, LIAN_ID);
    expect(npcDecision, "Room prepare freezes the independently projected NPC decision context").toBeDefined();
    expect(npcDecision?.knowledge).toEqual(expect.arrayContaining([
      expect.objectContaining({ knowledgeRef: NPC_KNOWLEDGE_REF, entryRef: `knowledge:${LIAN_ID}:${NPC_KNOWLEDGE_REF}` }),
    ]));
    expect(JSON.stringify(npcDecision)).not.toContain(PLAYER_SECRET_CANARY);
    expect(JSON.stringify(npcDecision)).not.toContain(NPC_SUMMARY_CANARY);
    expect(JSON.stringify(context)).toContain("莉安亲眼看见阿莱莎归还了父亲的账册");
    expect(contextEntry(context, LIAN_LEDGER_ENTRY_REF)).toMatchObject({
      entryId: LIAN_LEDGER_ENTRY_REF,
      holderRef: LIAN_ID,
      quantity: 1,
      condition: "usable",
    });
    expect(contextEntry(context, LIAN_LEDGER_DEFINITION_REF)).toMatchObject({
      content: { label: "归还的账册" },
    });
    expect(contextEntry(context, SCENE_LEDGER_ENTRY_REF)).toMatchObject({
      entryId: SCENE_LEDGER_ENTRY_REF,
      holderRef: null,
      sceneRef: SCENE_REF,
      quantity: 1,
      condition: "usable",
    });
    expect(context.references.domains.itemRefs).toEqual(expect.arrayContaining([
      LIAN_LEDGER_ENTRY_REF,
      SCENE_LEDGER_ENTRY_REF,
      LIAN_LEDGER_DEFINITION_REF,
    ]));
    expect(context.binding.readSet).toEqual([]);
    expect(context.entries.map(({ entryRef }) => entryRef)).toEqual(expect.arrayContaining([
      ALICE_ID,
      LIAN_ID,
      NPC_DEFINITION_REF,
      `knowledge:${LIAN_ID}:${NPC_KNOWLEDGE_REF}`,
    ]));

    const snapshot = await roomSnapshot(authority);
    const currentNpc = record(definitions(snapshot.state)[NPC_DEFINITION_REF], "revised NPC definition");
    expect(currentNpc).toMatchObject({
      schema: "zhuwei.semantic-definition/vnext-1",
      definitionId: NPC_DEFINITION_REF,
      revision: "2",
      templateRef: NPC_DEFINITION_REF,
      templateHash: seed.initialNpcDefinition.templateHash,
      content: {
        label: "莉安·黑橡",
        description: "她认出了新归还的账册，但仍保持警惕。",
        links: { entityRef: LIAN_ID },
        semantics: {
          attitude: "确认账册后愿意谨慎协助",
          goals: [{
            goalRef: "goal:stage3:protect-home",
            description: "守住房屋与家人留下的秘密。",
          }],
          plans: [{
            planRef: "plan:stage3:inspect-ledger",
            description: "核对账册上的新痕迹。",
          }],
        },
        privateNotes: PLAYER_SECRET_CANARY,
      },
    });
    const publicRead = record(record(await authority.observe(ALICE), "observer").readModel, "read model");
    expect(record(publicRead.publicExpression, "public expression").characters).toEqual(expect.arrayContaining([
      expect.objectContaining({ characterRef: LIAN_ID, voice: "短句、克制，称呼来客为诸位", attitude: "谨慎地表示愿意协助" }),
    ]));
    const revisionEvents = eventsOf(snapshot, "SemanticDefinitionRevised");
    expect(revisionEvents).toHaveLength(1);
    const revisionPayload = eventPayload(revisionEvents[0]);
    expect(revisionPayload).toMatchObject({
      definitionRef: NPC_DEFINITION_REF,
      baseRevision: "1",
      baseHash: seed.initialNpcDefinition.definitionHash,
      nextDefinition: { definitionId: NPC_DEFINITION_REF, revision: "2" },
    });
    expect(revisionPayload).not.toHaveProperty("operations");
    expect(revisionPayload).not.toHaveProperty("patch");
    expect(JSON.stringify(revisionPayload)).not.toContain("JSON Patch");

    const actorNarrations = narrationForViewer(kp, `${ALICE.principal.id}\u001f${ALICE_ID}`);
    expect(actorNarrations).toHaveLength(1);
    expect(claimKinds(actorNarrations[0])).toEqual(expect.arrayContaining([
      "definitionRevised",
      "actionCommitted",
    ]));
    expect(claimKinds(actorNarrations[0])).not.toEqual(["actionCommitted"]);
    expect(JSON.stringify(actorNarrations[0])).not.toContain(NPC_SUMMARY_CANARY);
    expect(JSON.stringify(actorNarrations[0])).not.toContain(PLAYER_SECRET_CANARY);

    const beforeRejected = await roomSnapshot(authority);
    const narrationCountBefore = kp.counters.narrate;
    const proposalCountBefore = kp.counters.propose;
    const stalePrepared: PreparedCapture = { all: [] };
    const staleKp = new DeterministicKp(
      (requestValue) => npcRevisionProposal(requestValue, {
        staleBase: seed.initialNpcDefinition,
      }),
      stalePrepared,
    );
    const staleOutcome = record(await runAction({
      authority,
      principal: ALICE,
      action: intent(
        "submission:stage3:npc-stale-base",
        "基于过期人物定义继续修改莉安。",
      ),
      kp: staleKp,
      counters,
      prepared: stalePrepared,
    }), "stale NPC sparse revision outcome");
    expect(staleOutcome).toMatchObject({
      kind: "rejected",
      action: "notCommitted",
      narration: "notApplicable",
      code: "DEFINITION_CONFLICT",
    });
    expect(staleKp.counters).toMatchObject({ propose: 1, narrate: 0 });
    expect(kp.counters.narrate).toBe(narrationCountBefore);
    expect(kp.counters.propose).toBe(proposalCountBefore);
    const afterRejected = await roomSnapshot(authority);
    expect(afterRejected.events).toEqual(beforeRejected.events);
    expect(definitions(afterRejected.state)[NPC_DEFINITION_REF]).toEqual(currentNpc);

    await evictDurableObject(authority as never);
    const afterEviction = await roomSnapshot(authority);
    expect(definitions(afterEviction.state)[NPC_DEFINITION_REF]).toEqual(currentNpc);
    expect(afterEviction.events).toEqual(beforeRejected.events);
  });

  it("rejects a vNext commit before persistence when its committed-range projection has no frozen Claims", async () => {
    const { authority } = await initializeRoom("kp-vnext-stage3-room-missing-claims");
    const counters = emptyActionCounters();
    const prepared: PreparedCapture = { all: [] };
    const kp = new DeterministicKp((request) => ropeProposal(request), prepared);
    const before = await roomSnapshot(authority);

    const outcome = record(await runAction({
      authority,
      principal: ALICE,
      action: intent(
        "submission:stage3:missing-claims",
        "我用稳定火源烧断麻绳，让悬挂的重物落下。",
      ),
      kp,
      counters,
      prepared,
      transformCommittedProjection(projection) {
        const withoutClaims = structuredClone(
          record(projection, "committed-range observer projection"),
        );
        delete withoutClaims.renderableClaims;
        return withoutClaims as ReturnType<VersionedRulesRuntime["project"]>;
      },
    }), "missing Claims outcome");

    expect(outcome).toMatchObject({
      kind: "rejected",
      code: "projectionFailure",
      action: "notCommitted",
      narration: "notApplicable",
    });
    expect(kp.counters).toMatchObject({ propose: 1, narrate: 0 });
    expect(counters).toMatchObject({ rolls: 0, publishDelivery: 0 });
    expect(await roomSnapshot(authority)).toEqual(before);
  });

  it("retries a post-randomness Claims projection failure with the frozen proposal and die face", async () => {
    const { authority } = await initializeRoom("kp-vnext-stage3-room-random-claims-retry");
    const counters = emptyActionCounters();
    const prepared: PreparedCapture = { all: [] };
    const kp = new DeterministicKp((request) => gunProposal(request, 1), prepared);
    const action = intent(
      "submission:stage3:random-claims-retry",
      "我用枪打断吊灯的支撑，让它砸向下面的敌人。",
    );

    const failed = record(await runAction({
      authority,
      principal: ALICE,
      action,
      kp,
      counters,
      prepared,
      rolls: [7, 20, 1], // attack check plus frozen possible concentration dice
      transformCommittedProjection(projection) {
        const withoutClaims = structuredClone(
          record(projection, "random committed-range observer projection"),
        );
        delete withoutClaims.renderableClaims;
        return withoutClaims as ReturnType<VersionedRulesRuntime["project"]>;
      },
    }), "post-randomness Claims projection failure");
    expect(failed).toMatchObject({
      kind: "retryableFailure",
      code: "projectionFailure",
      action: "notCommitted",
      narration: "notApplicable",
    });
    expect(kp.counters).toMatchObject({ propose: 1, narrate: 0 });
    expect(counters).toMatchObject({ rolls: 3, publishDelivery: 0 });

    const journaled = await roomSnapshot(authority);
    expect(eventsOf(journaled, "RandomnessRequested")).toHaveLength(1);
    expect(eventsOf(journaled, "DiceRolled")).toHaveLength(0);
    expect(eventsOf(journaled, "WorldInteractionResolved")).toHaveLength(0);
    expect(eventsOf(journaled, "ItemUsed")).toHaveLength(0);
    expect(itemEntries(journaled.state)[AMMO_ENTRY_REF]).toMatchObject({ quantity: 8 });
    expect(entities(journaled.state)[BOB_ID]).toMatchObject({
      hitPoints: { current: 20, maximum: 20 },
    });

    await evictDurableObject(authority as never);
    const recovered = record(await runAction({
      authority,
      principal: ALICE,
      action,
      kp,
      counters,
      prepared,
    }), "same-intent randomness recovery");
    expect(recovered, JSON.stringify(recovered)).toMatchObject({
      kind: "committed",
      action: "committed",
      narration: "published",
    });
    expect(kp.counters.propose).toBe(1);
    expect(counters.rolls).toBe(3);

    const committed = await roomSnapshot(authority);
    expect(eventsOf(committed, "RandomnessRequested")).toHaveLength(1);
    expect(eventsOf(committed, "DiceRolled")).toHaveLength(1);
    expect(eventsOf(committed, "WorldInteractionResolved")).toHaveLength(1);
    expect(eventsOf(committed, "ItemUsed")).toHaveLength(1);
    expect(itemEntries(committed.state)[AMMO_ENTRY_REF]).toMatchObject({ quantity: 7 });
    expect(entities(committed.state)[BOB_ID]).toMatchObject({
      hitPoints: { current: 14, maximum: 20 },
    });
    expect(eventPayload(eventsOf(committed, "WorldInteractionResolved")[0])).toMatchObject({
      branch: "success",
      check: { selectedRoll: 7, succeeded: true },
    });
  });

  it("runs natural-language gun versus chandelier with frozen costs, hazard damage, claims-only narration recovery, and idempotency across eviction", async () => {
    const { authority } = await initializeRoom("kp-vnext-stage3-room-gun-success");
    const counters = emptyActionCounters();
    const prepared: PreparedCapture = { all: [] };
    const actorViewerKey = `${ALICE.principal.id}\u001f${ALICE_ID}`;
    const kp = new DeterministicKp(
      (request) => gunProposal(request, 1),
      prepared,
      actorViewerKey,
    );
    const action = intent(
      "submission:stage3:gun-success",
      "我用枪打断吊灯的支撑，让它砸向下面的敌人。",
    );

    const outcome = record(await runAction({
      authority,
      principal: ALICE,
      action,
      kp,
      counters,
      prepared,
      rolls: [7, 20, 1], // attack check plus frozen possible concentration dice
    }), "gun/chandelier outcome");
    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      kind: "committed",
      action: "committed",
      narration: "retryableFailure",
      receipt: { rootActionId: expect.any(String), receiptId: expect.any(String) },
    });
    expect(kp.counters).toMatchObject({ propose: 1, decideDueActorPlan: 0 });
    expect(counters.rolls).toBe(3);

    const proposalRequest = kp.proposalRequests[0];
    const context = requiredContext(proposalRequest);
    const scene = contextEntry(context, SCENE_REF);
    expect(record(scene.combatScene, "RequiredContext combat scene")).toHaveProperty("geometry");
    expect(contextEntry(context, CHAIN_REF)).toMatchObject({
      content: {
        materialDescription: expect.stringContaining("普通锻铁"),
        observableState: "仍在承重",
      },
    });
    expect(contextEntry(context, CHAIN_SUPPORT_REF)).toMatchObject({
      content: { kind: "supports", subjectRef: CHAIN_REF, objectRef: CHANDELIER_REF },
    });
    expect(contextEntry(context, AMMO_ENTRY_REF)).toMatchObject({
      entryId: AMMO_ENTRY_REF,
      quantity: 8,
      holderRef: ALICE_ID,
    });
    expect(contextEntry(context, "continuity:adjudicationPrecedents")).toEqual({ selectedRefs: [], scopeRef: SCENE_REF });
    const abilityRef = pistolAbility(context);
    expect(context.binding.readSet).toEqual([]);
    expect(context.entries.map(({ entryRef }) => entryRef)).toEqual(expect.arrayContaining([
      ALICE_ID,
      BOB_ID,
      SCENE_REF,
      CHAIN_REF,
      CHANDELIER_REF,
      CHAIN_SUPPORT_REF,
      HIDDEN_TARGET_RELATION_CANARY,
      PISTOL_ENTRY_REF,
      AMMO_ENTRY_REF,
      abilityRef,
    ]));

    const committed = await roomSnapshot(authority);
    const ammo = record(itemEntries(committed.state)[AMMO_ENTRY_REF], "post-shot ammunition");
    expect(ammo.quantity).toBe(7);
    const support = record(definitions(committed.state)[CHAIN_SUPPORT_REF], "ended chain support");
    expect(support).toMatchObject({ revision: "2", content: { state: "ended" } });
    expect(definitions(committed.state)[CHANDELIER_REF]).toMatchObject({
      revision: "2",
      content: { observableState: "已坠落并形成残骸" },
    });
    expect(entities(committed.state)[BOB_ID]).toMatchObject({
      hitPoints: { current: 14, maximum: 20 },
    });
    expect(eventsOf(committed, "ItemUsed")).toHaveLength(1);
    expect(eventsOf(committed, "RandomnessRequested")).toHaveLength(1);
    expect(eventsOf(committed, "DiceRolled")).toHaveLength(1);
    expect(eventsOf(committed, "AbilityInvoked")).toHaveLength(1);
    expect(eventsOf(committed, "WorldInteractionResolved")).toHaveLength(1);
    expect(eventsOf(committed, "DamagePacketResolved")).toHaveLength(1);
    expect(eventPayload(eventsOf(committed, "AbilityInvoked")[0])).toMatchObject({
      sourceEntityId: ALICE_ID,
      abilityRef,
      mechanicalResult: { targetRefs: [CHAIN_REF] },
    });
    const randomness = eventPayload(eventsOf(committed, "RandomnessRequested")[0]);
    const resolutionPlan = record(randomness.resolutionPlan, "world-interaction resolution plan");
    expect(resolutionPlan).toMatchObject({
      targetRefs: [CHAIN_REF, CHANDELIER_REF].sort(),
      directTargetRefs: [CHAIN_REF],
      ruling: { kind: "check", resolutionKind: "attack" },
    });
    const planReadSet = list(resolutionPlan.readSet, "world-interaction plan read set")
      .map((entry) => record(entry, "world-interaction read binding"));
    const planReadRefs = planReadSet.map((entry) => String(entry.ref));
    expect(planReadRefs).toEqual(expect.arrayContaining([
      ALICE_ID,
      BOB_ID,
      SCENE_REF,
      CHAIN_REF,
      CHANDELIER_REF,
      IMPACT_ZONE_REF,
      CHAIN_SUPPORT_REF,
      HIDDEN_TARGET_RELATION_CANARY,
      PISTOL_ENTRY_REF,
      AMMO_ENTRY_REF,
      abilityRef,
    ]));
    expect(planReadRefs.filter((ref) => [
      FIRE_SOURCE_ENTRY_REF,
      ROPE_REF,
      PRESSURE_PLATE_REF,
      NPC_DEFINITION_REF,
    ].includes(ref))).toEqual([]);
    expect(planReadRefs.length).toBeLessThan(
      context.entries.filter(({ kind }) => kind === "known").length,
    );
    expect(planReadSet.every((entry) => typeof entry.revisionOrHash === "string"
      && String(entry.revisionOrHash).length > 0)).toBe(true);
    const resolved = eventPayload(eventsOf(committed, "WorldInteractionResolved")[0]);
    expect(resolved).toMatchObject({
      abilityRef,
      branch: "success",
      rulingKind: "check",
      directTargetRefs: [CHAIN_REF],
      check: { resolutionKind: "attack", selectedRoll: 7, dc: 1, succeeded: true },
      appliedEffects: expect.arrayContaining([
        expect.objectContaining({ kind: "itemCost", entryRef: AMMO_ENTRY_REF, quantityAfter: 7 }),
        expect.objectContaining({ kind: "relationTransition", relationRef: CHAIN_SUPPORT_REF }),
        expect.objectContaining({ kind: "damage", targetRef: BOB_ID, amount: 6 }),
      ]),
    });

    const failedNarration = narrationForViewer(kp, actorViewerKey)[0];
    expect(failedNarration).toBeDefined();
    expect(claimKinds(failedNarration)).toEqual(expect.arrayContaining([
      "abilityEffectApplied",
      "mechanicalOutcome",
      "inventoryOutcome",
      "relationChanged",
      "sceneFeature",
      "sensoryEvidence",
      "pressure",
      "opportunity",
      "actionCommitted",
    ]));
    expect(JSON.stringify(failedNarration)).not.toContain(HIDDEN_TARGET_RELATION_CANARY);

    const observation = record(await authority.observe(ALICE), "failed narration observation");
    const recovery = record(observation.narrationRecovery, "narration recovery capability");
    expect(recovery).toMatchObject({
      kind: "available",
      state: "retryableFailure",
      capability: expect.any(String),
    });
    const mechanicalSnapshot = await roomSnapshot(authority);
    const proposalCountBeforeRecovery = kp.counters.propose;
    const rollCountBeforeRecovery = counters.rolls;
    const recovered = record(await handleViewerNarrationRecovery({
      principal: ALICE,
      authority: instrumentAuthority(authority, counters, prepared),
      kp,
    }, String(recovery.capability)), "claims-only narration recovery outcome");
    expect(recovered).toMatchObject({
      kind: "committed",
      action: "committed",
      narration: "published",
    });
    expect(kp.counters.propose).toBe(proposalCountBeforeRecovery);
    expect(counters.rolls).toBe(rollCountBeforeRecovery);
    const actorNarrations = narrationForViewer(kp, actorViewerKey);
    expect(actorNarrations).toHaveLength(2);
    expect(actorNarrations[1]).not.toHaveProperty("audienceId");
    expect(actorNarrations[1].narrationPurpose).toBe("narrationRecovery");
    expect(actorNarrations[1].receipt).toEqual(actorNarrations[0].receipt);
    expect(actorNarrations[1].renderableClaims).toEqual(actorNarrations[0].renderableClaims);
    expect(actorNarrations[1].narrationContext).toEqual(actorNarrations[0].narrationContext);
    const firstClaims = record(actorNarrations[0].renderableClaims, "first frozen claims");
    const retryClaims = record(actorNarrations[1].renderableClaims, "retry frozen claims");
    expect(retryClaims.claimsHash).toBe(firstClaims.claimsHash);
    expect(retryClaims.projectionHash).toBe(firstClaims.projectionHash);
    expect(retryClaims.claims).toEqual(firstClaims.claims);
    expect(await roomSnapshot(authority)).toEqual(mechanicalSnapshot);

    const stableCounts = {
      proposals: kp.counters.propose,
      narrations: kp.counters.narrate,
      rolls: counters.rolls,
      publication: counters.publishDelivery,
    };
    const responseLostRetry = record(await runAction({
      authority,
      principal: ALICE,
      action,
      kp,
      counters,
      prepared,
    }), "response-lost idempotent retry");
    expect(responseLostRetry.receipt).toEqual(outcome.receipt);
    expect(kp.counters.propose).toBe(stableCounts.proposals);
    expect(kp.counters.narrate).toBe(stableCounts.narrations);
    expect(counters.rolls).toBe(stableCounts.rolls);
    expect(counters.publishDelivery).toBe(stableCounts.publication);
    expect(await roomSnapshot(authority)).toEqual(mechanicalSnapshot);

    await evictDurableObject(authority as never);
    const evictionRetry = record(await runAction({
      authority,
      principal: ALICE,
      action,
      kp,
      counters,
      prepared,
    }), "post-eviction idempotent retry");
    expect(evictionRetry.receipt).toEqual(outcome.receipt);
    expect(kp.counters.propose).toBe(stableCounts.proposals);
    expect(kp.counters.narrate).toBe(stableCounts.narrations);
    expect(counters.rolls).toBe(stableCounts.rolls);
    expect(counters.publishDelivery).toBe(stableCounts.publication);
    expect(await roomSnapshot(authority)).toEqual(mechanicalSnapshot);
  });

  it("honestly settles a non-natural DC 40 gun failure by consuming frozen ammunition without breaking the support or applying damage", async () => {
    const { authority } = await initializeRoom("kp-vnext-stage3-room-gun-failure");
    const counters = emptyActionCounters();
    const prepared: PreparedCapture = { all: [] };
    const kp = new DeterministicKp((request) => gunProposal(request, 40), prepared);
    const outcome = record(await runAction({
      authority,
      principal: ALICE,
      action: intent(
        "submission:stage3:gun-failure",
        "我用枪打断吊灯的支撑，让它砸向下面的敌人。",
      ),
      kp,
      counters,
      prepared,
      rolls: [19, 20, 1],
    }), "DC 40 gun failure outcome");
    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      kind: "committed",
      action: "committed",
      narration: "published",
    });
    const snapshot = await roomSnapshot(authority);
    expect(itemEntries(snapshot.state)[AMMO_ENTRY_REF]).toMatchObject({ quantity: 7 });
    expect(definitions(snapshot.state)[CHAIN_SUPPORT_REF]).toMatchObject({
      revision: "1",
      content: { state: "active" },
    });
    expect(definitions(snapshot.state)[CHANDELIER_REF]).toMatchObject({
      revision: "1",
      content: { observableState: "悬挂在半空" },
    });
    expect(entities(snapshot.state)[BOB_ID]).toMatchObject({
      hitPoints: { current: 20, maximum: 20 },
    });
    expect(eventsOf(snapshot, "ItemUsed")).toHaveLength(1);
    expect(eventsOf(snapshot, "SemanticDefinitionRevised")).toHaveLength(0);
    expect(eventsOf(snapshot, "DamagePacketResolved")).toHaveLength(0);
    const resolved = eventPayload(eventsOf(snapshot, "WorldInteractionResolved")[0]);
    expect(resolved).toMatchObject({
      branch: "failure",
      check: { resolutionKind: "attack", selectedRoll: 19, dc: 40, succeeded: false },
      appliedEffects: [expect.objectContaining({
        kind: "itemCost",
        entryRef: AMMO_ENTRY_REF,
        quantityBefore: 8,
        quantityAfter: 7,
      })],
    });
    const actorNarration = narrationForViewer(
      kp,
      `${ALICE.principal.id}\u001f${ALICE_ID}`,
    )[0];
    expect(claimKinds(actorNarration)).toEqual(expect.arrayContaining([
      "mechanicalOutcome",
      "inventoryOutcome",
      "sensoryEvidence",
      "pressure",
      "opportunity",
      "actionCommitted",
    ]));
    expect(claimKinds(actorNarration)).not.toContain("relationChanged");
    expect(JSON.stringify(actorNarration)).not.toContain(HIDDEN_TARGET_RELATION_CANARY);
  });

  it("preserves D&D 5e attack natural-20 success and natural-1 failure across the Room authority seam", async () => {
    const naturalTwenty = await initializeRoom("kp-vnext-stage3-room-attack-natural-20");
    const twentyCounters = emptyActionCounters();
    const twentyPrepared: PreparedCapture = { all: [] };
    const twentyKp = new DeterministicKp(
      (request) => gunProposal(request, 40),
      twentyPrepared,
    );
    const twentyOutcome = record(await runAction({
      authority: naturalTwenty.authority,
      principal: ALICE,
      action: intent(
        "submission:stage3:attack-natural-20",
        "我用燧发手枪瞄准吊灯的支撑发起攻击，让悬挂物落入下方区域。",
      ),
      kp: twentyKp,
      counters: twentyCounters,
      prepared: twentyPrepared,
      rolls: [20, 20, 1],
    }), "natural-20 attack outcome");
    expect(twentyOutcome).toMatchObject({ kind: "committed", action: "committed" });
    const afterTwenty = await roomSnapshot(naturalTwenty.authority);
    expect(eventPayload(eventsOf(afterTwenty, "WorldInteractionResolved")[0])).toMatchObject({
      branch: "success",
      check: {
        resolutionKind: "attack",
        selectedRoll: 20,
        dc: 40,
        succeeded: true,
      },
    });
    expect(definitions(afterTwenty.state)[CHAIN_SUPPORT_REF]).toMatchObject({
      revision: "2",
      content: { state: "ended" },
    });

    const naturalOne = await initializeRoom("kp-vnext-stage3-room-attack-natural-1");
    const oneCounters = emptyActionCounters();
    const onePrepared: PreparedCapture = { all: [] };
    const oneKp = new DeterministicKp(
      (request) => gunProposal(request, 1),
      onePrepared,
    );
    const oneOutcome = record(await runAction({
      authority: naturalOne.authority,
      principal: ALICE,
      action: intent(
        "submission:stage3:attack-natural-1",
        "我用燧发手枪瞄准吊灯的支撑发起攻击，让悬挂物落入下方区域。",
      ),
      kp: oneKp,
      counters: oneCounters,
      prepared: onePrepared,
      rolls: [1, 20, 1],
    }), "natural-1 attack outcome");
    expect(oneOutcome).toMatchObject({ kind: "committed", action: "committed" });
    const afterOne = await roomSnapshot(naturalOne.authority);
    expect(eventPayload(eventsOf(afterOne, "WorldInteractionResolved")[0])).toMatchObject({
      branch: "failure",
      check: {
        resolutionKind: "attack",
        selectedRoll: 1,
        dc: 1,
        succeeded: false,
      },
    });
    expect(definitions(afterOne.state)[CHAIN_SUPPORT_REF]).toMatchObject({
      revision: "1",
      content: { state: "active" },
    });
    expect(itemEntries(afterOne.state)[AMMO_ENTRY_REF]).toMatchObject({ quantity: 7 });
  });

  it("reuses the same world-interaction path for burning a rope and keeps a stone trap inquiry separate from concrete evidence and hidden trigger facts", async () => {
    const { authority } = await initializeRoom("kp-vnext-stage3-room-generic-interactions");
    const counters = emptyActionCounters();

    const ropePrepared: PreparedCapture = { all: [] };
    const ropeKp = new DeterministicKp((request) => ropeProposal(request), ropePrepared);
    const ropeOutcome = record(await runAction({
      authority,
      principal: ALICE,
      action: intent(
        "submission:stage3:burn-rope",
        "我用稳定火源烧断绳索，让下面的重物坠落。",
      ),
      kp: ropeKp,
      counters,
      prepared: ropePrepared,
      rolls: [20, 1], // frozen concentration reserve; the actor still makes no check
    }), "burn-rope interaction outcome");
    expect(ropeOutcome, JSON.stringify(ropeOutcome)).toMatchObject({
      kind: "committed",
      action: "committed",
      narration: "published",
    });
    const ropeProposalValue = record(ropeKp.proposalRequests[0], "rope proposal request");
    const ropeContext = requiredContext(ropeProposalValue);
    expect(contextEntry(ropeContext, FIRE_SOURCE_ENTRY_REF)).toMatchObject({
      entryId: FIRE_SOURCE_ENTRY_REF,
      holderRef: ALICE_ID,
      quantity: 1,
      condition: "usable",
    });
    expect(contextEntry(ropeContext, FIRE_SOURCE_DEFINITION_REF)).toMatchObject({
      content: {
        label: "稳定燃烧的火把",
        description: expect.stringContaining("火焰稳定且当前可用"),
      },
    });
    expect(ropeContext.binding.readSet).toEqual([]);
    expect(ropeContext.entries.map(({ entryRef }) => entryRef)).toEqual(expect.arrayContaining([
      FIRE_SOURCE_ENTRY_REF,
      FIRE_SOURCE_DEFINITION_REF,
      ROPE_REF,
      WEIGHT_REF,
      ROPE_SUPPORT_REF,
    ]));
    const ropeReturnedProposal = singleProposalBundleEntry(ropeProposal(ropeProposalValue));
    expect(ropeReturnedProposal).toMatchObject({
      formId: VNEXT_WORLD_INTERACTION_FORM_ID,
      proposal: {
        kind: "worldInteraction",
        abilityRef: null,
        directTargetRefs: [ROPE_REF],
        instrumentRefs: [FIRE_SOURCE_ENTRY_REF],
      },
    });
    expect(JSON.stringify(ropeReturnedProposal)).not.toMatch(/nodeId|dependsOn|compound/iu);

    const afterRope = await roomSnapshot(authority);
    expect(definitions(afterRope.state)[ROPE_SUPPORT_REF]).toMatchObject({
      revision: "2",
      content: { state: "ended" },
    });
    expect(definitions(afterRope.state)[WEIGHT_REF]).toMatchObject({
      revision: "2",
      content: { observableState: "已经坠落在地" },
    });
    expect(entities(afterRope.state)[BOB_ID]).toMatchObject({
      hitPoints: { current: 14, maximum: 20 },
    });
    expect(eventsOf(afterRope, "WorldInteractionResolved")).toHaveLength(1);
    expect(eventPayload(eventsOf(afterRope, "WorldInteractionResolved")[0])).toMatchObject({
      rulingKind: "directSuccess",
      branch: "success",
      instrumentRefs: [FIRE_SOURCE_ENTRY_REF],
      basisRefs: expect.arrayContaining([
        FIRE_SOURCE_ENTRY_REF,
        ROPE_REF,
        WEIGHT_REF,
        ROPE_SUPPORT_REF,
      ]),
      appliedEffects: expect.arrayContaining([
        expect.objectContaining({ kind: "relationTransition", relationRef: ROPE_SUPPORT_REF }),
        expect.objectContaining({ kind: "damage", targetRef: BOB_ID, amount: 6 }),
      ]),
    });

    const trapPrepared: PreparedCapture = { all: [] };
    const trapKp = new DeterministicKp((request) => trapProbeProposal(request), trapPrepared);
    const inquiry = "我把石头扔到压板上，看看机关是否会触发。";
    const trapOutcome = record(await runAction({
      authority,
      principal: ALICE,
      action: intent("submission:stage3:trap-probe", inquiry),
      kp: trapKp,
      counters,
      prepared: trapPrepared,
    }), "stone trap-probe outcome");
    expect(trapOutcome).toMatchObject({
      kind: "committed",
      action: "committed",
      narration: "published",
    });
    const trapContext = requiredContext(trapKp.proposalRequests[0]);
    expect(trapContext.intent.text).toBe(inquiry);
    expect(contextEntry(trapContext, STONE_ENTRY_REF)).toMatchObject({
      entryId: STONE_ENTRY_REF,
      holderRef: ALICE_ID,
      quantity: 1,
    });
    expect(contextEntry(trapContext, PRESSURE_PLATE_REF)).toMatchObject({
      content: {
        materialDescription: expect.stringContaining("普通石材"),
        observableState: "尚未被压下",
      },
    });
    expect(contextEntry(trapContext, HIDDEN_TRIGGER_RELATION_CANARY)).toMatchObject({
      visibilityPolicyRef: "visibility:room-authority-only",
      content: {
        kind: "triggers",
        subjectRef: PRESSURE_PLATE_REF,
        objectRef: TRAP_MECHANISM_REF,
      },
    });
    expect(JSON.stringify(trapContext)).toContain(HIDDEN_TRIGGER_RELATION_CANARY);
    expect(trapContext.binding.readSet).toEqual([]);
    expect(trapContext.entries.map(({ entryRef }) => entryRef)).toEqual(expect.arrayContaining([
      STONE_ENTRY_REF,
      PRESSURE_PLATE_REF,
      HIDDEN_TRIGGER_RELATION_CANARY,
    ]));
    const trapReturnedProposal = singleProposalBundleEntry(
      trapProbeProposal(trapKp.proposalRequests[0]),
    );
    expect(trapReturnedProposal).toMatchObject({
      formId: VNEXT_WORLD_INTERACTION_FORM_ID,
      proposal: {
        kind: "worldInteraction",
        instrumentRefs: [STONE_ENTRY_REF],
        targetRefs: [PRESSURE_PLATE_REF],
        directTargetRefs: [PRESSURE_PLATE_REF],
      },
    });
    expect(JSON.stringify(trapReturnedProposal)).not.toMatch(/nodeId|dependsOn|compound/iu);

    const afterTrap = await roomSnapshot(authority);
    expect(definitions(afterTrap.state)[PRESSURE_PLATE_REF]).toMatchObject({
      revision: "2",
      content: { observableState: "被石头压下后又缓慢复位" },
    });
    expect(definitions(afterTrap.state)[HIDDEN_TRIGGER_RELATION_CANARY]).toMatchObject({
      revision: "1",
      content: { state: "active" },
    });
    expect(itemEntries(afterTrap.state)[STONE_ENTRY_REF]).toMatchObject({ quantity: 1 });
    expect(eventsOf(afterTrap, "WorldInteractionResolved")).toHaveLength(2);
    const aliceKnowledge = record(
      record(afterTrap.state.knowledge, "authoritative knowledge")[ALICE_ID],
      "Alice authoritative knowledge",
    );
    const acquiredEvidence = Object.values(aliceKnowledge)
      .map((entry) => record(entry, "Alice knowledge record"))
      .find((entry) => entry.objectKind === "sensoryEvidence"
        && JSON.stringify(entry.content).includes(TRAP_SENSORY_EVIDENCE));
    expect(acquiredEvidence, "committed sensory evidence becomes character knowledge").toBeDefined();
    expect(JSON.stringify(acquiredEvidence)).not.toContain(HIDDEN_TRIGGER_RELATION_CANARY);
    expect(JSON.stringify(acquiredEvidence)).not.toContain(TRAP_MECHANISM_REF);
    const acquiredKnowledgeRef = String(acquiredEvidence?.knowledgeRef);
    const followUpPrepared = record(await authority.prepare(ALICE, intent(
      "submission:stage3:trap-follow-up-context",
      "我根据刚才听见的机括声，继续判断墙缝后有什么。",
    )), "trap evidence follow-up prepare");
    expect(followUpPrepared).toMatchObject({ kind: "prepared" });
    const followUpContext = requiredContext(followUpPrepared);
    const collectedEvidence = followUpContext.entries.find((entry) => entry.kind === "known"
      && JSON.stringify(entry.value).includes(TRAP_SENSORY_EVIDENCE));
    expect(collectedEvidence, "next RequiredContext collects committed sensory knowledge")
      .toBeDefined();
    expect(String(collectedEvidence?.entryRef)).toContain(acquiredKnowledgeRef);
    const trapResolution = eventPayload(eventsOf(afterTrap, "WorldInteractionResolved")[1]);
    expect(trapResolution).toMatchObject({
      instrumentRefs: [STONE_ENTRY_REF],
      targetRefs: [PRESSURE_PLATE_REF],
      directTargetRefs: [PRESSURE_PLATE_REF],
      basisRefs: expect.arrayContaining([
        STONE_ENTRY_REF,
        PRESSURE_PLATE_REF,
        HIDDEN_TRIGGER_RELATION_CANARY,
      ]),
      sensoryEvidence: [expect.objectContaining({
        basisRefs: expect.arrayContaining([
          PRESSURE_PLATE_REF,
          HIDDEN_TRIGGER_RELATION_CANARY,
        ]),
      })],
    });
    const trapNarration = narrationForViewer(
      trapKp,
      `${ALICE.principal.id}\u001f${ALICE_ID}`,
    )[0];
    const trapClaims = list(
      record(trapNarration.renderableClaims, "trap renderable claims").claims,
      "trap claim list",
    ).map((claim) => record(claim, "trap claim"));
    const evidence = trapClaims.find((claim) => claim.kind === "sensoryEvidence");
    expect(evidence).toMatchObject({
      evidence: TRAP_SENSORY_EVIDENCE,
    });
    expect(String(evidence?.evidence)).not.toContain("是否");
    expect(JSON.stringify(trapNarration)).not.toContain(inquiry);
    expect(JSON.stringify(trapNarration)).not.toContain(HIDDEN_TRIGGER_RELATION_CANARY);
    expect(JSON.stringify(trapNarration)).not.toContain(TRAP_MECHANISM_REF);

    expect(ropeReturnedProposal.formId).toBe(trapReturnedProposal.formId);
    expect(claimKinds(narrationForViewer(
      ropeKp,
      `${ALICE.principal.id}\u001f${ALICE_ID}`,
    )[0])).toEqual(expect.arrayContaining([
      "relationChanged",
      "mechanicalOutcome",
      "sensoryEvidence",
      "pressure",
      "opportunity",
      "actionCommitted",
    ]));
    expect(claimKinds(trapNarration)).toEqual(expect.arrayContaining([
      "mechanicalOutcome",
      "sensoryEvidence",
      "pressure",
      "opportunity",
      "actionCommitted",
    ]));
    expect(eventsOf(afterTrap, "WorldInteractionResolved").every((event) =>
      event.eventType === "WorldInteractionResolved")).toBe(true);
  });

  it("materializes a new scene object and interacts with it through its prospective handle as one atomic Rules transaction, never partially", async () => {
    const { authority } = await initializeRoom("kp-vnext-stage3-room-materialize-interact");
    const before = await roomSnapshot(authority);

    // Sub-case 1: a broken produces/consumes graph -- the interact entry
    // consumes a handle nothing in the Bundle produces -- must commit
    // nothing at all, not even the otherwise independently-valid
    // materialize step. If the atomic transaction were not truly atomic,
    // a naive per-entry executor could have committed the materialize step
    // before ever reaching the broken interact step.
    {
      const counters = emptyActionCounters();
      const prepared: PreparedCapture = { all: [] };
      const kp = new DeterministicKp(
        (request) => materializeAndInspectBrokenGraphProposal(request),
        prepared,
        undefined,
        false,
      );
      const outcome = record(await runAction({
        authority,
        principal: ALICE,
        action: intent(
          "submission:stage3:materialize-interact-broken-graph",
          "角色仔细检查墙面，发现一个新壁龛并靠近查看内部。",
        ),
        kp,
        counters,
        prepared,
      }), "broken produces/consumes graph outcome");
      expect(outcome).toMatchObject({
        kind: "rejected",
        code: "BUNDLE_DEPENDENCY_INVALID",
        action: "notCommitted",
        narration: "notApplicable",
      });
      expect(kp.counters).toMatchObject({ propose: 1, narrate: 0 });
      expect(counters.rolls).toBe(0);
      expect(await roomSnapshot(authority)).toEqual(before);
    }

    // Sub-case 2: the exact same materialize entry, submitted alone in a
    // separate Room, independently commits -- proving sub-case 1's
    // rejection came from the broken graph and not from anything wrong
    // with the materialize step by itself. A separate Room keeps this
    // commit out of sub-case 3's event-count assertions below.
    {
      const { authority: aloneAuthority } = await initializeRoom(
        "kp-vnext-stage3-room-materialize-alone",
      );
      const counters = emptyActionCounters();
      const prepared: PreparedCapture = { all: [] };
      const kp = new DeterministicKp((request) => materializeAlcoveAloneProposal(request), prepared);
      const outcome = record(await runAction({
        authority: aloneAuthority,
        principal: ALICE,
        action: intent(
          "submission:stage3:materialize-alone",
          "角色仔细检查墙面，发现一个新壁龛。",
        ),
        kp,
        counters,
        prepared,
      }), "standalone materialize outcome");
      expect(outcome).toMatchObject({ kind: "committed", action: "committed", narration: "published" });
      expect(counters.rolls).toBe(0);
      const aloneSnapshot = await roomSnapshot(aloneAuthority);
      expect(eventsOf(aloneSnapshot, "SemanticDefinitionMaterialized")).toHaveLength(1);
    }

    // Sub-case 3: the real vertical. A correctly-linked two-entry Bundle
    // commits as one Rules transaction with one Receipt, and the interact
    // step addresses the brand-new object purely through its bundle-local
    // prospective handle -- the KP never names, and Room never accepts, the
    // definitionRef itself.
    const counters = emptyActionCounters();
    const prepared: PreparedCapture = { all: [] };
    const kp = new DeterministicKp((request) => materializeAndInspectAlcoveProposal(request), prepared);
    const action = intent(
      "submission:stage3:materialize-interact",
      "角色仔细检查墙面，发现一个新壁龛并靠近查看内部。",
    );
    const outcome = record(await runAction({
      authority,
      principal: ALICE,
      action,
      kp,
      counters,
      prepared,
    }), "materialize + interact outcome");
    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      kind: "committed",
      action: "committed",
      narration: "published",
      receipt: { rootActionId: expect.any(String), receiptId: expect.any(String) },
    });
    expect(kp.counters).toMatchObject({ propose: 1 });
    expect(counters.rolls).toBe(0);

    const committed = await roomSnapshot(authority);
    expect(eventsOf(committed, "SemanticDefinitionMaterialized")).toHaveLength(1);
    expect(eventsOf(committed, "WorldInteractionResolved")).toHaveLength(1);
    const settlementEvents = eventsOf(committed, "AtomicWorldInteractionStepsResolved");
    expect(settlementEvents).toHaveLength(1);
    const mapStep = (raw: unknown) => {
      const step = record(raw, "atomic settlement step");
      return { proposalRef: String(step.proposalRef), status: String(step.status) };
    };
    const settlementSteps = list(
      eventPayload(settlementEvents[0]).steps,
      "atomic settlement steps",
    ).map(mapStep);
    expect(settlementSteps.map((step) => step.status)).toEqual(["applied", "applied"]);

    // ONE Receipt covers the whole atomic transaction: the Receipt this
    // Room action returned already records both steps as applied.
    const rootActionId = String(record(outcome.receipt, "committed receipt").rootActionId);
    const receiptRecord = record(
      record(committed.state.receipts, "state receipts")[rootActionId],
      "the one Receipt for this RootAction",
    );
    const receiptSettlementSteps = list(
      record(receiptRecord.proposalBundleSettlement, "Receipt bundle settlement").steps,
      "Receipt settlement steps",
    ).map(mapStep);
    expect(receiptSettlementSteps).toEqual(settlementSteps);

    const materializedPayload = eventPayload(eventsOf(committed, "SemanticDefinitionMaterialized")[0]);
    const resolvedPayload = eventPayload(eventsOf(committed, "WorldInteractionResolved")[0]);
    const alcoveRef = String(materializedPayload.definitionRef);
    // The interaction step never saw the raw handle by the time its event
    // was built -- Rules substituted it for the real definitionRef first.
    expect(resolvedPayload.targetRefs).toEqual([alcoveRef]);
    expect(resolvedPayload.directTargetRefs).toEqual([alcoveRef]);
    expect(alcoveRef).not.toContain("prospective:");
    expect(definitions(committed.state)[alcoveRef]).toMatchObject({
      semanticKind: "sceneFeature",
      content: {
        sceneRef: SCENE_REF,
        label: "新出现的壁龛",
        observableState: "刚刚露出",
      },
    });

    const narration = narrationForViewer(kp, `${ALICE.principal.id}${ALICE_ID}`)[0];
    expect(narration).toBeDefined();
    expect(claimKinds(narration)).toEqual(expect.arrayContaining([
      "definitionRevised",
      "sceneFeature",
      "mechanicalOutcome",
      "actionCommitted",
    ]));
    // Authority-only refs (bundleHash/prospectiveRef/contextHash and the raw
    // handle itself) must never reach a player-visible Claim or Narration.
    expect(JSON.stringify(narration)).not.toContain("prospective:");

    // Replay determinism: evicting and reconstructing the Durable Object
    // from genesis+events alone must reproduce byte-identical state and an
    // identical state hash.
    const stateHashBeforeEviction = await roomStateHash(authority);
    await evictDurableObject(authority as never);
    const afterEviction = await roomSnapshot(authority);
    expect(afterEviction).toEqual(committed);
    expect(await roomStateHash(authority)).toBe(stateHashBeforeEviction);
  });

  it("commits a materialized object after the KP applies exactly one internal correction before ever proposing to the Room", async () => {
    const { authority } = await initializeRoom("kp-vnext-stage3-room-materialize-correction");
    const counters = emptyActionCounters();
    const prepared: PreparedCapture = { all: [] };
    let correctionsApplied = 0;
    const kp = new DeterministicKp((request) => {
      // Mirrors what the strict-tool provider's own correction round trip
      // (proposal-correction.ts/proposal-provider.ts, already covered by
      // deepseek-strict-tool-provider.test.mjs) does upstream of Room: the
      // first candidate Bundle violates the frozen contract, exactly one
      // repair pass fixes it, and Room's kp.propose() is called only once
      // with the final, already-corrected Bundle -- Room cannot tell a
      // corrected Bundle apart from one that needed no correction.
      const draftBundle = invalidSemanticKindAlcoveProposal(request);
      const draftValidation = validateVNextProposalBundle(draftBundle);
      expect(draftValidation.kind, "the uncorrected draft must itself be invalid").toBe("rejected");
      correctionsApplied += 1;
      return materializeAlcoveAloneProposal(request);
    }, prepared);

    const outcome = record(await runAction({
      authority,
      principal: ALICE,
      action: intent(
        "submission:stage3:materialize-correction",
        "角色仔细检查墙面，发现一个新壁龛。",
      ),
      kp,
      counters,
      prepared,
    }), "corrected materialize outcome");

    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      kind: "committed",
      action: "committed",
      narration: "published",
    });
    // Room saw exactly one propose() call; the correction happened entirely
    // upstream of it.
    expect(kp.counters).toMatchObject({ propose: 1 });
    expect(correctionsApplied).toBe(1);
    expect(counters.rolls).toBe(0);

    const committed = await roomSnapshot(authority);
    expect(eventsOf(committed, "SemanticDefinitionMaterialized")).toHaveLength(1);
  });

  it("rejects a materializeObject entry that violates the frozen semanticKind contract before Rules, randomness, or persistence", async () => {
    const { authority } = await initializeRoom("kp-vnext-stage3-room-materialize-invalid-schema");
    const counters = emptyActionCounters();
    const prepared: PreparedCapture = { all: [] };
    const kp = new DeterministicKp(
      (request) => invalidSemanticKindAlcoveProposal(request),
      prepared,
      undefined,
      false,
    );
    const before = await roomSnapshot(authority);

    const outcome = record(await runAction({
      authority,
      principal: ALICE,
      action: intent(
        "submission:stage3:materialize-invalid-schema",
        "角色仔细检查墙面，发现一个新壁龛并靠近查看内部。",
      ),
      kp,
      counters,
      prepared,
    }), "invalid materializeObject schema outcome");

    expect(outcome).toMatchObject({
      kind: "rejected",
      code: "PROPOSAL_BUNDLE_INVALID",
      action: "notCommitted",
      narration: "notApplicable",
    });
    expect(kp.counters).toMatchObject({ propose: 1, narrate: 0 });
    expect(counters.rolls).toBe(0);
    expect(await roomSnapshot(authority)).toEqual(before);
  });

  // -- vnext-2 ProposalBundle bridged to the real Room path ---------------
  // Proves deliverable B/C: the schema id-`vnext-2` contract
  // (proposal-schema.ts/proposal-graph.ts/proposal-validator.ts) now lowers
  // through room-bridge.ts into the exact same Rules primitives as vnext-1,
  // not only at the unit level.

  it("lowers a vnext-2 Bundle: materializes a new scene object and interacts with it through its prospective handle as one atomic Rules transaction, never partially", async () => {
    const { authority } = await initializeRoom("kp-vnext2-stage3-room-materialize-interact");
    const before = await roomSnapshot(authority);

    // Sub-case 1: a broken produces/consumes graph must commit nothing at
    // all, not even the otherwise independently-valid materialize step.
    {
      const counters = emptyActionCounters();
      const prepared: PreparedCapture = { all: [] };
      const kp = new DeterministicKp(
        () => materializeAndInspectBrokenGraphBundleV2(),
        prepared,
        undefined,
        false,
      );
      const outcome = record(await runAction({
        authority,
        principal: ALICE,
        action: intent(
          "submission:stage3:vnext2-materialize-interact-broken-graph",
          "角色仔细检查墙面，发现一个新壁龛并靠近查看内部。",
        ),
        kp,
        counters,
        prepared,
      }), "vnext-2 broken produces/consumes graph outcome");
      expect(outcome).toMatchObject({
        kind: "rejected",
        code: "BUNDLE_DEPENDENCY_INVALID",
        action: "notCommitted",
        narration: "notApplicable",
      });
      expect(kp.counters).toMatchObject({ propose: 1, narrate: 0 });
      expect(counters.rolls).toBe(0);
      expect(await roomSnapshot(authority)).toEqual(before);
    }

    // Sub-case 2: the real vertical. A correctly-linked two-entry vnext-2
    // Bundle commits as one Rules transaction with one Receipt, and the
    // interact step addresses the brand-new object purely through its
    // bundle-local prospective handle.
    const counters = emptyActionCounters();
    const prepared: PreparedCapture = { all: [] };
    const kp = new DeterministicKp(
      () => materializeAndInspectAlcoveBundleV2(),
      prepared,
      undefined,
      false,
    );
    const action = intent(
      "submission:stage3:vnext2-materialize-interact",
      "角色仔细检查墙面，发现一个新壁龛并靠近查看内部。",
    );
    const outcome = record(await runAction({
      authority,
      principal: ALICE,
      action,
      kp,
      counters,
      prepared,
    }), "vnext-2 materialize + interact outcome");
    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      kind: "committed",
      action: "committed",
      narration: "published",
      receipt: { rootActionId: expect.any(String), receiptId: expect.any(String) },
    });
    expect(kp.counters).toMatchObject({ propose: 1 });
    expect(counters.rolls).toBe(0);

    // SPEC 0001 acceptance scenario A: the alcove is in no seed and no
    // Interaction was ever registered for inspecting one. The action still
    // commits, which is exactly what that scenario forbids refusing on.
    // Scenario H rides the same case: a bounded action with no real risk is
    // described as succeeding, and the roll counter above stays at zero.
    const labelsBefore = Object.values(definitions(before.state))
      .map((definition) => String(
        record(record(definition, "definition").content, "content").label,
      ));
    expect(labelsBefore).not.toContain("新出现的壁龛(v2)");

    const committed = await roomSnapshot(authority);
    expect(eventsOf(committed, "SemanticDefinitionMaterialized")).toHaveLength(1);
    expect(eventsOf(committed, "WorldInteractionResolved")).toHaveLength(1);
    const settlementEvents = eventsOf(committed, "AtomicWorldInteractionStepsResolved");
    expect(settlementEvents).toHaveLength(1);
    const mapStep = (raw: unknown) => {
      const step = record(raw, "atomic settlement step");
      return { proposalRef: String(step.proposalRef), status: String(step.status) };
    };
    const settlementSteps = list(
      eventPayload(settlementEvents[0]).steps,
      "atomic settlement steps",
    ).map(mapStep);
    expect(settlementSteps.map((step) => step.status)).toEqual(["applied", "applied"]);

    // ONE Receipt covers the whole atomic transaction.
    const rootActionId = String(record(outcome.receipt, "committed receipt").rootActionId);
    const receiptRecord = record(
      record(committed.state.receipts, "state receipts")[rootActionId],
      "the one Receipt for this RootAction",
    );
    const receiptSettlementSteps = list(
      record(receiptRecord.proposalBundleSettlement, "Receipt bundle settlement").steps,
      "Receipt settlement steps",
    ).map(mapStep);
    expect(receiptSettlementSteps).toEqual(settlementSteps);

    const materializedPayload = eventPayload(eventsOf(committed, "SemanticDefinitionMaterialized")[0]);
    const resolvedPayload = eventPayload(eventsOf(committed, "WorldInteractionResolved")[0]);
    const alcoveRef = String(materializedPayload.definitionRef);
    // The interaction step never saw the raw handle by the time its event
    // was built -- Rules substituted it for the real definitionRef first.
    expect(resolvedPayload.targetRefs).toEqual([alcoveRef]);
    expect(resolvedPayload.directTargetRefs).toEqual([alcoveRef]);
    expect(alcoveRef).not.toContain("prospective:");
    expect(definitions(committed.state)[alcoveRef]).toMatchObject({
      semanticKind: "sceneFeature",
      content: {
        sceneRef: SCENE_REF,
        label: "新出现的壁龛(v2)",
        observableState: "刚刚露出",
      },
    });

    const narration = narrationForViewer(kp, `${ALICE.principal.id}${ALICE_ID}`)[0];
    expect(narration).toBeDefined();
    expect(claimKinds(narration)).toEqual(expect.arrayContaining([
      "definitionRevised",
      "sceneFeature",
      "mechanicalOutcome",
      "actionCommitted",
    ]));
    // Authority-only values (bundleHash/prospectiveRef/contextHash and the
    // raw handle itself) must never reach a player-visible Claim/Narration.
    expect(JSON.stringify(narration)).not.toContain("prospective:");

    // Replay determinism: evicting and reconstructing the Durable Object
    // from genesis+events alone must reproduce byte-identical state and an
    // identical state hash.
    const stateHashBeforeEviction = await roomStateHash(authority);
    await evictDurableObject(authority as never);
    const afterEviction = await roomSnapshot(authority);
    expect(afterEviction).toEqual(committed);
    expect(await roomStateHash(authority)).toBe(stateHashBeforeEviction);
  });

  it("commits a vnext-2 materialized object after the KP applies exactly one internal correction before ever proposing to the Room", async () => {
    const { authority } = await initializeRoom("kp-vnext2-stage3-room-materialize-correction");
    const counters = emptyActionCounters();
    const prepared: PreparedCapture = { all: [] };
    let correctionsApplied = 0;
    const kp = new DeterministicKp((request) => {
      // Mirrors proposal-correction.ts/proposal-provider.ts's real
      // summary-only correction round trip: the first candidate Bundle
      // fails local validation (an empty summary), exactly one repair pass
      // fixes it, and Room's kp.propose() is called only once with the
      // final, already-corrected Bundle -- Room cannot tell a corrected
      // Bundle apart from one that needed no correction. This is the exact
      // round trip the vnext-1/vnext-2 disconnect was blocking: vnext-2 is
      // the only contract `correct_kp_proposal_bundle` was ever built for.
      const context = requiredContext(request);
      const draft = draftAlcoveAloneBundleV2WithBadSummary();
      const draftValidation = validateVNext2ProposalBundle(draft);
      expect(draftValidation.kind, "the uncorrected vnext-2 draft must itself be invalid").toBe("rejected");
      const allowedPaths = repairableVNextProposalBundlePaths(draft);
      expect(allowedPaths.length, "exactly one repairable field").toBe(1);
      const correction = {
        schema: VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA,
        baseBundleHash: canonicalHash(draft),
        contextHash: context.binding.contextHash,
        attempt: 1 as const,
        changes: [{ path: allowedPaths[0]!, value: "根据角色仔细检查墙面，固化出一个新的可互动壁龛。" }],
      };
      const corrected = applyVNextProposalBundleCorrection({
        bundle: draft,
        correction,
        requiredContext: context,
        allowedPaths,
      });
      expect(corrected.kind, JSON.stringify(corrected)).toBe("accepted");
      correctionsApplied += 1;
      return (corrected as { bundle: JsonRecord }).bundle;
    }, prepared, undefined, false);

    const outcome = record(await runAction({
      authority,
      principal: ALICE,
      action: intent(
        "submission:stage3:vnext2-materialize-correction",
        "角色仔细检查墙面，发现一个新壁龛。",
      ),
      kp,
      counters,
      prepared,
    }), "vnext-2 corrected materialize outcome");

    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      kind: "committed",
      action: "committed",
      narration: "published",
    });
    // Room saw exactly one propose() call; the correction happened entirely
    // upstream of it -- proving the correction round trip now reaches a real
    // commit through the Room seam, not only through the offline unit tests.
    expect(kp.counters).toMatchObject({ propose: 1 });
    expect(correctionsApplied).toBe(1);
    expect(counters.rolls).toBe(0);

    const committed = await roomSnapshot(authority);
    expect(eventsOf(committed, "SemanticDefinitionMaterialized")).toHaveLength(1);
  });

  it("rejects an invalid vnext-2 Bundle before Rules, randomness, cost, or persistence", async () => {
    const { authority } = await initializeRoom("kp-vnext2-stage3-room-materialize-invalid-schema");
    const counters = emptyActionCounters();
    const prepared: PreparedCapture = { all: [] };
    const kp = new DeterministicKp(
      () => invalidSemanticKindAlcoveBundleV2(),
      prepared,
      undefined,
      false,
    );
    const before = await roomSnapshot(authority);

    const outcome = record(await runAction({
      authority,
      principal: ALICE,
      action: intent(
        "submission:stage3:vnext2-materialize-invalid-schema",
        "角色仔细检查墙面，发现一个新壁龛并靠近查看内部。",
      ),
      kp,
      counters,
      prepared,
    }), "invalid vnext-2 materializeObject schema outcome");

    expect(outcome).toMatchObject({
      kind: "rejected",
      code: "PROPOSAL_BUNDLE_INVALID",
      action: "notCommitted",
      narration: "notApplicable",
    });
    expect(kp.counters).toMatchObject({ propose: 1, narrate: 0 });
    expect(counters.rolls).toBe(0);
    expect(await roomSnapshot(authority)).toEqual(before);
  });
  it("settles one shared ability check across a vnext-2 Bundle: the roll picks the interaction's branch and decides whether the conditional entry is committed at all", async () => {
    const mapStep = (raw: unknown) => {
      const step = record(raw, "atomic settlement step");
      return { proposalRef: String(step.proposalRef), status: String(step.status) };
    };
    const labels = (state: JsonRecord) => Object.values(definitions(state))
      .map((definition) => String(record(record(definition, "definition").content, "content").label));

    // Sub-case 1: the roll succeeds. All three entries commit, including the
    // materialization bound to the success outcome alone.
    {
      const { authority } = await initializeRoom("kp-vnext2-stage3-room-shared-check-success");
      const counters = emptyActionCounters();
      const prepared: PreparedCapture = { all: [] };
      const kp = new DeterministicKp(() => checkedPryAlcoveBundleV2(), prepared, undefined, false);
      const outcome = record(await runAction({
        authority,
        principal: ALICE,
        action: intent(
          "submission:stage3:vnext2-shared-check-success",
          "角色掰开壁龛内壁卡住的石板。",
        ),
        kp,
        counters,
        prepared,
        rolls: [18],
      }), "vnext-2 shared check success outcome");

      expect(outcome, JSON.stringify(outcome)).toMatchObject({
        kind: "committed",
        action: "committed",
        narration: "published",
      });
      expect(kp.counters).toMatchObject({ propose: 1 });
      // One Bundle, one roll -- not one roll per entry.
      expect(counters.rolls).toBe(1);

      const committed = await roomSnapshot(authority);

      // The server derived the check from the shared ruling, not from any
      // per-entry ruling: str 12 gives the +1 modifier, and the DC is the
      // model's own 13.
      const randomnessEvents = eventsOf(committed, "RandomnessRequested");
      expect(randomnessEvents).toHaveLength(1);
      const randomness = eventPayload(randomnessEvents[0]);
      expect(record(randomness.request, "randomness request")).toMatchObject({
        purpose: "worldInteractionCheck",
      });
      expect(record(record(randomness.request, "randomness request").frozenCheck, "frozen check"))
        .toMatchObject({
          kind: "ability",
          ability: "strength",
          skill: null,
          dc: "13",
          modifier: "1",
          mode: "normal",
        });

      // One roll is requested for the whole Bundle because the Bundle carries
      // one shared ruling: every step declares it, and exactly one of them
      // owns the mechanical check.
      const atomicPlan = record(randomness.resolutionPlan, "atomic steps plan");
      expect(atomicPlan.sharedRuling).toBe("check");
      const planSteps = list(atomicPlan.steps, "atomic plan steps")
        .map((raw) => record(raw, "atomic plan step"));
      expect(planSteps).toHaveLength(3);
      expect(planSteps.map((step) => String(step.ruling))).toEqual(["check", "check", "check"]);
      expect(planSteps.filter((step) => {
        const rulesInput = record(step.rulesInput, "step rules input");
        return rulesInput.kind === "resolveWorldInteraction"
          && record(record(rulesInput.plan, "step plan").ruling, "step ruling").kind === "check";
      })).toHaveLength(1);
      // The conditional entry is ordered after the roll that decides it.
      expect(planSteps.map((step) => String(step.outcomeBinding)))
        .toEqual(["always", "always", "onSuccess"]);
      expect(list(planSteps[2]!.dependsOn, "conditional step dependencies"))
        .toEqual([String(planSteps[1]!.proposalRef)]);

      const settlementEvents = eventsOf(committed, "AtomicWorldInteractionStepsResolved");
      expect(settlementEvents).toHaveLength(1);
      const settlement = eventPayload(settlementEvents[0]);
      expect(settlement.branch).toBe("success");
      expect(list(settlement.steps, "atomic settlement steps").map(mapStep).map((step) => step.status))
        .toEqual(["applied", "applied", "applied"]);

      expect(eventsOf(committed, "SemanticDefinitionMaterialized")).toHaveLength(2);
      expect(eventsOf(committed, "WorldInteractionResolved")).toHaveLength(1);
      expect(labels(committed.state)).toEqual(
        expect.arrayContaining(["新出现的壁龛(v2)", "石板后的暗格(v2)"]),
      );

      // Replay determinism must survive a settled roll, not only a
      // direct-success commit.
      const stateHashBeforeEviction = await roomStateHash(authority);
      await evictDurableObject(authority as never);
      expect(await roomSnapshot(authority)).toEqual(committed);
      expect(await roomStateHash(authority)).toBe(stateHashBeforeEviction);
    }

    // Sub-case 2: the same Bundle, a failing roll. This is the case the
    // direct-success-only lowering could not express at all: the interaction
    // commits its real failure branch, the unconditional materialization
    // still commits, and the success-bound one is skipped rather than
    // half-applied or silently dropped.
    {
      const { authority } = await initializeRoom("kp-vnext2-stage3-room-shared-check-failure");
      const counters = emptyActionCounters();
      const prepared: PreparedCapture = { all: [] };
      const kp = new DeterministicKp(() => checkedPryAlcoveBundleV2(), prepared, undefined, false);
      const outcome = record(await runAction({
        authority,
        principal: ALICE,
        action: intent(
          "submission:stage3:vnext2-shared-check-failure",
          "角色掰开壁龛内壁卡住的石板。",
        ),
        kp,
        counters,
        prepared,
        rolls: [3],
      }), "vnext-2 shared check failure outcome");

      // An honest failure is still a commit: the attempt happened.
      expect(outcome, JSON.stringify(outcome)).toMatchObject({
        kind: "committed",
        action: "committed",
        narration: "published",
      });
      expect(counters.rolls).toBe(1);

      const committed = await roomSnapshot(authority);
      const settlementEvents = eventsOf(committed, "AtomicWorldInteractionStepsResolved");
      expect(settlementEvents).toHaveLength(1);
      const settlement = eventPayload(settlementEvents[0]);
      expect(settlement.branch).toBe("failure");
      expect(list(settlement.steps, "atomic settlement steps").map(mapStep).map((step) => step.status))
        .toEqual(["applied", "applied", "skipped"]);

      expect(eventsOf(committed, "SemanticDefinitionMaterialized")).toHaveLength(1);
      expect(eventsOf(committed, "WorldInteractionResolved")).toHaveLength(1);
      const committedLabels = labels(committed.state);
      expect(committedLabels).toContain("新出现的壁龛(v2)");
      expect(committedLabels).not.toContain("石板后的暗格(v2)");

      // The player was told the interaction failed, and the skipped entry
      // left no trace in anything player-visible.
      const narration = narrationForViewer(kp, `${ALICE.principal.id}${ALICE_ID}`)[0];
      expect(narration).toBeDefined();
      expect(claimKinds(narration)).toEqual(expect.arrayContaining(["mechanicalOutcome", "actionCommitted"]));
      expect(JSON.stringify(narration)).not.toContain("prospective:");
      expect(JSON.stringify(narration)).not.toContain("石板后的暗格");
    }
  });

  it("refuses a vnext-2 shared ruling this transport cannot honestly execute, before Rules, randomness, or persistence", async () => {
    // Sub-case 1: highRisk is pending by construction -- it may only run once
    // Room supplies a trusted confirmation carrying the accepted costs, and
    // there is no seam here to ask for one.
    {
      const { authority } = await initializeRoom("kp-vnext2-stage3-room-shared-high-risk");
      const counters = emptyActionCounters();
      const prepared: PreparedCapture = { all: [] };
      const before = await roomSnapshot(authority);
      const kp = new DeterministicKp(() => highRiskPryAlcoveBundleV2(), prepared, undefined, false);
      const outcome = record(await runAction({
        authority,
        principal: ALICE,
        action: intent(
          "submission:stage3:vnext2-shared-high-risk",
          "角色掰开壁龛内壁卡住的石板。",
        ),
        kp,
        counters,
        prepared,
      }), "vnext-2 high-risk ruling outcome");

      expect(outcome).toMatchObject({
        kind: "rejected",
        code: "BUNDLE_LOWERING_UNSUPPORTED",
        action: "notCommitted",
        narration: "notApplicable",
      });
      expect(counters.rolls).toBe(0);
      expect(await roomSnapshot(authority)).toEqual(before);
    }

    // Sub-case 2: a roll that can fail, with nothing declared to commit on
    // failure. Refused by the Bundle validator before lowering, so no
    // placeholder failure text can ever reach a player.
    {
      const { authority } = await initializeRoom("kp-vnext2-stage3-room-check-without-failure");
      const counters = emptyActionCounters();
      const prepared: PreparedCapture = { all: [] };
      const before = await roomSnapshot(authority);
      const kp = new DeterministicKp(
        () => checkedBundleWithoutFailureBranchV2(),
        prepared,
        undefined,
        false,
      );
      const outcome = record(await runAction({
        authority,
        principal: ALICE,
        action: intent(
          "submission:stage3:vnext2-check-without-failure",
          "角色掰开壁龛内壁卡住的石板。",
        ),
        kp,
        counters,
        prepared,
      }), "vnext-2 check without failure branch outcome");

      expect(outcome).toMatchObject({
        kind: "rejected",
        code: "PROPOSAL_BUNDLE_INVALID",
        action: "notCommitted",
        narration: "notApplicable",
      });
      expect(counters.rolls).toBe(0);
      expect(await roomSnapshot(authority)).toEqual(before);
    }
  });
  it("rolls a lone vnext-2 checked interaction on the single-step path, carrying the shared ruling's own check parameters into Rules", async () => {
    const { authority } = await initializeRoom("kp-vnext2-stage3-room-single-check");
    const counters = emptyActionCounters();
    const prepared: PreparedCapture = { all: [] };
    const kp = new DeterministicKp(() => checkedRopeReadingBundleV2(), prepared, undefined, false);

    const outcome = record(await runAction({
      authority,
      principal: ALICE,
      action: intent(
        "submission:stage3:vnext2-single-check",
        "角色凑近查看麻绳承重点还能撑多久。",
      ),
      kp,
      counters,
      prepared,
      // Advantage asks for two faces and keeps the higher one: 18 + 1 clears
      // DC 15 even though the other face would not have.
      rolls: [3, 18],
    }), "vnext-2 single-step check outcome");

    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      kind: "committed",
      action: "committed",
      narration: "published",
    });
    // The mode reached Rules, not just the ruling kind: a normal-mode check
    // would have consumed exactly one face.
    expect(counters.rolls).toBe(2);

    const committed = await roomSnapshot(authority);
    // A lone in-world act lowers to a one-step atomic Bundle so it can spend
    // its frozen duration; the check itself is still the one shared ruling.
    expect(eventsOf(committed, "AtomicWorldInteractionStepsResolved")).toHaveLength(1);
    expect(eventsOf(committed, "FictionTimeAdvanced")).toHaveLength(1);
    expect(eventsOf(committed, "SemanticDefinitionMaterialized")).toHaveLength(0);
    expect(eventsOf(committed, "WorldInteractionResolved")).toHaveLength(1);

    const randomnessEvents = eventsOf(committed, "RandomnessRequested");
    expect(randomnessEvents).toHaveLength(1);
    const frozenResolutionPlan = record(
      eventPayload(randomnessEvents[0]).resolutionPlan,
      "world-interaction resolution plan",
    );
    // The lone act froze as a one-step atomic Bundle; its check sits on the step's own plan.
    const resolutionPlan = Array.isArray(frozenResolutionPlan.steps)
      ? record(record(record(frozenResolutionPlan.steps[0], "atomic step").rulesInput, "step rules input").plan, "step plan")
      : frozenResolutionPlan;
    const ruling = record(resolutionPlan.ruling, "resolution plan ruling");
    expect(ruling.kind).toBe("check");
    expect(ruling.resolutionKind).toBe("abilityCheck");
    expect(record(ruling.check, "frozen check")).toMatchObject({
      kind: "ability",
      ability: "wisdom",
      skill: null,
      dc: "15",
      modifier: "1",
      mode: "advantage",
    });

    const resolved = eventPayload(eventsOf(committed, "WorldInteractionResolved")[0]);
    expect(resolved.targetRefs).toEqual([ROPE_REF]);

    const narration = narrationForViewer(kp, `${ALICE.principal.id}\u001f${ALICE_ID}`)[0];
    expect(narration).toBeDefined();
    expect(claimKinds(narration)).toEqual(expect.arrayContaining(["mechanicalOutcome", "actionCommitted"]));

    const stateHashBeforeEviction = await roomStateHash(authority);
    await evictDurableObject(authority as never);
    expect(await roomSnapshot(authority)).toEqual(committed);
    expect(await roomStateHash(authority)).toBe(stateHashBeforeEviction);
  });

  it("resolves a vnext-2 attack by the attack rule, not by arithmetic, and spends the ability's ammunition either way", async () => {
    // DC 40 is unreachable by addition: dexterity 16 gives +3, so 20 + 3 is 23.
    // An attack still hits on a natural 20, and a bare ability check would not,
    // so a success here can only mean `checkKind: "attack"` survived the wire,
    // the lowering and the frozen ruling all the way into Rules.
    const { authority } = await initializeRoom("kp-vnext2-stage3-room-attack-crit");
    const counters = emptyActionCounters();
    const prepared: PreparedCapture = { all: [] };
    const kp = new DeterministicKp(
      (request) => attackChainBundleV2(request, 40),
      prepared,
      undefined,
      false,
    );
    const outcome = record(await runAction({
      authority,
      principal: ALICE,
      action: intent("submission:stage3:vnext2-attack-crit", "角色用燧发手枪打向吊灯的铁链。"),
      kp,
      counters,
      prepared,
      rolls: [20],
    }), "vnext-2 attack natural twenty outcome");

    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      kind: "committed",
      action: "committed",
      narration: "published",
    });
    expect(counters.rolls).toBe(1);

    const committed = await roomSnapshot(authority);
    const randomness = eventPayload(eventsOf(committed, "RandomnessRequested")[0]);
    // A lone in-world act now freezes as a one-step atomic Bundle; the check lives on its step's plan.
    const resolutionPlan = record(randomness.resolutionPlan, "resolution plan");
    const frozenPlan = Array.isArray(resolutionPlan.steps)
      ? record(record(record(resolutionPlan.steps[0], "atomic step").rulesInput, "step rules input").plan, "step plan")
      : resolutionPlan;
    const ruling = record(frozenPlan.ruling, "frozen ruling");
    expect(ruling.resolutionKind).toBe("attack");
    expect(record(ruling.check, "frozen check")).toMatchObject({ dc: "40", mode: "normal" });

    const resolved = eventPayload(eventsOf(committed, "WorldInteractionResolved")[0]);
    expect(resolved.outcome ?? resolved.branch).toBeDefined();
    expect(JSON.stringify(resolved)).toContain("outcome:stage3:chain-shot-v2:success");

    // The Ability's ammunition is a frozen cost, so it is spent on the attempt
    // rather than on the result.
    const ammunition = record(
      record(itemEntries(committed.state), "item entries")[AMMO_ENTRY_REF],
      "ammunition entry after the attack",
    );
    expect(ammunition).toBeDefined();

    const stateHashBeforeEviction = await roomStateHash(authority);
    await evictDurableObject(authority as never);
    expect(await roomSnapshot(authority)).toEqual(committed);
    expect(await roomStateHash(authority)).toBe(stateHashBeforeEviction);
  });
});

function authoredRoomBundle(kind: "hazard" | "item", captured=false): JsonRecord {
  const refs: Record<string,string> = {
    "character:probe-actor": ALICE_ID, "character:probe-target": BOB_ID,
    "scene:probe-gallery": SCENE_REF, "definition:probe-valve": CHAIN_REF,
    "definition:probe-steam-zone": IMPACT_ZONE_REF,
  };
  // Explicit synthetic transport update of a preserved historical sample; no model response is rewritten.
  const bundle=captured?parseSubmitKpProposalBundleArguments(encodeVNextStrictToolBundle(capturedItemWire)):kind === "hazard" ? hazardBundle() : itemBundle();
  if (kind === "hazard") {
    // The reused scene is larger than the probe gallery; author a range that
    // actually reaches the intended zone instead of relying on contains alone.
    const proposals = bundle.proposals as JsonRecord[];
    record(record(record(proposals[0].source, "source").content, "ability").target, "target").rangeInches = "1200";
  }
  return JSON.parse(JSON.stringify(bundle),
    (_key, value) => typeof value === "string" ? refs[value] ?? value : value) as JsonRecord;
}

describe("authored hazards and Items through Room persistence", () => {
  for (const choice of ["knockOut", "dealLethalDamage"]) it(`holds an atomic Item until its controller chooses ${choice}, including eviction and foreign answers`, async () => {
    const {authority}=await initializeRoom(`kp-vnext-authored-pending-${choice}`,20,1);
    const before=await roomSnapshot(authority),counters=emptyActionCounters(),prepared:PreparedCapture={all:[]};
    const proposal=authoredRoomBundle("item"),proposals=proposal.proposals as JsonRecord[];
    Object.assign(record(record(proposals[0]!.source,"source").content,"content"),{
      healing:null,target:{kind:"creature",count:"1",reachInches:"900",requiresSight:false},
      attack:{ability:"str",proficiency:true},damage:[{type:"force",formula:"1d4",sharedAcrossTargets:false}],
    });
    record(proposals[4]!.operation,"use").targetRefs=[BOB_ID];
    const kp=new DeterministicKp(()=>proposal,prepared,undefined,false);
    const start=await runAction({authority,principal:ALICE,
      action:intent(`submission:authored-pending:${choice}`,"取用吊灯铁链下的物件，近战击中站在吊物下方的对手。"),
      kp,counters,prepared,rolls:[15,2,2],dieSides:[20,4,4]});
    expect(start,JSON.stringify(start)).toMatchObject({kind:"awaitingInput"});
    const waiting=await roomSnapshot(authority), pending=record(record(start,"start").pending,"pending");
    expect(itemEntries(waiting.state)).toEqual(itemEntries(before.state));
    expect(entities(waiting.state)).toEqual(entities(before.state));
    expect(waiting.events.filter(e=>e.eventType==="AtomicWorldInteractionSuspended")).toHaveLength(1);
    expect(JSON.stringify(start)).not.toMatch(/candidateState|frozenDamageFaces|lethalDamagePayload|ownerFrame/);
    expect(pending.answerOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({answer:{kind:choice}}),
    ]));
    expect(kp.counters.narrate).toBe(0);
    await evictDurableObject(authority as never);
    expect(await roomSnapshot(authority)).toEqual(waiting);
    const answer={kind:"answer" as const,submissionId:`submission:authored-answer:${choice}`,
      pendingInputId:String(pending.pendingInputId),answer:{kind:choice}};
    const foreign=await runAction({authority,principal:BOB,action:answer,kp,counters,prepared});
    expect(foreign).toMatchObject({kind:"rejected"});
    expect(await roomSnapshot(authority)).toEqual(waiting);
    const malformed=await runAction({authority,principal:ALICE,
      action:{...answer,submissionId:`${answer.submissionId}:invalid`,answer:{kind:"useReaction"}},kp,counters,prepared});
    expect(malformed).toMatchObject({kind:"rejected"});
    expect(await roomSnapshot(authority)).toEqual(waiting);
    const done=await runAction({authority,principal:ALICE,action:answer,kp,counters,prepared,
      rolls:choice==="knockOut"?[3]:[],dieSides:[4]});
    expect(done,JSON.stringify(done)).toMatchObject({kind:"committed",narration:"published"});
    const committed=await roomSnapshot(authority);
    expect(committed.events.filter(e=>e.eventType==="ItemUsed")).toHaveLength(1);
    expect(record(entities(committed.state)[BOB_ID],"target").hitPoints).toMatchObject({current:0});
    await runAction({authority,principal:ALICE,action:answer,kp,counters,prepared});
    expect(await roomSnapshot(authority)).toEqual(committed);
    await evictDurableObject(authority as never);
    expect(await roomSnapshot(authority)).toEqual(committed);
  });

  for (const kind of ["hazard", "item"] as const) it(`commits ${kind} with heterogeneous frozen dice, Claims, duplicate protection and eviction replay`, async () => {
    const { authority } = await initializeRoom(`kp-vnext-authored-room-${kind}`,10);
    const counters=emptyActionCounters();
    const prepared:PreparedCapture={all:[]};
    const kp=new DeterministicKp(()=>authoredRoomBundle(kind),prepared,undefined,false);
    const action=intent(`submission:authored-room:${kind}`,kind==="hazard"?"扰动吊灯链条，使区域内危险触发。":"在吊灯链条下找到两份治疗药剂，拾取并使用一份。");
    const outcome=await runAction({authority,principal:ALICE,action,kp,counters,prepared,
      rolls:kind==="hazard"?[2,2,20,1,2,20]:[2,2],dieSides:kind==="hazard"?[6,8,20,20,20,20]:[4,4]});
    expect(outcome,JSON.stringify(outcome)).toMatchObject({kind:"committed",narration:"published"});
    const committed=await roomSnapshot(authority);
    const allEvents=committed.events;
    expect(allEvents.filter(event=>event.eventType==="AtomicWorldInteractionStepsResolved")).toHaveLength(1);
    expect(allEvents.filter(event=>event.eventType==="RandomnessRequested"
      && eventPayload(event).purpose==="worldInteractionCheck")).toHaveLength(1);
    if(kind==="hazard") {
      expect(record(entities(committed.state)[BOB_ID],"target").hitPoints).toMatchObject({current:15});
      expect(allEvents.filter(event=>event.eventType==="EffectApplied")).toHaveLength(1);
    } else {
      expect(record(entities(committed.state)[ALICE_ID],"actor").hitPoints).toMatchObject({current:16});
      expect(Object.values(itemEntries(committed.state))).toEqual(expect.arrayContaining([
        expect.objectContaining({holderRef:ALICE_ID,quantity:1}),
      ]));
      expect(allEvents.filter(event=>event.eventType==="ItemUsed")).toHaveLength(1);
    }
    expect(kp.narrationRequests.length).toBeGreaterThan(0);
    const stateHash=await roomStateHash(authority);
    await evictDurableObject(authority as never);
    expect(await roomSnapshot(authority)).toEqual(committed);
    expect(await roomStateHash(authority)).toBe(stateHash);
    await runAction({authority,principal:ALICE,action,kp,counters,prepared,rolls:[]});
    expect(await roomSnapshot(authority)).toEqual(committed);
  });

  it("rejects an invalid later Item quantity with no partial definitions, dice or Claims",async()=>{
    const {authority}=await initializeRoom("kp-vnext-authored-room-rollback");
    const before=await roomSnapshot(authority),counters=emptyActionCounters(),prepared:PreparedCapture={all:[]};
    const proposal=authoredRoomBundle("item");
    const proposals=proposal.proposals as JsonRecord[];
    (proposals[3]!.operation as JsonRecord).quantity=3;
    const kp=new DeterministicKp(()=>proposal,prepared,undefined,false);
    const outcome=await runAction({authority,principal:ALICE,
      action:intent("submission:authored-room:rollback","在吊灯链条下拾取并使用药剂。"),kp,counters,prepared,rolls:[]});
    expect(outcome).not.toMatchObject({kind:"committed"});
    expect(await roomSnapshot(authority)).toEqual(before);
    expect(kp.counters.narrate).toBe(0);
  });

  it("recovers an Item narration after eviction with identical expression and no second inventory or resource settlement", async () => {
    const { authority } = await initializeRoom("kp-vnext-narration-frozen-item-recovery", 10);
    const counters = emptyActionCounters(), prepared: PreparedCapture = { all: [] };
    const viewerKey = `${ALICE.principal.id}\u001f${ALICE_ID}`;
    const kp = new DeterministicKp(() => authoredRoomBundle("item", true), prepared, viewerKey, false);
    const outcome = await runAction({ authority, principal: ALICE,
      action: intent("submission:narration-frozen-item", "在吊灯链条下找到两份治疗药剂，拾取并使用一份。"),
      kp, counters, prepared, rolls: [2, 3], dieSides: [4, 4] });
    expect(outcome).toMatchObject({ kind: "committed", narration: "retryableFailure" });
    const committed = await roomSnapshot(authority);
    const previous = narrationForViewer(kp, viewerKey)[0];
    const proposalCount = kp.counters.propose, rollCount = counters.rolls;
    await evictDurableObject(authority as never);
    const observed = record(await authority.observe(ALICE), "observation after eviction");
    const recovery = record(observed.narrationRecovery, "narration recovery");
    const result = await handleViewerNarrationRecovery({ principal: ALICE,
      authority: instrumentAuthority(authority, counters, prepared), kp }, String(recovery.capability));
    expect(result).toMatchObject({ kind: "committed", narration: "published" });
    const retried = narrationForViewer(kp, viewerKey)[1];
    expect(retried.narrationContext).toEqual(previous.narrationContext);
    expect(retried.renderableClaims).toEqual(previous.renderableClaims);
    expect(kp.counters.propose).toBe(proposalCount); expect(counters.rolls).toBe(rollCount);
    expect(await roomSnapshot(authority)).toEqual(committed);
  });

  it("replays a current-wire fixture derived from the historical DeepSeek Item proposal through Room",async()=>{
    const {authority}=await initializeRoom("kp-vnext-authored-room-captured-provider",10);
    const counters=emptyActionCounters(),prepared:PreparedCapture={all:[]};
    const kp=new DeterministicKp(()=>authoredRoomBundle("item",true),prepared,undefined,false);
    const outcome=await runAction({authority,principal:ALICE,
      action:intent("submission:authored-room:captured","在吊灯链条下找到两份治疗药剂，拾取并使用一份。"),
      kp,counters,prepared,rolls:[2,3],dieSides:[4,4]});
    expect(outcome).toMatchObject({kind:"committed",narration:"published"});
    const beforeEviction=await roomSnapshot(authority);
    expect(record(entities(beforeEviction.state)[ALICE_ID],"actor").hitPoints).toMatchObject({current:17});
    expect(beforeEviction.events.filter(event=>event.eventType==="ItemUsed")).toHaveLength(1);
    await evictDurableObject(authority as never);
    expect(await roomSnapshot(authority)).toEqual(beforeEviction);
  });
});
