"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Backpack, ChevronRight, HeartPulse, Shield, Swords, UserRound } from "lucide-react";
import { classById, raceById } from "@/lib/dnd/catalog";
import { CLASS_RESOURCE_CATALOG } from "@/lib/dnd/class-resources";
import { CONDITION_LABEL } from "@/lib/dnd/condition-labels";
import type { CharacterSheet } from "@/lib/dnd/types";
import type { CharacterCondition, CombatVitals } from "@/lib/table/authoritative";
import { cn } from "@/lib/utils";

/** The width from which the character panel sits beside the scene instead of
 * opening over it. */
const DOCKED_PANEL_QUERY = "(min-width: 80rem)";

export function useCharacterPanelDocked(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const query = window.matchMedia(DOCKED_PANEL_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia(DOCKED_PANEL_QUERY).matches,
    () => false,
  );
}

export type CharacterVitals = {
  name: string;
  summary: string;
  hitPoints?: { current: number; maximum: number; temporary: number };
  armorClass?: number;
  speedFeet?: number;
  conditions: Array<{ id: string; label: string }>;
  /** Present while the character concentrates; null when Rules gave no name. */
  concentration?: string | null;
  /** Shown only while the character is dying. */
  deathSaves?: { successes: number; failures: number };
};

export type ResourcePool = {
  id: string;
  label: string;
  current: number;
  maximum?: number;
  /** When it comes back. */
  note?: string;
};

const FEATURE_RECOVERY: Readonly<Record<string, string>> = {
  surge: "短休",
  secondWind: "短休",
  rage: "长休",
  channel: "短休",
  superiority: "短休",
  warPriest: "长休",
  breath: "短休",
  relentless: "长休",
};

const SLOT_LEVEL_LABEL = ["", "一环", "二环", "三环", "四环", "五环", "六环", "七环", "八环", "九环"];

/** SPEC 0010 §7: the character's own pools as Rules counts them, labelled
 * for display: spell slots by level, class resources, hit dice. Item stocks
 * (coins, arrows, torches, rations) stay with the inventory. */
export function characterResourcePools(input: {
  resources?: Record<string, number>;
  maximums?: Record<string, number>;
  hitDieSides?: number;
}): ResourcePool[] {
  const resources = input.resources ?? {};
  const maximums = input.maximums ?? {};
  const pool = (id: string, label: string, note?: string): ResourcePool[] => {
    const maximum = maximums[id];
    const current = resources[id];
    if (!Number.isSafeInteger(maximum) || maximum <= 0) return [];
    return [{
      id,
      label,
      current: Number.isSafeInteger(current) ? Math.max(0, Math.min(maximum, current)) : maximum,
      maximum,
      ...(note === undefined ? {} : { note }),
    }];
  };
  const ward = resources.ward;
  return [
    ...SLOT_LEVEL_LABEL.slice(1).flatMap((label, index) => pool(`slot${index + 1}`, label, "长休")),
    ...Object.entries(CLASS_RESOURCE_CATALOG).flatMap(([id, entry]) => pool(id, entry.label, FEATURE_RECOVERY[id])),
    ...pool("hitDice", "生命骰", input.hitDieSides === undefined ? undefined : `d${input.hitDieSides}`),
    ...(Number.isSafeInteger(ward) && ward > 0 ? [{ id: "ward", label: "奥术结界", current: ward }] : []),
  ];
}

/** The authority's conditions by their display names; a sheet without them
 * shows its own condition notes. Unknown ids are not shown as raw ids. */
export function characterConditionLabels(
  conditions: CharacterCondition[] | undefined,
  sheetConditions: readonly string[],
): Array<{ id: string; label: string }> {
  if (conditions === undefined) return [...new Set(sheetConditions)].map((label) => ({ id: label, label }));
  return conditions.flatMap((condition) => {
    const label = CONDITION_LABEL[condition.id];
    if (label === undefined) return [];
    return [{ id: condition.id, label: condition.level === undefined ? label : `${label} ${condition.level} 级` }];
  });
}

/** What the panel shows about the character, from the authority first and the
 * locked sheet where the authority has nothing. */
