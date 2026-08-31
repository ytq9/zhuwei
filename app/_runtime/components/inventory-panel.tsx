"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  GEAR_SLOTS,
  slotLabel,
  type GearSlot,
} from "@/lib/dnd/gear";
import { setGear, useInventoryItem } from "@/lib/table/client";
import type {
  AuthoritativeInventory,
  AuthoritativeInventoryActivity,
  AuthoritativeInventoryEntry,
  AuthoritativeIdentifiedInventoryEntry,
} from "@/lib/table/authoritative";
import { tableActionAccepted } from "@/lib/table/authoritative-client";

type InventoryPanelProps = {
  inventory?: AuthoritativeInventory;
  canEdit: boolean;
  code: string;
};

type GearActionController = {
  busyKey: string | null;
  act(action: "wear" | "stow", slot: GearSlot, itemId?: string): Promise<void>;
  use(itemEntryId: string): Promise<void>;
};

const UNAVAILABLE_ITEM_LABEL = "物品资料不可用";
const OPAQUE_ITEM_LABEL = "未辨明物品";

function inventoryEntryLabel(entry: AuthoritativeInventoryEntry): string {
  return entry.kind === "identified" ? entry.name : OPAQUE_ITEM_LABEL;
}

function useGearActions(code: string, canEdit: boolean): GearActionController {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function act(
    action: "wear" | "stow",
    slot: GearSlot,
    itemId?: string,
  ) {
    if (!canEdit || inFlight.current) return;
    const actionKey = `${action}:${slot}:${itemId ?? ""}`;
    inFlight.current = true;
    setBusyKey(actionKey);
    try {
      const result = await setGear({ data: { code, action, slot, itemId } });
      if (!tableActionAccepted(result)) {
        toast.error(String(result.error ?? "换装失败"));
      } else {
        void queryClient.invalidateQueries({ queryKey: ["table", code] });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "换装失败");
    } finally {
      inFlight.current = false;
      setBusyKey(null);
    }
  }

  async function use(itemEntryId: string) {
    if (!canEdit || inFlight.current) return;
    const actionKey = `use:${itemEntryId}`;
    inFlight.current = true;
    setBusyKey(actionKey);
    try {
      const result = await useInventoryItem({ data: { code, itemEntryId } });
      if (!tableActionAccepted(result)) {
        toast.error(String(result.error ?? "使用物品失败"));
      } else {
        void queryClient.invalidateQueries({ queryKey: ["table", code] });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "使用物品失败");
    } finally {
      inFlight.current = false;
      setBusyKey(null);
    }
  }

  return { busyKey, act, use };
}

