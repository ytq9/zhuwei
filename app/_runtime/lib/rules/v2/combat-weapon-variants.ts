import { canonicalSha256 } from "../profiles/canonical";
import { canonicalCombatPoint } from "../profiles/combat-geometry";
import type { TacticalPosition } from "../tactical-projection";
import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { planInventoryTransition, type InventoryOperationAppliedPayload } from "./inventory-operations";
import { isRecord, isNonEmptyString, hasExactKeys } from "./validation";

/** SPEC 0012 §§6.2–6.3: one frozen weapon use; its source is an actual ItemEntry. */
export type CombatWeaponUse = {
  entryId: string;
  slot: "main" | "off" | null;
  mode: "melee" | "ranged" | "thrown" | "improvisedMelee" | "improvisedThrown";
  light: boolean;
  bonusAttack: boolean;
};

export function isCombatWeaponUse(value: unknown): value is CombatWeaponUse {
  return isRecord(value) && hasExactKeys(value, ["entryId", "slot", "mode", "light", "bonusAttack"])
    && isNonEmptyString(value.entryId) && value.entryId.startsWith("item-entry:")
    && ["main", "off", null].includes(value.slot as "main" | "off" | null)
    && ["melee", "ranged", "thrown", "improvisedMelee", "improvisedThrown"].includes(String(value.mode))
    && typeof value.light === "boolean" && typeof value.bonusAttack === "boolean"
    && (!value.bonusAttack || (value.light && ["melee", "thrown"].includes(String(value.mode))));
}

export function thrownWeaponUse(definition: JsonRecord): CombatWeaponUse | undefined {
  const use = definition.weaponUse;
  return isCombatWeaponUse(use) && (use.mode === "thrown" || use.mode === "improvisedThrown") ? use : undefined;
}

/** Run before spending grants or rolling. Missing metadata is an earlier
 * frozen ability, never a license to choose an arbitrary inventory entry. */
export function weaponUseIssue(state: AuthoritativeWorldState, sourceId: string, definition: JsonRecord): string | undefined {
  if (definition.weaponUse === undefined) return undefined;
  const use = definition.weaponUse;
  if (!isCombatWeaponUse(use)) return "weapon:invalid-use";
  const actor = state.entities[sourceId];
  const entry = state.campaignRuntime.itemSystem.entries[use.entryId];
  const item = entry === undefined ? undefined : state.campaignRuntime.itemSystem.definitions[entry.definitionRef];
  if (actor === undefined || entry?.disposition !== "held" || entry.holderRef !== sourceId
    || entry.condition !== "usable" || entry.quantity < 1 || entry.assemblyRef !== undefined
    || item?.revision !== entry.definitionRevision) return "weapon:entry-unavailable";
  if (use.slot !== null && (entry.equippedSlot !== use.slot || actor.loadout?.equipped[use.slot] !== use.entryId))
    return "weapon:not-equipped";
  const weapon = item.content.equipment?.weapon;
  if ((use.light && (weapon?.light !== true || weapon.reachInches === null))
    || (["melee", "ranged", "thrown"].includes(use.mode) && weapon == null)
    || (use.mode === "thrown" && weapon?.thrown == null)) return "weapon:source-properties-changed";
  if (use.slot === null && (actor.loadout?.equipped.main !== undefined && actor.loadout?.equipped.off !== undefined))
    return "weapon:no-free-hand";
  if (use.slot === null) {
    const main = actor.loadout?.equipped.main;
    const mainEntry = main === undefined ? undefined : state.campaignRuntime.itemSystem.entries[main];
    if (mainEntry !== undefined && state.campaignRuntime.itemSystem.definitions[mainEntry.definitionRef]?.content.equipment?.twoHanded)
      return "weapon:no-free-hand";
  }
  if (use.bonusAttack) {
    const turn = state.combatRuntime.entities[sourceId]?.turn;
    if (!isRecord(turn) || !Array.isArray(turn.twoWeaponBonusEntryIds) || !turn.twoWeaponBonusEntryIds.includes(use.entryId))
      return "weapon:two-weapon-attack-not-earned";
  }
  return undefined;
}

/** Called only at actual Attack-action commitment. The comparison excludes
 * reactions, Multiattack quota strikes and Haste-only attacks. A miss still
 * qualifies: the character attacked, whether or not it hit. */
