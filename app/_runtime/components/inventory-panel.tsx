"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { useQueryClient } from "@tanstack/react-query";
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
  /** Puts the player's sentence about an item in the composer (dropping,
   * handing over, putting it somewhere), where the KP rules it once sent. */
  onDraft?: (sentence: string) => void;
};

type GearActionController = {
  busyKey: string | null;
  /** The last refusal, under the item it was about. */
  failure: { entryId: string; message: string } | null;
  act(action: "wear" | "stow", slot: GearSlot, entryId: string): Promise<void>;
  use(itemEntryId: string): Promise<void>;
};

const UNAVAILABLE_ITEM_LABEL = "物品资料不可用";
const OPAQUE_ITEM_LABEL = "未辨明物品";

function inventoryEntryLabel(entry: AuthoritativeInventoryEntry): string {
  return entry.kind === "identified" ? entry.name : OPAQUE_ITEM_LABEL;
}

/** Equipping, stowing and using go straight to Rules; whether a change costs
 * an action in combat is Rules' to decide, and a refusal is shown under the
 * item it concerns. */
function useGearActions(code: string, canEdit: boolean): GearActionController {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<GearActionController["failure"]>(null);

  async function act(
    action: "wear" | "stow",
    slot: GearSlot,
    entryId: string,
  ) {
    if (!canEdit || inFlight.current) return;
    const itemId = action === "wear" ? entryId : undefined;
    const actionKey = `${action}:${slot}:${itemId ?? ""}`;
    inFlight.current = true;
    setBusyKey(actionKey);
    setFailure(null);
    try {
      const result = await setGear({ data: { code, action, slot, itemId } });
      if (!tableActionAccepted(result)) {
        setFailure({ entryId, message: String(result.error ?? "换装失败") });
      } else {
        void queryClient.invalidateQueries({ queryKey: ["table", code] });
      }
    } catch (error) {
      setFailure({ entryId, message: error instanceof Error ? error.message : "换装失败" });
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
    setFailure(null);
    try {
      const result = await useInventoryItem({ data: { code, itemEntryId } });
      if (!tableActionAccepted(result)) {
        setFailure({ entryId: itemEntryId, message: String(result.error ?? "使用物品失败") });
      } else {
        void queryClient.invalidateQueries({ queryKey: ["table", code] });
      }
    } catch (error) {
      setFailure({ entryId: itemEntryId, message: error instanceof Error ? error.message : "使用物品失败" });
    } finally {
      inFlight.current = false;
      setBusyKey(null);
    }
  }

  return { busyKey, failure, act, use };
}

/** A disclosure for what is seldom needed: the empty slots and what a
 * container held when last looked into. */
function InventorySection({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return <Disclosure title={title} hint={hint}>{children}</Disclosure>;
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

/** The slots always shown first, filled or not; the others follow when filled. */
const CORE_SLOT_ORDER: readonly GearSlot[] = ["main", "off", "armor"];
const CORE_SLOTS: ReadonlySet<GearSlot> = new Set(CORE_SLOT_ORDER);

/** The backpack's groups, coins first, by the projected item category. */
const PACK_GROUPS: ReadonlyArray<{ id: string; label: string; categories: ReadonlyArray<AuthoritativeIdentifiedInventoryEntry["category"]> }> = [
  { id: "currency", label: "货币", categories: ["currency"] },
  { id: "weapon", label: "武器", categories: ["weapon"] },
  { id: "armor", label: "护甲与盾牌", categories: ["armor", "shield"] },
  { id: "ammunition", label: "弹药", categories: ["ammunition"] },
  { id: "consumable", label: "消耗品", categories: ["consumable"] },
  { id: "tool", label: "工具", categories: ["tool"] },
  { id: "other", label: "杂物", categories: ["equipment", "object"] },
];

const OBJECT_STATE_LABEL = { open: "已打开", closed: "已关闭", locked: "已上锁" } as const;

/** Sentences about an item the KP rules: the player finishes them in the
 * composer. */
function itemSentences(name: string): Array<{ label: string; sentence: string }> {
  return [
    { label: "放下", sentence: `我把${name}放在地上。` },
    { label: "交给…", sentence: `我把${name}交给` },
    { label: "放进…", sentence: `我把${name}放进` },
  ];
}

function AuthoritativeItemFacts({ entry }: { entry: AuthoritativeIdentifiedInventoryEntry }) {
  const counters = [
    entry.objectState === undefined ? null : OBJECT_STATE_LABEL[entry.objectState],
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

const ROW_BUTTON = `${buttonVariants({ variant: "secondary", size: "xs" })} shrink-0 px-2.5`;

/** What the row offers at a glance, as Rules allows it: stowing what is worn,
 * using, and equipping into each slot the item fits. */
function ItemQuickActions({
  entry,
  slot,
  actions,
}: {
  entry: AuthoritativeInventoryEntry;
  slot?: GearSlot;
  actions: GearActionController;
}) {
  const busy = actions.busyKey !== null;
  if (slot !== undefined) {
    return (
      <button
        type="button"
        data-inventory-stow={entry.entryId}
        disabled={busy}
        onClick={() => void actions.act("stow", slot, entry.entryId)}
        className={ROW_BUTTON}
      >
        {actions.busyKey === `stow:${slot}:` ? "收起中……" : "卸下"}
      </button>
    );
  }
  if (entry.kind === "opaque") return null;
  const useActivity = entry.activities.find(({ activityId }) => activityId === "use");
  return (
    <>
      {useActivity ? (
        <button
          type="button"
          data-inventory-use={entry.entryId}
          disabled={busy || !useActivity.enabled}
          title={useActivity.disabledReason === null
            ? undefined
            : INVENTORY_ACTIVITY_DISABLED_COPY[useActivity.disabledReason]}
          onClick={() => void actions.use(entry.entryId)}
          className={ROW_BUTTON}
        >
          {actions.busyKey === `use:${entry.entryId}`
            ? "使用中……"
            : useActivity.disabledReason === null
              ? useActivity.label
              : INVENTORY_ACTIVITY_DISABLED_COPY[useActivity.disabledReason]}
        </button>
      ) : null}
      {entry.allowedSlots.map((allowed) => (
        <button
          key={allowed}
          type="button"
          data-inventory-wear={`${entry.entryId}:${allowed}`}
          aria-label={`装备到${slotLabel(allowed)}`}
          disabled={busy}
          onClick={() => void actions.act("wear", allowed, entry.entryId)}
          className={ROW_BUTTON}
        >
          {actions.busyKey === `wear:${allowed}:${entry.entryId}`
            ? "装备中……"
            : entry.allowedSlots.length === 1 ? "装备" : `装到${slotLabel(allowed)}`}
        </button>
      ))}
    </>
  );
}

/** One item: its name, count and state, the actions Rules allows inline, and
 * on demand its description and the sentences the player can say about it. */
function ItemRow({
  entry,
  slot,
  canEdit,
  actions,
  onDraft,
}: {
  entry: AuthoritativeInventoryEntry;
  /** The slot it is worn in, if any. */
  slot?: GearSlot;
  canEdit: boolean;
  actions: GearActionController;
  onDraft?: (sentence: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerId = `${id}-trigger`;
  const panelId = `${id}-panel`;
  const tags = entry.kind === "identified"
    ? [
        entry.twoHanded ? "双手" : null,
        entry.objectState === undefined ? null : OBJECT_STATE_LABEL[entry.objectState],
        entry.condition === "broken" ? "已损坏" : null,
      ].filter((tag): tag is string => tag !== null)
    : entry.condition === "broken" ? ["已损坏"] : [];
  const failure = actions.failure?.entryId === entry.entryId ? actions.failure.message : null;
  return (
    <li data-inventory-entry={entry.entryId} className="min-w-0 rounded-control border border-border bg-bg/40">
      <div className="flex min-h-11 min-w-0 items-center gap-2 px-2.5 py-1">
        <button
          id={triggerId}
          type="button"
          aria-controls={panelId}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-left"
        >
          {slot !== undefined ? <span className="w-9 shrink-0 text-[11px] text-subtle">{slotLabel(slot)}</span> : null}
          <span className="min-w-0 break-words text-sm text-fg [overflow-wrap:anywhere]">{inventoryEntryLabel(entry)}</span>
          {entry.quantity > 1 ? <span className="shrink-0 text-xs tabular-nums text-subtle">×{entry.quantity}</span> : null}
          {tags.map((tag) => (
            <span key={tag} className="shrink-0 rounded-full border border-border px-1.5 text-[10px] text-subtle">{tag}</span>
          ))}
        </button>
        {canEdit ? (
          <span className="flex shrink-0 flex-wrap justify-end gap-1.5" aria-busy={actions.busyKey !== null}>
            <ItemQuickActions entry={entry} slot={slot} actions={actions} />
          </span>
        ) : null}
      </div>
      {failure ? (
        <p role="alert" data-inventory-failure className="px-2.5 pb-2 text-[11px] text-danger">{failure}</p>
      ) : null}
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
          className="space-y-2 border-t border-border px-2.5 py-2"
        >
          {entry.kind === "opaque" ? (
            <OpaqueItemState entry={entry} />
          ) : (
            <AuthoritativeItemFacts entry={entry} />
          )}
          {canEdit && onDraft && entry.kind === "identified" ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-subtle">说出来：</span>
              {itemSentences(entry.name).map(({ label, sentence }) => (
                <button
                  key={label}
                  type="button"
                  data-inventory-say={label}
                  onClick={() => onDraft(sentence)}
                  className={ROW_BUTTON}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function AuthoritativeGearSlots({
  inventory,
  canEdit,
  actions,
  onDraft,
}: {
  inventory: AuthoritativeInventory;
  canEdit: boolean;
  actions: GearActionController;
  onDraft?: (sentence: string) => void;
}) {
  const entriesBySlot = new Map(
    inventory.entries.flatMap((entry) => entry.equippedSlot === null
      ? []
      : [[entry.equippedSlot, entry] as const]),
  );
  const shown = [
    ...CORE_SLOT_ORDER.map((id) => GEAR_SLOTS.find((slot) => slot.id === id)!),
    ...GEAR_SLOTS.filter((slot) => !CORE_SLOTS.has(slot.id) && entriesBySlot.has(slot.id)),
  ];
  const empty = GEAR_SLOTS.filter((slot) => !CORE_SLOTS.has(slot.id) && !entriesBySlot.has(slot.id));
  return (
    <div className="grid min-w-0 gap-1.5">
      <ul className="grid min-w-0 gap-1.5">
        {shown.map((slot) => {
          const entry = entriesBySlot.get(slot.id);
          return entry === undefined ? (
            <li key={slot.id} data-inventory-slot={slot.id} className="flex min-h-11 items-center gap-2 rounded-control border border-dashed border-border px-2.5 text-xs">
              <span className="w-9 shrink-0 text-[11px] text-subtle">{slot.label}</span>
              <span className="text-subtle">空</span>
            </li>
          ) : (
            <ItemRow key={slot.id} entry={entry} slot={slot.id} canEdit={canEdit} actions={actions} onDraft={onDraft} />
          );
        })}
      </ul>
      {empty.length > 0 ? (
        <InventorySection title="其他槽位" hint={`${empty.length} 个空着`}>
          <p className="text-[11px] leading-relaxed text-subtle">{empty.map((slot) => slot.label).join("、")}：空。从背包里装备时会放到对应槽位。</p>
        </InventorySection>
      ) : null}
    </div>
  );
}

function AuthoritativeBackpack({
  inventory,
  canEdit,
  actions,
  onDraft,
}: {
  inventory: AuthoritativeInventory;
  canEdit: boolean;
  actions: GearActionController;
  onDraft?: (sentence: string) => void;
}) {
  const entries = inventory.entries.filter(({ equippedSlot }) => equippedSlot === null);
  if (entries.length === 0) {
    return <p className="text-xs text-subtle">背包是空的。</p>;
  }
  const groups = [
    ...PACK_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      entries: entries.filter((entry) => entry.kind === "identified" && group.categories.includes(entry.category)),
    })),
    { id: "opaque", label: "未辨明", entries: entries.filter((entry) => entry.kind === "opaque") },
  ].filter((group) => group.entries.length > 0);
  return (
    <div className="grid min-w-0 gap-3">
      {groups.map((group) => (
        <div key={group.id} role="group" aria-label={group.label} data-inventory-group={group.id} className="grid min-w-0 gap-1.5">
          <p className="text-[11px] text-subtle">{group.label}</p>
          <ul className="grid min-w-0 gap-1.5">
            {group.entries.map((entry) => (
              <ItemRow key={entry.entryId} entry={entry} canEdit={canEdit} actions={actions} onDraft={onDraft} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** SPEC 0010 §7, SPEC 0001 §16: the character's own items as Rules projects
 * them. What is worn comes first with its slot; the backpack is grouped by
 * kind with coins on top. Equipping, stowing and using go to Rules from the
 * row; anything else done with an item is the player's sentence. */
export function InventoryPanel({
  inventory,
  canEdit,
  code,
  onDraft,
}: InventoryPanelProps) {
  const actions = useGearActions(code, canEdit);
  if (inventory === undefined) return (
    <div className="rounded-control border border-border px-2.5 py-3 text-xs text-subtle">
      {UNAVAILABLE_ITEM_LABEL}
    </div>
  );
  return (
    <div className="grid min-w-0 gap-4">
      <section aria-label="身上" data-inventory-section="worn" className="grid min-w-0 gap-2">
        <p className="flex items-baseline justify-between gap-2 text-xs font-medium">
          身上
          <span className="min-w-0 truncate text-[11px] font-normal text-subtle">{inventoryWornSummary(inventory)}</span>
        </p>
        <AuthoritativeGearSlots
          inventory={inventory}
          canEdit={canEdit}
          actions={actions}
          onDraft={onDraft}
        />
      </section>
      <section aria-label="背包" data-inventory-section="pack" className="grid min-w-0 gap-2">
        <p className="flex items-baseline justify-between gap-2 text-xs font-medium">
          背包
          <span className="min-w-0 truncate text-[11px] font-normal text-subtle">{inventoryPackSummary(inventory)}</span>
        </p>
        <AuthoritativeBackpack
          inventory={inventory}
          canEdit={canEdit}
          actions={actions}
          onDraft={onDraft}
        />
      </section>
      {inventory.containerMemories?.map(memory => (
        <InventorySection key={memory.containerRef} title={`${inventoryEntryLabel(inventory.entries.find(entry => entry.entryId === memory.containerRef)!)} · 上次查看`}
          hint="重新打开后更新">
          <p className="text-xs text-muted">这是上次查看时的记录，当前内容可能已变化；重新打开后更新。</p>
          <ul className="mt-2 text-sm">
            {memory.entries.map(entry => <li key={entry.entryId}>{entry.name ?? OPAQUE_ITEM_LABEL} ×{entry.quantity}
              {entry.condition === "broken" ? " · 已损坏" : ""}
              {entry.charges ? ` · 充能 ${entry.charges.current}/${entry.charges.maximum}` : ""}
              {entry.durability ? ` · 耐久 ${entry.durability.current}/${entry.durability.maximum}` : ""}
            </li>)}
            {memory.entries.length === 0 ? <li>上次查看未发现物品</li> : null}
          </ul>
        </InventorySection>
      ))}
    </div>
  );
}
