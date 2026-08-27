import type { Command, WorldState } from "./model";
import { formulaAtSlot, spellDefinition } from "./spell-catalog";
import type { SpellCastRolls } from "./spell-model";
import { rollDie } from "./ruleset";

type CastSpellCommand = Extract<Command, { kind: "castSpell" }>;

function rollFaces(count: number, sides: number) {
  return Array.from({ length: count }, () => rollDie(sides));
}

function normalizedTargets(command: CastSpellCommand) {
  const definition = spellDefinition(command.spellId);
  if (!definition) return command.targetIds ?? [];
  let ids = command.targetIds?.length
    ? [...command.targetIds]
    : definition.targets.filter === "self" ||
        definition.targets.filter === "willing-creature" ||
        definition.targets.filter === "creature-except-undead-construct"
      ? [command.actorId]
      : [];
  const count = definition.resolution.attacks ?? 1;
  if (definition.resolution.mode === "attack" && count > 1 && ids.length === 1) {
    ids = Array.from({ length: count }, () => ids[0]);
  }
  if (definition.resolution.special === "magic-missile" && ids.length === 1) {
    const slotLevel = command.slotLevel ?? definition.level;
    ids = Array.from({ length: 3 + Math.max(0, slotLevel - 1) }, () => ids[0]);
  }
  return ids;
}

/**
 * 只在 Worker/DO 请求处理期间调用：把玩家的施法意图补成 step 可重放的权威骰面。
 * step 本身仍然纯确定性，并会逐颗验证这些骰面。
 */
export function completeSpellCastRolls(
  state: WorldState,
  command: CastSpellCommand,
): CastSpellCommand {
  const definition = spellDefinition(command.spellId);
  if (!definition || command.rolls) return command;
  const targetIds = normalizedTargets(command);
  const slotLevel = command.slotLevel ?? definition.level;
  const rolls: SpellCastRolls = {};

  if (definition.resolution.mode === "attack") {
    const attacks =
      (definition.resolution.attacks ?? 1) +
      Math.max(0, slotLevel - definition.level) *
        (definition.resolution.attacksPerSlotAbove ?? 0);
    rolls.attack = Array.from({ length: attacks }, () => ({
      mode: "normal" as const,
      faces: rollFaces(1, 20),
    }));
  }

  if (definition.resolution.mode === "save" && definition.resolution.save) {
    rolls.saves = Object.fromEntries(
      [...new Set(targetIds)].map((targetId) => {
        const target = state.entities[targetId];
        const advantage =
          (definition.resolution.save?.advantageInCombat &&
            state.combats[target?.sceneId ?? ""]?.status === "active") ||
          target?.capabilities.includes(
            `save-advantage:${definition.resolution.effects?.[0]?.tag ?? command.spellId}`,
          );
        const mode = advantage ? "advantage" as const : "normal" as const;
        return [targetId, { mode, faces: rollFaces(mode === "normal" ? 1 : 2, 20) }];
      }),
    );
  }

  const formula = definition.resolution.damage?.formula ?? definition.resolution.healing;
  if (formula) {
    const atSlot = formulaAtSlot(formula, definition.level, slotLevel);
    const multiplier = definition.resolution.mode === "attack"
      ? ((definition.resolution.attacks ?? 1) +
          Math.max(0, slotLevel - definition.level) *
            (definition.resolution.attacksPerSlotAbove ?? 0)) * 2
      : definition.resolution.special === "magic-missile"
        ? targetIds.length
        : 1;
    rolls.effect = rollFaces(atSlot.count * multiplier, atSlot.sides);
  }

  return { ...command, targetIds, rolls };
}
