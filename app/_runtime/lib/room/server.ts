import { env } from "cloudflare:workers";

import { ensureGear } from "../dnd/compute";
import { spellById } from "../dnd/catalog";
import { itemById } from "../dnd/gear";
import { weaponAttack } from "../kp/combat";
import type { CharacterSheet } from "../dnd/types";
import type { Command } from "../rules/model";
import { RULESET_VERSION } from "../rules/ruleset";
import type { CommitTurnResult, TurnTicket } from "./types";

function roomStub(roomId: string) {
  return env.ROOMS.getByName(roomId);
}

function resourceCounts(sheet: CharacterSheet) {
  const values: Record<string, number> = {};
  for (const [key, value] of Object.entries(sheet.resources ?? {})) {
    if (typeof value === "number") values[key] = value;
    else if (value && typeof value === "object") {
      const record = value as { max?: unknown; used?: unknown };
      if (typeof record.max === "number") {
        values[key] = Math.max(0, record.max - (typeof record.used === "number" ? record.used : 0));
      }
    }
  }
  if (sheet.classId === "wizard") {
    values.arcaneRecovery = sheet.resources?.arcaneRecovery ? 0 : 1;
  }
  values.inspiration = sheet.inspiration ? 1 : 0;
  return values;
}

function resourceRules(sheet: CharacterSheet) {
  const values: Record<
    string,
    { max: number; recovery: "none" | "short" | "long" | "shortOrLong"; die?: number }
  > = {};
  const short = new Set(["channel", "surge", "secondWind", "superiority", "breath"]);
  const long = new Set(["slot1", "slot2", "hitDice", "rage", "warPriest", "relentless"]);
  for (const [key, value] of Object.entries(sheet.resources ?? {})) {
    if (value && typeof value === "object" && "max" in value) {
      const maximum = Number((value as { max?: unknown }).max);
      if (Number.isFinite(maximum) && maximum >= 0) {
        values[key] = {
          max: maximum,
          recovery: short.has(key) ? "shortOrLong" : long.has(key) ? "long" : "none",
          die:
            key === "hitDice" && "die" in value
              ? Number((value as { die?: unknown }).die)
              : undefined,
        };
      }
    } else if (typeof value === "number") {
      values[key] = { max: value, recovery: "none" };
    }
  }
  if (sheet.classId === "wizard") {
    values.arcaneRecovery = { max: 1, recovery: "long" };
  }
  values.inspiration = { max: 1, recovery: "none" };
  return values;
}

function primaryAttack(sheet: CharacterSheet) {
  const attack = weaponAttack(sheet);
  const match = /^(\d+)d(\d+)([+-]\d+)?$/i.exec(attack.damage.replace(/\s/g, ""));
  const item = itemById(sheet.equipped?.main);
  const range = /（?(\d+)\/(\d+)）?/.exec(item?.text ?? "");
  return {
    id: "primary-weapon",
    name: attack.weapon,
    attackBonus: attack.bonus,
    kind: attack.ranged ? ("ranged" as const) : ("melee" as const),
    ammoResource:
      item?.id === "light-crossbow"
        ? ("bolt" as const)
        : item?.id === "shortbow" || item?.id === "longbow"
          ? ("arrow" as const)
          : undefined,
    reachFeet: attack.ranged ? undefined : /触及/.test(item?.text ?? "") ? 10 : 5,
    normalRangeFeet: attack.ranged ? Number(range?.[1] ?? 80) : undefined,
    longRangeFeet: attack.ranged ? Number(range?.[2] ?? 320) : undefined,
    damage: {
      count: Number(match?.[1] ?? 1),
      sides: Number(match?.[2] ?? 4),
      bonus: Number(match?.[3] ?? 0),
      damageType: attack.ranged ? "piercing" : "physical",
    },
  };
}

function playerCapabilities(sheet: CharacterSheet) {
  return [
    ...(sheet.equipment ?? []).map((item) => `equipment:${item}`),
    ...(sheet.backpack ?? []).map((entry) => `item:${entry.itemId}`),
  ];
}