export function characterVitalsOf(input: {
  sheet: CharacterSheet;
  level?: number;
  hitPoints?: { current: number; maximum: number };
  armorClass?: number;
  speedFeet?: number;
  conditions?: CharacterCondition[];
  combat?: CombatVitals;
}): CharacterVitals {
  const { sheet, combat } = input;
  const cls = classById(sheet.classId);
  const subclass = cls?.subclasses.find((candidate) => candidate.id === sheet.subclassId);
  const current = input.hitPoints?.current ?? sheet.hp.current;
  const dying = combat !== undefined && combat.lifeState === "unconscious" && current === 0
    && !(input.conditions ?? []).some((condition) => condition.id === "stable");
  return {
    name: sheet.name || "未名",
    summary: `${raceById(sheet.raceId)?.name ?? ""}${cls?.name ?? ""}${subclass ? ` · ${subclass.name}` : ""} ${input.level ?? sheet.level} 级`,
    hitPoints: {
      current,
      maximum: input.hitPoints?.maximum ?? sheet.hp.max,
      temporary: combat?.temporaryHitPoints ?? 0,
    },
    armorClass: input.armorClass ?? sheet.ac,
    speedFeet: input.speedFeet ?? sheet.speed,
    conditions: characterConditionLabels(input.conditions, sheet.conditions),
    ...(combat?.concentration ? { concentration: combat.concentration.name } : {}),
    ...(dying ? { deathSaves: combat.deathSaves } : {}),
  };
}

function Pips({ current, maximum, label }: { current: number; maximum: number; label: string }) {
  if (maximum > 8) {
    return <span className="tabular-nums text-fg">{current}<span className="text-subtle">/{maximum}</span></span>;
  }
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`${label} ${current}/${maximum}`}>
      {Array.from({ length: maximum }, (_, index) => (
        <span
          key={index}
          className={cn(
            "size-2 rounded-full border",
            index < current ? "border-brass bg-brass" : "border-subtle bg-transparent",
          )}
        />
      ))}
    </span>
  );
}

function HitPointBar({ hitPoints }: { hitPoints: NonNullable<CharacterVitals["hitPoints"]> }) {
  const maximum = Math.max(1, hitPoints.maximum);
  const share = Math.max(0, Math.min(1, hitPoints.current / maximum));
  return (
    <span className="relative block h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-bg/70" aria-hidden="true">
      <span
        className={cn("absolute inset-y-0 left-0 rounded-full", share <= 0.25 ? "bg-danger" : "bg-brass")}
        style={{ width: `${share * 100}%` }}
      />
    </span>
  );
}

