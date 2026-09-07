import { ITEMS, ITEM_STOCK_RESOURCE_IDS } from "../../dnd/gear";
import type { ProjectedInventory } from "./item-projection";
import { standardGearDefinitionId, type ItemSystemStateV1 } from "./items";

/** Physical stock aliases and exact item pools cannot become class resources. */
export function isItemStockResourceId(resourceId: string): boolean {
  return resourceId.startsWith("item:")
    || resourceId.startsWith("item-entry:")
    || ITEM_STOCK_RESOURCE_IDS.includes(resourceId);
}

export function nonItemResources(resources: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(resources)
    .filter(([resourceId]) => !isItemStockResourceId(resourceId)));
}

/** Uses the already-authorized inventory so opaque or hidden items do not
 * disclose their definition through a stock counter. No count is persisted. */
export function projectItemStockResources(
  itemSystem: ItemSystemStateV1,
  inventory: ProjectedInventory,
): Record<string, number> {
  const stocks = Object.fromEntries(ITEM_STOCK_RESOURCE_IDS.map((id) => [id, 0]));
  const resourceByDefinition = new Map(ITEMS.flatMap((item) => item.stockResourceId === undefined
    ? [] : [[standardGearDefinitionId(item.id), item.stockResourceId] as const]));
  for (const projected of inventory.entries) {
    if (projected.kind !== "identified") continue;
    const entry = itemSystem.entries[projected.entryId];
    const resourceId = entry === undefined ? undefined : resourceByDefinition.get(entry.definitionRef);
    if (resourceId !== undefined) stocks[resourceId] += projected.quantity;
  }
  return stocks;
}
