"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  GEAR_SLOTS,
  allowedSlots,
  itemById,
  slotLabel,
  type Equipped,
  type GearSlot,
  type PackEntry,
} from "@/lib/dnd/gear";
import { setGear } from "@/lib/table/client";
import { tableActionAccepted } from "@/lib/table/authoritative-client";

type InventoryPanelProps = {
  equipped: Equipped;
  backpack: PackEntry[];
  canEdit: boolean;
  code: string;
};

type GearActionController = {
  busyKey: string | null;
  act(action: "wear" | "stow", slot: GearSlot, itemId?: string): Promise<void>;
};

const UNAVAILABLE_ITEM_LABEL = "物品资料不可用";

export function inventoryWornSummary(equipped: Equipped) {
  const labels = GEAR_SLOTS.flatMap((slot) => {
    const itemId = equipped[slot.id];
    if (!itemId) return [];
    return [itemById(itemId)?.name ?? UNAVAILABLE_ITEM_LABEL];
  });
  return labels.length > 0
    ? `${labels.length} 个槽位 · ${labels.join("、")}`
    : "未装备";
}

export function inventoryPackSummary(backpack: PackEntry[]) {
  if (backpack.length === 0) return "空";
  const total = backpack.reduce((sum, entry) => sum + entry.qty, 0);
  return `${backpack.length} 种 · 共 ${total} 个`;
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

  return { busyKey, act };
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

function GearSlots({
  equipped,
  canEdit,
  actions,
}: {
  equipped: Equipped;
  canEdit: boolean;
  actions: GearActionController;
}) {
  const [openSlot, setOpenSlot] = useState<GearSlot | null>(null);
  const id = useId();
  return (
    <ul className="grid gap-1.5">
      {GEAR_SLOTS.map((slot) => {
        const itemId = equipped[slot.id];
        const item = itemById(itemId);
        const open = openSlot === slot.id;
        const triggerId = `${id}-${slot.id}-trigger`;
        const panelId = `${id}-${slot.id}-panel`;
        const actionKey = `stow:${slot.id}:`;
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
              <span className="text-xs">
                {itemId
                  ? item?.name ?? UNAVAILABLE_ITEM_LABEL
                  : <span className="text-subtle">空</span>}
              </span>
            </button>
            {open ? (
              <div
                id={panelId}
                role="region"
                aria-labelledby={triggerId}
                className="border-t border-border px-2.5 py-2"
              >
                {itemId ? (
                  <>
                    <p className="text-xs leading-relaxed text-muted">
                      {item
                        ? `${item.damage ? `${item.damage}。` : ""}${item.text}`
                        : "这件物品的公开资料暂不可用。"}
                    </p>
                    {canEdit ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="brass"
                        className="mt-2 min-h-11"
                        disabled={actions.busyKey !== null}
                        onClick={() => void actions.act("stow", slot.id)}
                      >
                        {actions.busyKey === actionKey ? "收纳中……" : "卸到背包"}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs text-subtle">这一格是空的。从背包里选一件装备。</p>
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Backpack({
  backpack,
  canEdit,
  actions,
}: {
  backpack: PackEntry[];
  canEdit: boolean;
  actions: GearActionController;
}) {
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const id = useId();
  if (backpack.length === 0) {
    return <p className="text-xs text-subtle">背包是空的。</p>;
  }
  return (
    <ul className="grid gap-1.5">
      {backpack.map((entry, index) => {
        const item = itemById(entry.itemId);
        const entryKey = `${entry.itemId}:${index}`;
        const open = openEntry === entryKey;
        const slots = item ? allowedSlots(item) : [];
        const triggerId = `${id}-${index}-trigger`;
        const panelId = `${id}-${index}-panel`;
        return (
          <li key={entryKey} className="rounded-[10px] border border-border bg-bg/40">
            <button
              id={triggerId}
              type="button"
              aria-controls={panelId}
              aria-expanded={open}
              onClick={() => setOpenEntry(open ? null : entryKey)}
              className="flex min-h-11 w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
            >
              <span className="text-xs">{item?.name ?? UNAVAILABLE_ITEM_LABEL}</span>
              <span className="text-[11px] text-subtle">×{entry.qty}</span>
            </button>
            {open ? (
              <div
                id={panelId}
                role="region"
                aria-labelledby={triggerId}
                className="border-t border-border px-2.5 py-2"
              >
                <p className="text-xs leading-relaxed text-muted">
                  {item
                    ? `${item.damage ? `${item.damage}。` : ""}${item.text}`
                    : "这件物品的公开资料暂不可用。"}
                </p>
                {canEdit && slots.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {slots.map((slot) => {
                      const actionKey = `wear:${slot}:${entry.itemId}`;
                      return (
                        <Button
                          key={slot}
                          type="button"
                          size="sm"
                          variant="brass"
                          className="min-h-11"
                          disabled={actions.busyKey !== null}
                          onClick={() => void actions.act("wear", slot, entry.itemId)}
                        >
                          {actions.busyKey === actionKey
                            ? "装备中……"
                            : `装备到${slotLabel(slot)}`}
                        </Button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function InventoryPanel({
  equipped,
  backpack,
  canEdit,
  code,
}: InventoryPanelProps) {
  const actions = useGearActions(code, canEdit);
  return (
    <>
      <InventorySection title="身上" hint={inventoryWornSummary(equipped)}>
        <GearSlots equipped={equipped} canEdit={canEdit} actions={actions} />
      </InventorySection>
      <InventorySection title="背包" hint={inventoryPackSummary(backpack)}>
        <Backpack backpack={backpack} canEdit={canEdit} actions={actions} />
      </InventorySection>
    </>
  );
}
