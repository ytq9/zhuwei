import type {
  SceneEnvironmentItemDef as SceneItemRuling,
  ScenePhysicalChallengeDef as ScenePhysicalChallenge,
} from "../module/schema";

export type WorldEffect =
  | {
      type: "consume_resource";
      resource: "torch" | "ration";
      quantity: number;
    }
  | {
      type: "grant_item";
      sceneId: string;
      sourceId: string;
      itemId: string;
      itemName: string;
      quantity: number;
    };

export type ActionProposal = {
  kind: "none" | "allow" | "check" | "refuse";
  intent: "find_item" | "physical" | "other";
  sourceId?: string;
  ability?: string;
  skill?: string;
  dc?: number;
  reason?: string;
};

export type ActionRuling =
  | { kind: "none" }
  | { kind: "allow"; speech: string; effect?: WorldEffect }
  | {
      kind: "check";
      speech: string;
      check: { ability: string; skill?: string; dc: number; reason: string };
      effect?: WorldEffect;
    }
  | { kind: "refuse"; speech: string; alternatives: string[] };

type RulingInput = {
  text: string;
  actor: {
    userId: string;
    name: string;
    inventory: {
      resources: { torch: number; ration: number };
      itemIds: string[];
    };
  };
  scene: {
    id: string;
    name: string;
    environmentItems?: SceneItemRuling[];
    physicalChallenges?: ScenePhysicalChallenge[];
  };
  claimedSourceIds: string[];
  reservedSourceIds: string[];
  catalogItems: { itemId: string; name: string; aliases?: string[] }[];
  proposal: ActionProposal | null;
};

const ACQUIRE = /找|寻找|搜|翻|捡|拾|拿|取|有没有|哪[里儿].*有|给我|要(?:一|个|根|把|件)/;
const FORCE = /搬|抬|推|挪|拖|移动|扯|撕|拽|拔|掰|砸|撞|踹|举/;
const USE = /点燃|点着|燃起|使用|拿出|掏出|挥动|撬|切|砍/;
const INVENTORY_USE = /拿出|掏出|取出|从(?:背包|行囊|包里|身上)/;

function compact(text: string) {
  return text.replace(/\s+/g, "");
}

function hasAny(text: string, words: string[]) {
  return words.some((word) => word && text.includes(compact(word)));
}

function findSceneItem(input: RulingInput, text: string) {
  const byText = (input.scene.environmentItems ?? []).find((item) =>
    hasAny(text, [item.name, item.itemId, ...(item.aliases ?? [])]),
  );
  if (byText) return byText;
  const sourceId = input.proposal?.intent === "find_item" ? input.proposal.sourceId : null;
  return sourceId
    ? input.scene.environmentItems?.find((item) => item.id === sourceId)
    : undefined;
}

function itemEffect(sceneId: string, item: SceneItemRuling): WorldEffect {
  return {
    type: "grant_item",
    sceneId,
    sourceId: item.id,
    itemId: item.itemId,
    itemName: item.name,
    quantity: Math.max(1, Math.min(9, item.quantity ?? 1)),
  };
}

function resolveSceneItem(input: RulingInput, item: SceneItemRuling): ActionRuling {
  if (input.claimedSourceIds.includes(item.id)) {
    return {
      kind: "refuse",
      speech: `${item.name}已经被人取走了，这里没有第二份。`,
      alternatives: ["换一种照明或工具", "去别处寻找"],
    };
  }
  if (input.reservedSourceIds.includes(item.id)) {
    return {
      kind: "refuse",
      speech: `已经有人正在翻找${item.name}，先等这次查找有结果。`,
      alternatives: ["协助正在查找的人", "换一种办法"],
    };
  }
  const effect = itemEffect(input.scene.id, item);
  if (item.availability === "obvious") {
    return {
      kind: "allow",
      speech: `${item.name}就在眼前。${input.actor.name}把它取了下来。`,
      effect,
    };
  }
  const check = item.check ?? { ability: "int", skill: "investigation", dc: 10 };
  return {
    kind: "check",
    speech: `这里有可能留着${item.name}，但需要仔细翻找。`,
    check: {
      ability: check.ability,
      skill: check.skill,
      dc: Math.max(8, Math.min(15, check.dc)),
      reason: `寻找可能存在的${item.name}。`,
    },
    effect,
  };
}

function resolvePhysicalChallenge(
  input: RulingInput,
  text: string,
): ActionRuling | null {
  const challenge = (input.scene.physicalChallenges ?? []).find((candidate) => {
    const sourceMatches = input.proposal?.sourceId === candidate.id;
    const targetMatches = hasAny(text, [candidate.name, ...candidate.aliases]);
    const verbMatches = hasAny(text, candidate.verbs);
    return verbMatches && (sourceMatches || targetMatches);
  });
  if (!challenge) return null;
  if (challenge.ruling === "automatic") {
    return { kind: "allow", speech: `${input.actor.name}${challenge.name}。` };
  }
  if (challenge.ruling === "impossible") {
    return {
      kind: "refuse",
      speech: `${challenge.name}仅靠现在的做法无法完成。`,
      alternatives: challenge.alternatives ?? ["寻找工具", "请同伴协助"],
    };
  }
  const check = challenge.check ?? { ability: "str", skill: "athletics", dc: 12 };
  return {
    kind: "check",
    speech: `${challenge.name}并不轻松，需要真正用力。`,
    check: {
      ability: check.ability,
      skill: check.skill,
      dc: Math.max(8, Math.min(15, check.dc)),
      reason: `尝试${challenge.name}。`,
    },
  };
}