export function recordWeaponAttack(state: AuthoritativeWorldState, sourceId: string, definition: JsonRecord, sourcePatch: JsonRecord): void {
  const use = definition.weaponUse;
  const before = state.combatRuntime.entities[sourceId]?.turn;
  const after = sourcePatch.turn;
  if (!isCombatWeaponUse(use) || use.bonusAttack || !use.light || !["melee", "thrown"].includes(use.mode)
    || use.slot === null || !isRecord(before) || !isRecord(after)
    || !isRecord(definition.activation) || definition.activation.kind !== "attack") return;
  const ordinaryAttack = Number(after.action) < Number(before.action)
    || (Number(after.attacksRemaining) < Number(before.attacksRemaining) && Number(before.attacksRemaining) > 0);
  if (!ordinaryAttack || Number(after.reaction) < Number(before.reaction)
    || Number(after.hasteAction) < Number(before.hasteAction)) return;
  const actor = state.entities[sourceId];
  const otherSlot = use.slot === "main" ? "off" : "main";
  const otherId = actor?.loadout?.equipped[otherSlot];
  const other = otherId === undefined ? undefined : state.campaignRuntime.itemSystem.entries[otherId];
  const item = other === undefined ? undefined : state.campaignRuntime.itemSystem.definitions[other.definitionRef];
  const weapon = item?.content.equipment?.weapon;
  if (otherId === undefined || otherId === use.entryId || other?.disposition !== "held" || other.holderRef !== sourceId
    || other.condition !== "usable" || other.equippedSlot !== otherSlot || item?.revision !== other.definitionRevision
    || weapon?.light !== true || weapon.reachInches === null || item?.content.equipment?.twoHanded) return;
  after.twoWeaponBonusEntryIds = [...new Set([...(Array.isArray(after.twoWeaponBonusEntryIds)
    ? after.twoWeaponBonusEntryIds.filter(isNonEmptyString) : []), otherId])].sort();
}

/** SPEC 0001 §§8、16: throwing places the real object at the frozen aim point,
 * on a hit or a miss. The normal inventory fold validates it and refreshes
 * the holder's loadout/abilities. Call only once the attack actually commits;
 * a refused preflight must never publish this draft. */
export function thrownWeaponReleaseDraft(state: AuthoritativeWorldState, sourceId: string, definition: JsonRecord,
  rootActionId: string, position: TacticalPosition): {
    eventType: "InventoryOperationApplied"; payload: InventoryOperationAppliedPayload;
    visibilityPolicyId: string; secrecy: "internal";
  } | undefined {
  const use = thrownWeaponUse(definition), point = canonicalCombatPoint(position);
  if (use === undefined || point === undefined || weaponUseIssue(state, sourceId, definition) !== undefined) return undefined;
  const operation = { kind: "release" as const, entryRef: use.entryId, quantity: 1,
    sceneRef: state.entities[sourceId].sceneId, releaseKind: "drop" as const, position: point };
  const contextHash = canonicalSha256({ kind: "thrown-weapon", rootActionId, sourceId, abilityRef: definition.definitionId, operation });
  const transition = planInventoryTransition(state, sourceId, operation, rootActionId, contextHash, { kind: "actor" });
  if ("error" in transition) return undefined;
  return { eventType: "InventoryOperationApplied", payload: { actorCharacterId: sourceId, operation, contextHash,
    entryHashBefore: canonicalSha256(state.campaignRuntime.itemSystem.entries[use.entryId]),
    itemSystemHashAfter: canonicalSha256(transition.itemSystem), targetEntryId: transition.targetEntryId,
    authority: { kind: "actor" }, summary: "投出的物品落在目标位置。" },
    visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" };
}

/** SRD 5.1 Command ("Drop"): the creature lets go of what it holds in a
 * hand, at its feet -- the first held entry of the main hand, then the off
 * hand, one release at a time. Undefined when its hands are empty. */
export function heldItemDropDraft(state: AuthoritativeWorldState, holderId: string, rootActionId: string): {
    eventType: "InventoryOperationApplied"; payload: InventoryOperationAppliedPayload;
    visibilityPolicyId: string; secrecy: "internal";
  } | undefined {
  const holder = state.entities[holderId], body = state.combatRuntime.entities[holderId];
  const point = canonicalCombatPoint(body?.position);
  if (holder === undefined || point === undefined) return undefined;
  for (const slot of ["main", "off"] as const) {
    const entryId = holder.loadout?.equipped[slot];
    const entry = entryId === undefined ? undefined : state.campaignRuntime.itemSystem.entries[entryId];
    if (entry === undefined || entry.disposition !== "held" || entry.holderRef !== holderId) continue;
    const operation = { kind: "release" as const, entryRef: entry.entryId, quantity: entry.quantity,
      sceneRef: holder.sceneId, releaseKind: "drop" as const, position: point };
    const contextHash = canonicalSha256({ kind: "commanded-drop", rootActionId, holderId, operation });
    const transition = planInventoryTransition(state, holderId, operation, rootActionId, contextHash, { kind: "actor" });
    if ("error" in transition) continue;
    return { eventType: "InventoryOperationApplied", payload: { actorCharacterId: holderId, operation, contextHash,
      entryHashBefore: canonicalSha256(entry), itemSystemHashAfter: canonicalSha256(transition.itemSystem),
      targetEntryId: transition.targetEntryId, authority: { kind: "actor" }, summary: "听从命令，放下了手中的物品。" },
      visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" };
  }
  return undefined;
}