function InventorySection({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerId = `${id}-trigger`;
  const panelId = `${id}-panel`;
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-[12px] border border-border">
      <button
        id={triggerId}
        type="button"
        aria-controls={panelId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 px-2.5 py-2 text-left"
      >
        <span className="text-xs font-medium">{title}</span>
        <span className="min-w-0 truncate text-[11px] text-subtle">
          {open ? "收起" : hint}
        </span>
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
          className="min-w-0 border-t border-border px-2.5 py-2"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

const INVENTORY_ACTIVITY_DISABLED_COPY: Record<
  NonNullable<AuthoritativeInventoryActivity["disabledReason"]>,
  string
> = {
  itemBroken: "物品已损坏",
  insufficientQuantity: "数量不足",
  insufficientCharges: "充能不足",
  insufficientDurability: "耐久不足",
};

export function inventoryWornSummary(inventory: AuthoritativeInventory) {
  const entriesBySlot = new Map(
    inventory.entries.flatMap((entry) => entry.equippedSlot === null
      ? []
      : [[entry.equippedSlot, entry] as const]),
  );
  const labels = GEAR_SLOTS.flatMap(({ id }) => {
    const entry = entriesBySlot.get(id);
    return entry === undefined ? [] : [inventoryEntryLabel(entry)];
  });
  return labels.length > 0
    ? `${labels.length} 个槽位 · ${labels.join("、")}`
    : "未装备";
}

export function inventoryPackSummary(inventory: AuthoritativeInventory) {
  const entries = inventory.entries.filter(({ equippedSlot }) => equippedSlot === null);
  if (entries.length === 0) return "空";
  const total = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  return `${entries.length} 种 · 共 ${total} 个`;
}

function AuthoritativeItemFacts({ entry }: { entry: AuthoritativeIdentifiedInventoryEntry }) {
  const counters = [
    entry.charges === null
      ? null
      : `充能 ${entry.charges.current}/${entry.charges.maximum}`,
    entry.durability === null
      ? null
      : `耐久 ${entry.durability.current}/${entry.durability.maximum}`,
    entry.condition === "broken" ? "已损坏" : null,
  ].filter((fact): fact is string => fact !== null);
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">
        {entry.publicDamageText ? `${entry.publicDamageText}。` : ""}{entry.description}
      </p>
      {counters.length > 0 ? (
        <p className="mt-1 text-[11px] text-subtle">{counters.join(" · ")}</p>
      ) : null}
    </>
  );
}

function OpaqueItemState({ entry }: { entry: AuthoritativeInventoryEntry & { kind: "opaque" } }) {
  const placement = entry.equippedSlot === null ? "背包" : slotLabel(entry.equippedSlot);
  const condition = entry.condition === "broken" ? "已损坏" : "可用";
  return (
    <p className="text-[11px] text-subtle">
      数量 {entry.quantity} · 槽位 {placement} · 状态 {condition}
    </p>
  );
}

function AuthoritativeItemControls({
  entry,
  canEdit,
  actions,
  stowSlot,
}: {
  entry: AuthoritativeIdentifiedInventoryEntry;
  canEdit: boolean;
  actions: GearActionController;
  stowSlot?: GearSlot;
}) {
  if (!canEdit) return null;
  const useActivity = entry.activities.find(({ activityId }) => activityId === "use");
  const useKey = `use:${entry.entryId}`;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-busy={actions.busyKey !== null}>
      {useActivity ? (
        <Button
          type="button"
          size="sm"
          variant="brass"
          className="min-h-11"
          disabled={actions.busyKey !== null || !useActivity.enabled}
          title={useActivity.disabledReason === null
            ? undefined
            : INVENTORY_ACTIVITY_DISABLED_COPY[useActivity.disabledReason]}
          onClick={() => void actions.use(entry.entryId)}
        >
          {actions.busyKey === useKey
            ? "使用中……"
            : useActivity.disabledReason === null
              ? useActivity.label
              : INVENTORY_ACTIVITY_DISABLED_COPY[useActivity.disabledReason]}
        </Button>
      ) : null}
      {stowSlot === undefined
        ? entry.allowedSlots.map((slot) => {
            const actionKey = `wear:${slot}:${entry.entryId}`;
            return (
              <Button
                key={slot}
                type="button"
                size="sm"
                variant="brass"
                className="min-h-11"
                disabled={actions.busyKey !== null}
                onClick={() => void actions.act("wear", slot, entry.entryId)}
              >
                {actions.busyKey === actionKey
                  ? "装备中……"
                  : `装备到${slotLabel(slot)}`}
              </Button>
            );
          })
        : (
            <Button
              type="button"
              size="sm"
              variant="brass"
              className="min-h-11"
              disabled={actions.busyKey !== null}
              onClick={() => void actions.act("stow", stowSlot)}
            >
              {actions.busyKey === `stow:${stowSlot}:` ? "收纳中……" : "卸到背包"}
            </Button>
          )}
    </div>
  );
}

function AuthoritativeGearSlots({
  inventory,
  canEdit,
  actions,
}: {
  inventory: AuthoritativeInventory;
  canEdit: boolean;
  actions: GearActionController;
}) {
  const [openSlot, setOpenSlot] = useState<GearSlot | null>(null);
  const id = useId();
  const entriesBySlot = new Map(
    inventory.entries.flatMap((entry) => entry.equippedSlot === null
      ? []
      : [[entry.equippedSlot, entry] as const]),
  );
  return (
    <ul className="grid gap-1.5">
      {GEAR_SLOTS.map((slot) => {
        const entry = entriesBySlot.get(slot.id);
        const open = openSlot === slot.id;
        const triggerId = `${id}-${slot.id}-trigger`;
        const panelId = `${id}-${slot.id}-panel`;
        return (
          <li key={slot.id} className="rounded-[10px] border border-border bg-bg/40">
            <button
              id={triggerId}
              type="button"
              aria-controls={panelId}
              aria-expanded={open}
              onClick={() => setOpenSlot(open ? null : slot.id)}
              className="flex min-h-11 w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
            >
              <span className="text-[11px] text-subtle">{slot.label}</span>
              <span className="min-w-0 break-words text-right text-xs [overflow-wrap:anywhere]">
                {entry === undefined
                  ? <span className="text-subtle">空</span>
                  : <>{inventoryEntryLabel(entry)}{entry.quantity > 1 ? ` ×${entry.quantity}` : ""}</>}
              </span>
            </button>
            {open ? (
              <div
                id={panelId}
                role="region"
                aria-labelledby={triggerId}
                className="border-t border-border px-2.5 py-2"
              >
                {entry === undefined ? (
                  <p className="text-xs text-subtle">这一格是空的。从背包里选一件装备。</p>
                ) : (
                  entry.kind === "opaque" ? (
                    <>
                      <OpaqueItemState entry={entry} />
                      {canEdit ? (
                        <div className="mt-2 flex flex-wrap gap-1.5" aria-busy={actions.busyKey !== null}>
                          <Button
                            type="button"
                            size="sm"
                            variant="brass"
                            className="min-h-11"
                            disabled={actions.busyKey !== null}
                            onClick={() => void actions.act("stow", slot.id)}
                          >
                            {actions.busyKey === `stow:${slot.id}:` ? "收纳中……" : "卸到背包"}
                          </Button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <AuthoritativeItemFacts entry={entry} />
                      <AuthoritativeItemControls
                        entry={entry}
                        canEdit={canEdit}
                        actions={actions}
                        stowSlot={slot.id}
                      />
                    </>
                  )
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function AuthoritativeBackpack({
  inventory,
  canEdit,
  actions,
}: {
  inventory: AuthoritativeInventory;
  canEdit: boolean;
  actions: GearActionController;
}) {
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const id = useId();
  const entries = inventory.entries.filter(({ equippedSlot }) => equippedSlot === null);
  if (entries.length === 0) {
    return <p className="text-xs text-subtle">背包是空的。</p>;
  }
  return (
    <ul className="grid gap-1.5">
      {entries.map((entry, index) => {
        const open = openEntry === entry.entryId;
        const triggerId = `${id}-${index}-trigger`;
        const panelId = `${id}-${index}-panel`;
        return (
          <li key={entry.entryId} className="rounded-[10px] border border-border bg-bg/40">
            <button
              id={triggerId}
              type="button"
              aria-controls={panelId}
              aria-expanded={open}
              onClick={() => setOpenEntry(open ? null : entry.entryId)}
              className="flex min-h-11 w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
            >
              <span className="min-w-0 break-words text-xs [overflow-wrap:anywhere]">
                {inventoryEntryLabel(entry)}
              </span>
              <span className="shrink-0 text-[11px] text-subtle">×{entry.quantity}</span>
            </button>
            {open ? (
              <div
                id={panelId}
                role="region"
                aria-labelledby={triggerId}
                className="border-t border-border px-2.5 py-2"
              >
                {entry.kind === "opaque" ? (
                  <OpaqueItemState entry={entry} />
                ) : (
                  <>
                    <AuthoritativeItemFacts entry={entry} />
                    <AuthoritativeItemControls
                      entry={entry}
                      canEdit={canEdit}
                      actions={actions}
                    />
                  </>
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function InventoryPanel({
  inventory,
  canEdit,
  code,
}: InventoryPanelProps) {
  const actions = useGearActions(code, canEdit);
  if (inventory === undefined) return (
    <div className="rounded-[12px] border border-border px-2.5 py-3 text-xs text-subtle">
      {UNAVAILABLE_ITEM_LABEL}
    </div>
  );
  return (
    <>
      <InventorySection title="身上" hint={inventoryWornSummary(inventory)}>
        <AuthoritativeGearSlots
          inventory={inventory}
          canEdit={canEdit}
          actions={actions}
        />
      </InventorySection>
      <InventorySection title="背包" hint={inventoryPackSummary(inventory)}>
        <AuthoritativeBackpack
          inventory={inventory}
          canEdit={canEdit}
          actions={actions}
        />
      </InventorySection>
    </>
  );
}