function genericForceRuling(input: RulingInput, text: string): ActionRuling | null {
  if (!FORCE.test(text)) return null;
  if (/厚布|帆布|幕布|布帘|地毯|布/.test(text) && /扯|撕|拽|拉/.test(text)) {
    return {
      kind: "check",
      speech: "这需要靠力气扯开，而不是调查它。",
      check: {
        ability: "str",
        skill: "athletics",
        dc: 10,
        reason: "尝试用力扯开材料。",
      },
    };
  }
  if (/石头|石块|巨石|重物|石门|沉重/.test(text) || input.proposal?.intent === "physical") {
    const proposed = input.proposal?.dc ?? 12;
    return {
      kind: "check",
      speech: "目标有明显重量，需要用正确的发力方式移动。",
      check: {
        ability: "str",
        skill: "athletics",
        dc: Math.max(10, Math.min(15, proposed)),
        reason: "尝试移动沉重的目标。",
      },
    };
  }
  return null;
}

function missingOwnedItem(input: RulingInput, text: string): ActionRuling | null {
  if (!USE.test(text) || ACQUIRE.test(text)) return null;
  const mentioned = input.catalogItems.find((item) =>
    hasAny(text, [item.name, ...(item.aliases ?? [])]),
  );
  if (!mentioned || input.actor.inventory.itemIds.includes(mentioned.itemId)) return null;
  return {
    kind: "refuse",
    speech: `你的随身装备里没有${mentioned.name}，不能直接使用。`,
    alternatives: ["先在当前环境寻找", "换用背包里已有的工具"],
  };
}

export function resolveActionRuling(input: RulingInput): ActionRuling {
  const text = compact(input.text);
  const acquiringFromScene = ACQUIRE.test(text) && !INVENTORY_USE.test(text);

  const sceneItem = acquiringFromScene ? findSceneItem(input, text) : undefined;
  if (sceneItem) {
    return resolveSceneItem(input, sceneItem);
  }

  if (
    /火把/.test(text) &&
    /点燃|点着|燃起/.test(text) &&
    !acquiringFromScene
  ) {
    if (input.actor.inventory.resources.torch <= 0) {
      return {
        kind: "refuse",
        speech: "你的库存里没有火把，不能直接点燃一支不存在的火把。",
        alternatives: ["寻找当前环境里的照明物", "使用已有的灯或光亮法术"],
      };
    }
    return {
      kind: "allow",
      speech: `你点燃一支火把。剩余 ${input.actor.inventory.resources.torch - 1} 支。`,
      effect: { type: "consume_resource", resource: "torch", quantity: 1 },
    };
  }

  const physical = resolvePhysicalChallenge(input, text) ?? genericForceRuling(input, text);
  if (physical) return physical;

  const missing = missingOwnedItem(input, text);
  if (missing) return missing;

  const requestedKnownItem = input.catalogItems.find((item) =>
    hasAny(text, [item.name, ...(item.aliases ?? [])]),
  );
  if (
    ACQUIRE.test(text) &&
    (requestedKnownItem || /火把|口粮/.test(text))
  ) {
    return {
      kind: "refuse",
      speech: "当前场景没有这个物品的可靠来源，不能凭空补进环境或背包。",
      alternatives: ["寻找场景中明确存在的普通物品", "向 NPC 询问其他来源"],
    };
  }

  if (input.proposal?.intent === "find_item" && acquiringFromScene) {
    return {
      kind: "refuse",
      speech: "当前场景没有这个物品的可靠来源，不能凭空补进环境或背包。",
      alternatives: ["寻找场景中明确存在的普通物品", "向 NPC 询问其他来源"],
    };
  }

  if (input.proposal?.kind === "refuse") {
    return {
      kind: "refuse",
      speech: input.proposal.reason?.trim() || "这个做法在当前条件下不成立。",
      alternatives: ["换一种方法", "先创造必要条件"],
    };
  }

  return { kind: "none" };
}

export function normalizeActionCheck<
  T extends {
    kind?: string;
    ability: string;
    skill?: string;
    clueId?: string;
    worldEffect?: unknown;
  },
>(textInput: string, roll: T): T {
  if ((roll.kind && roll.kind !== "check") || roll.clueId || roll.worldEffect) return roll;
  const text = compact(textInput);
  const withCheck = (ability: string, skill: string): T => ({
    ...roll,
    ability,
    skill,
  });
  if (/搬|抬|推|挪|拖|扯|撕|拽|拔|掰|砸|撞|踹|举|攀|爬|游|跳/.test(text)) {
    return withCheck("str", "athletics");
  }
  if (/平衡|翻滚|翻越|钻过|保持脚步/.test(text)) {
    return withCheck("dex", "acrobatics");
  }
  if (/偷|藏|顺手牵羊|细小机关|手上动作/.test(text)) {
    return withCheck("dex", "sleight");
  }
  if (/追踪|辨认足迹|野外.*找|寻找.*材料/.test(text)) {
    return withCheck("wis", "survival");
  }
  if (/环顾|倾听|听听|看见|观察动静|留意|闻/.test(text) && !/翻|搜|推断|研究/.test(text)) {
    return withCheck("wis", "perception");
  }
  if (/翻找|搜查|搜索|检查结构|推断|研究|找.*位置/.test(text)) {
    return withCheck("int", "investigation");
  }
  return roll;
}

export function readWorldItemClaims(flags: Record<string, unknown>) {
  const raw = flags.worldItemClaims;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {} as Record<string, string>;
  }
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter(([, userId]) => typeof userId === "string")
      .map(([sourceId, userId]) => [sourceId, String(userId)]),
  );
}