function VitalsBlock({ vitals }: { vitals: CharacterVitals }) {
  const hitPoints = vitals.hitPoints;
  return (
    <div data-character-vitals className="grid gap-2.5">
      {hitPoints ? (
        <div className="flex items-center gap-2 text-xs" data-character-hit-points>
          <HeartPulse className="size-3.5 shrink-0 text-brass" aria-hidden="true" />
          <span className="text-muted">生命</span>
          <HitPointBar hitPoints={hitPoints} />
          <span className="font-display text-sm tabular-nums text-fg">
            {hitPoints.current}<span className="text-subtle">/{hitPoints.maximum}</span>
          </span>
          {hitPoints.temporary > 0 ? (
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[11px] tabular-nums text-muted">
              临时 +{hitPoints.temporary}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {vitals.armorClass !== undefined ? (
          <span className="inline-flex items-center gap-1">
            <Shield className="size-3.5 text-brass" aria-hidden="true" />
            护甲 <span className="font-display tabular-nums text-fg">{vitals.armorClass}</span>
          </span>
        ) : null}
        {vitals.speedFeet !== undefined ? (
          <span>速度 <span className="tabular-nums text-fg">{vitals.speedFeet}</span> 尺</span>
        ) : null}
      </div>
      {vitals.conditions.length > 0 || vitals.concentration !== undefined ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="当前状态">
          {vitals.concentration !== undefined ? (
            <li className="rounded-full border border-brass/40 bg-brass/10 px-2 py-0.5 text-[11px] text-brass">
              专注 · {vitals.concentration ?? "一项法术"}
            </li>
          ) : null}
          {vitals.conditions.map((condition) => (
            <li key={condition.id} className="rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[11px] text-fg">
              {condition.label}
            </li>
          ))}
        </ul>
      ) : null}
      {vitals.deathSaves ? (
        <div className="flex flex-wrap items-center gap-3 rounded-control border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[11px] text-fg" data-character-death-saves>
          <span>死亡豁免</span>
          <span className="inline-flex items-center gap-1">成功 <Pips current={vitals.deathSaves.successes} maximum={3} label="成功" /></span>
          <span className="inline-flex items-center gap-1">失败 <Pips current={vitals.deathSaves.failures} maximum={3} label="失败" /></span>
        </div>
      ) : null}
    </div>
  );
}

function PoolsBlock({ pools }: { pools: ResourcePool[] }) {
  if (pools.length === 0) return null;
  return (
    <ul data-character-pools className="grid gap-1.5 text-xs">
      {pools.map((pool) => (
        <li key={pool.id} className="flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 text-muted">
            {pool.label}
            {pool.note ? <span className="ml-1.5 text-[11px] text-subtle">{pool.note}</span> : null}
          </span>
          {pool.maximum === undefined
            ? <span className="tabular-nums text-fg">{pool.current}</span>
            : <Pips current={pool.current} maximum={pool.maximum} label={pool.label} />}
        </li>
      ))}
    </ul>
  );
}

export type CharacterPanelTab = "actions" | "inventory" | "profile";

const PANEL_TABS = [
  ["actions", Swords, "行动"],
  ["inventory", Backpack, "背包"],
  ["profile", UserRound, "角色"],
] as const;

/** The player's own character beside the scene (SPEC 0010 §7): state and
 * pools on top, then what the character can do, carries and is. */
export function CharacterPanel({
  vitals,
  pools,
  tab,
  onTabChange,
  headerAction,
  children,
}: {
  vitals: CharacterVitals;
  pools: ResourcePool[];
  tab: CharacterPanelTab;
  onTabChange: (tab: CharacterPanelTab) => void;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div data-character-panel className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="grid shrink-0 gap-3 border-b border-border px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p id="character-panel-title" className="font-display text-lg leading-tight text-fg">{vitals.name}</p>
            <p className="mt-0.5 text-xs text-subtle">{vitals.summary}</p>
          </div>
          {headerAction}
        </div>
        <VitalsBlock vitals={vitals} />
        <PoolsBlock pools={pools} />
      </header>
      <div role="tablist" aria-label="角色栏目" className="flex shrink-0 border-b border-border px-2">
        {PANEL_TABS.map(([id, Icon, label]) => (
          <button
            key={id}
            id={`character-panel-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`character-panel-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => onTabChange(id)}
            className={cn(
              "flex min-h-11 flex-1 items-center justify-center gap-1.5 border-b-2 px-2 text-sm transition",
              tab === id ? "border-brass text-fg" : "border-transparent text-subtle hover:text-muted",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <div
        id={`character-panel-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`character-panel-tab-${tab}`}
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 [overflow-wrap:anywhere]"
      >
        {children}
      </div>
    </div>
  );
}

/** One line of the character's state above the scene where the panel does
 * not fit beside it; it opens the panel. */
export function CharacterVitalsStrip({
  vitals,
  pools,
  expanded,
  onOpen,
}: {
  vitals: CharacterVitals;
  pools: ResourcePool[];
  expanded: boolean;
  onOpen: () => void;
}) {
  const hitPoints = vitals.hitPoints;
  const firstSpellSlot = pools.find((pool) => pool.id.startsWith("slot") && pool.current > 0)
    ?? pools.find((pool) => pool.id.startsWith("slot"));
  const keyPool = firstSpellSlot ?? pools.find((pool) => pool.id !== "hitDice" && pool.maximum !== undefined);
  const flagged = vitals.conditions.length + (vitals.concentration !== undefined ? 1 : 0);
  return (
    <button
      type="button"
      data-table-vitals-trigger
      aria-haspopup="dialog"
      aria-controls="character-panel"
      aria-expanded={expanded}
      onClick={onOpen}
      className="flex w-full shrink-0 items-center gap-2 border-b border-border bg-bg/35 px-3 py-2 text-left text-xs text-muted transition hover:bg-elevated sm:gap-3 sm:px-5"
    >
      {hitPoints ? (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <HeartPulse className="size-3.5 shrink-0 text-brass" aria-hidden="true" />
          <HitPointBar hitPoints={hitPoints} />
          <span className="shrink-0 tabular-nums text-fg">
            <span className="text-muted">生命 </span>{hitPoints.current}/{hitPoints.maximum}
          </span>
        </span>
      ) : null}
      {vitals.armorClass !== undefined ? (
        <span className="shrink-0">护甲 <span className="tabular-nums text-fg">{vitals.armorClass}</span></span>
      ) : null}
      {keyPool?.maximum !== undefined ? (
        <span className="shrink-0">
          {keyPool.label} <span className="tabular-nums text-fg">{keyPool.current}/{keyPool.maximum}</span>
        </span>
      ) : null}
      {flagged > 0 ? (
        <span className="shrink-0 rounded-full border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[11px] text-fg">
          状态 {flagged}
        </span>
      ) : null}
      <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
      <span className="sr-only">打开角色栏</span>
    </button>
  );
}