function playerEntity(userId: string, rawSheet: CharacterSheet) {
  const sheet = ensureGear(rawSheet);
  const resources = resourceCounts(sheet);
  const ownedResourceFeatures = new Set(Object.keys(sheet.resources ?? {}));
  return {
    id: userId,
    kind: "player" as const,
    name: sheet.name || "冒险者",
    abilityScores: sheet.scores,
    proficiencyBonus: sheet.proficiency,
    proficientSkills: [...sheet.skills],
    expertiseSkills: [...sheet.expertise],
    capabilities: playerCapabilities(sheet),
    level: sheet.level,
    spellLevels: Object.fromEntries(
      [...new Set([...sheet.cantrips, ...sheet.prepared, ...sheet.spellbook])]
        .map((spellId) => [spellId, spellById(spellId)?.level] as const)
        .filter((entry): entry is [string, 0 | 1 | 2] => entry[1] !== undefined),
    ),
    spellActionCosts: Object.fromEntries(
      [...new Set([...sheet.cantrips, ...sheet.prepared, ...sheet.spellbook])].map(
        (spellId) => {
          const time = spellById(spellId)?.time ?? "";
          const cost: "action" | "bonusAction" | "reaction" = time.includes("反应")
            ? "reaction"
            : time.includes("附赠")
              ? "bonusAction"
              : "action";
          return [spellId, cost] as const;
        },
      ),
    ),
    featureIds: [
      "rage",
      "surge",
      "secondWind",
      "channel",
      "breath",
      "torch",
      "ration",
      ...(sheet.classId === "rogue" ? ["cunningAction"] : []),
      ...(sheet.raceId === "lightfoot" ? ["halflingLucky"] : []),
      ...(sheet.classId === "wizard" ? ["arcaneRecovery"] : []),
    ].filter(
      (featureId) =>
        featureId === "arcaneRecovery" ||
        featureId === "cunningAction" ||
        featureId === "halflingLucky" ||
        ownedResourceFeatures.has(featureId),
    ),
    activeEffects: [
      ...(sheet.resources?.rage.on ? ["rage"] : []),
      ...(["guidance", "bless"].includes(sheet.resources?.conc?.id ?? "")
        ? [sheet.resources!.conc!.id]
        : []),
    ],
    attacks: [primaryAttack(sheet)],
    resources,
    resourceRules: resourceRules(sheet),
    hp: { current: sheet.hp.current, max: sheet.hp.max },
    ac: sheet.ac,
    speedFeet: sheet.speed,
  };
}

export async function initializeRoomAuthority(input: {
  roomId: string;
  moduleId: string;
  characters: Array<{ userId: string; sheet: CharacterSheet }>;
}) {
  const stub = roomStub(input.roomId);
  const players = input.characters.map(({ userId, sheet }) => playerEntity(userId, sheet));
  const result = await stub.initialize({
    roomId: input.roomId,
    moduleId: input.moduleId,
    rulesetVersion: RULESET_VERSION,
    players,
  });
  for (const player of players) await stub.upsertPlayer({ player });
  return result;
}

export function upsertRoomPlayer(roomId: string, userId: string, sheet: CharacterSheet) {
  return roomStub(roomId).upsertPlayer({ player: playerEntity(userId, sheet) });
}

export function departRoomPlayer(roomId: string, userId: string) {
  return roomStub(roomId).departPlayer(userId);
}

export function synchronizeRoomPlayerLoadout(
  roomId: string,
  userId: string,
  rawSheet: CharacterSheet,
) {
  const sheet = ensureGear(rawSheet);
  return roomStub(roomId).synchronizePlayerLoadout({
    playerId: userId,
    ac: sheet.ac,
    attacks: [primaryAttack(sheet)],
    capabilities: playerCapabilities(sheet),
  });
}

export function prepareRoomTurn(roomId: string, actorId: string): Promise<TurnTicket> {
  return roomStub(roomId).prepareTurn({ actorId });
}

export function commitRoomTurn(
  roomId: string,
  ticketId: string,
  command: Command,
): Promise<CommitTurnResult> {
  return roomStub(roomId).commitTurn({ ticketId, command });
}

export function roomProjection(roomId: string, viewerId: string) {
  return roomStub(roomId).getSnapshot(viewerId);
}

export function finishRoomNarration(roomId: string, ticketId: string) {
  return roomStub(roomId).finishNarration(ticketId);
}

export function failRoomInterpretation(roomId: string, ticketId: string) {
  return roomStub(roomId).markInterpretationFailed(ticketId);
}
