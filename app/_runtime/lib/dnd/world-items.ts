import { ensureGear } from "./compute";
import { itemById } from "./gear";
import { ensureResources } from "./resources";
import type { CharacterSheet } from "./types";
import type { WorldEffect } from "../kp/action-ruling";

export type WorldEffectResult =
  | { ok: true; sheet: CharacterSheet; note: string }
  | { ok: false; error: string };

function resourceLabel(resource: "torch" | "ration") {
  return resource === "torch" ? "火把" : "口粮";
}

export function applyWorldEffect(
  input: CharacterSheet,
  effect: WorldEffect,
): WorldEffectResult {
  const sheet = ensureGear(ensureResources(input));
  const resources = sheet.resources!;

  if (effect.type === "consume_resource") {
    const current = resources[effect.resource];
    if (current < effect.quantity) {
      return { ok: false, error: `没有足够的${resourceLabel(effect.resource)}` };
    }
    const remaining = current - effect.quantity;
    return {
      ok: true,
      sheet: {
        ...sheet,
        resources: { ...resources, [effect.resource]: remaining },
      },
      note: `${resourceLabel(effect.resource)}剩余 ${remaining}`,
    };
  }

  if (effect.itemId === "torch" || effect.itemId === "ration") {
    const resource = effect.itemId;
    const total = resources[resource] + effect.quantity;
    return {
      ok: true,
      sheet: {
        ...sheet,
        resources: { ...resources, [resource]: total },
      },
      note: `获得${effect.itemName} ×${effect.quantity}，${resourceLabel(resource)}现有 ${total}`,
    };
  }

  const item = itemById(effect.itemId);
  if (!item) return { ok: false, error: `物品目录中没有${effect.itemName}` };
  const backpack = (sheet.backpack ?? []).map((entry) => ({ ...entry }));
  const existing = backpack.find((entry) => entry.itemId === effect.itemId);
  if (existing) existing.qty += effect.quantity;
  else backpack.push({ itemId: effect.itemId, qty: effect.quantity });
  return {
    ok: true,
    sheet: { ...sheet, backpack },
    note: `获得${item.name} ×${effect.quantity}`,
  };
}

