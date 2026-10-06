import { spellById } from "../../dnd/catalog";
import { registeredAbilityDefinition } from "../profiles/ability-compiler";
import { BUILTIN_ACTION_NAMES } from "./basic-actions";
import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { isNonEmptyString, isRecord } from "./validation";

/** SPEC 0016 §8.2, SPEC 0012 §9.1 (ADR 0113): the words a combat ability is
 * called by. A compiled weapon attack carries no name of its own, only the
 * item entry it is made with; the name comes from that item. */

/** SRD 5.1 (2014) Unarmed Strike, which every creature can make. */
export const UNARMED_STRIKE_KEY = "unarmed-strike";
/** The former fallback strike (1d4 + Strength), kept by rooms whose catalog
 * froze it before ADR 0113; told by the same name. */
export const LEGACY_IMPROVISED_STRIKE_KEY = "improvised-strike";
const UNARMED_STRIKE_NAME = "徒手攻击";
const UNARMED_STRIKE_KEYS: ReadonlySet<unknown> = new Set([UNARMED_STRIKE_KEY, LEGACY_IMPROVISED_STRIKE_KEY]);
/** What a Viewer calls a weapon it sees used but cannot identify. */
const UNIDENTIFIED_WEAPON_NAME = "武器";

/** The definition behind a stored combat definition, registered or bare. */
export function plainCombatDefinition(stored: unknown): JsonRecord | undefined {
  if (!isRecord(stored)) return undefined;
  return isRecord(stored.mechanicGraph) ? registeredAbilityDefinition(stored) : stored;
}

/** The item entry a weapon attack is made with, and whether it is the
 * off-hand attack (`weapon:<entry>` or `weapon:<entry>:off`). */
export function weaponAttackEntry(definition: JsonRecord | undefined): { entryRef: string; offHand: boolean } | undefined {
  if (isRecord(definition?.weaponUse) && isNonEmptyString(definition.weaponUse.entryId)) return {
    entryRef: definition.weaponUse.entryId, offHand: definition.weaponUse.slot === "off",
  };
  const key = definition?.mechanicalKey;
  const match = typeof key === "string" ? /^weapon:(.+?)(:off)?$/u.exec(key) : null;
  return match === null ? undefined : { entryRef: match[1]!, offHand: match[2] !== undefined };
}

/** A stat-block attack's own label: the KP writes it as the mechanical key
 * when it fixes an NPC's first combat statistics (ADR 0102); a lowercase key
 * names a built-in mechanic instead. */
function statBlockLabel(definition: JsonRecord | undefined): string | undefined {
  const key = definition?.mechanicalKey;
  return isNonEmptyString(key) && key.length <= 200 && key.trim() === key && !/^[a-z0-9:._-]+$/u.test(key) ? key : undefined;
}

/** What the creature that holds an ability calls it in its own turn: a
 * built-in action, a spell, the weapon it wields, an unarmed strike or the
 * label of its stat-block attack. */
export function ownCombatAbilityName(state: AuthoritativeWorldState, abilityRef: string): string | undefined {
  if (Object.hasOwn(BUILTIN_ACTION_NAMES, abilityRef)) return BUILTIN_ACTION_NAMES[abilityRef];
  const definition = plainCombatDefinition(state.combatRuntime.definitions[abilityRef]);
  if (definition === undefined) return undefined;
  if (definition.mechanicalKey === "multiattack") return "多重攻击";
  if (isNonEmptyString(definition.sourceSpellId)) return spellById(definition.sourceSpellId)?.name;
  const weapon = weaponAttackEntry(definition);
  if (weapon !== undefined) {
    const entry = state.campaignRuntime.itemSystem.entries[weapon.entryRef];
    const label = entry === undefined ? undefined : state.campaignRuntime.itemSystem.definitions[entry.definitionRef]?.content.label;
    return `${label ?? UNIDENTIFIED_WEAPON_NAME}${weapon.offHand ? "（副手）" : ""}${weaponVariantLabel(definition)}`;
  }
  if (UNARMED_STRIKE_KEYS.has(definition.mechanicalKey)) return UNARMED_STRIKE_NAME;
  return statBlockLabel(definition);
}

/** The name a Viewer reads for a weapon attack or an unarmed strike it sees
 * made. A weapon is named by what the Viewer itself can tell of the item
 * (`weaponName`), never from the attacker's ability catalog; one it cannot
 * identify is called a weapon. Other abilities keep the names the Viewer's
 * own projection grants. */
export function viewerCombatAbilityName(
  definition: JsonRecord | undefined,
  weaponName: (entryRef: string) => string | undefined,
): string | undefined {
  const weapon = weaponAttackEntry(definition);
  if (weapon !== undefined) return weaponName(weapon.entryRef) ?? UNIDENTIFIED_WEAPON_NAME;
  return UNARMED_STRIKE_KEYS.has(definition?.mechanicalKey) ? UNARMED_STRIKE_NAME : undefined;
}

export function weaponVariantLabel(definition: JsonRecord): string {
  const use = definition.weaponUse;
  if (!isRecord(use)) return "";
  return `${use.mode === "thrown" || use.mode === "improvisedThrown" ? " · 投掷" : ""}${String(use.mode).startsWith("improvised") ? " · 临时武器" : ""}${use.bonusAttack ? " · 双武器附赠攻击" : ""}`;
}
