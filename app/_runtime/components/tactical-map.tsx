import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type {
  TacticalEntity,
  TacticalKnownFeature,
  TacticalProjection,
  TacticalZone,
} from "@/lib/rules/tactical-projection";
import { cn } from "@/lib/utils";

const FEATURE_STYLE: Record<TacticalKnownFeature["kind"], string> = {
  barrier: "fill-stone-500/45 stroke-stone-200",
  terrain: "fill-brass/20 stroke-amber-300",
  interactable: "fill-primary/15 stroke-primary/80",
  destructible: "fill-danger/35 stroke-red-200",
  portal: "fill-moss/45 stroke-emerald-100",
};

const RELATION_STYLE: Record<TacticalEntity["relation"], string> = {
  self: "fill-brass/80 stroke-white",
  ally: "fill-moss/85 stroke-emerald-100",
  enemy: "fill-danger/75 stroke-red-100",
  neutral: "fill-stone-500/75 stroke-stone-100",
};

const ZONE_STYLE = "fill-violet-600/25 stroke-violet-200";

const FEATURE_KIND_LABEL: Record<TacticalKnownFeature["kind"], string> = {
  barrier: "屏障",
  terrain: "地形",
  interactable: "可互动物",
  destructible: "可破坏物",
  portal: "门或通路",
};

const RELATION_LABEL: Record<TacticalEntity["relation"], string> = {
  self: "自己",
  ally: "盟友",
  enemy: "敌对",
  neutral: "中立",
};

const COVER_LABEL: Record<TacticalKnownFeature["cover"], string> = {
  none: "无掩护",
  half: "半掩护",
  threeQuarters: "四分之三掩护",
  full: "全掩护",
};

const COVER_MARK: Record<TacticalKnownFeature["cover"], string | null> = {
  none: null,
  half: "½",
  threeQuarters: "¾",
  full: "全",
};

const TERRAIN_LABEL: Record<TacticalKnownFeature["terrain"], string> = {
  normal: "普通地面",
  rubble: "瓦砾地形",
};

const TACTICAL_STATE_LABEL: Record<string, string> = {
  active: "生效中",
  alive: "正常",
  closed: "关闭",
  dead: "死亡",
  destroyed: "已摧毁",
  difficult: "困难地形",
  disabled: "已失效",
  intact: "完整",
  open: "开启",
  triggered: "已触发",
  unconscious: "昏迷",
};

const CONDITION_LABEL: Record<string, string> = {
  blinded: "目盲",
  charmed: "魅惑",
  deafened: "耳聋",
  frightened: "恐慌",
  grappled: "被擒抱",
  grappledBy: "被擒抱",
  incapacitated: "失能",
  invisible: "隐形",
  paralyzed: "麻痹",
  petrified: "石化",
  poisoned: "中毒",
  prone: "倒地",
  restrained: "束缚",
  stable: "伤势稳定",
  stunned: "震慑",
  unconscious: "昏迷",
};

const EFFECT_LABEL: Record<string, string> = {
  "heavily-obscured": "重度遮蔽",
};

type TacticalView = "map" | "text";

type TacticalSelection =
  | { kind: "entity"; value: TacticalEntity }
  | { kind: "feature"; value: TacticalKnownFeature }
  | { kind: "zone"; value: TacticalZone };

function inches(value: string): number {
  return Number(value);
}

function formatLength(value: string): string {
  const totalInches = BigInt(value);
  const absoluteInches = totalInches < 0n ? -totalInches : totalInches;
  const feet = absoluteInches / 12n;
  const remainingInches = absoluteInches % 12n;
  const sign = totalInches < 0n ? "-" : "";
  if (feet === 0n) return `${sign}${remainingInches} 英寸`;
  return remainingInches === 0n
    ? `${sign}${feet} 尺`
    : `${sign}${feet} 尺 ${remainingInches} 英寸`;
}

function formatElevation(value: string): string {
  if (value === "0") return "地面";
  return BigInt(value) > 0n ? `+${formatLength(value)}` : formatLength(value);
}

function mapElevationLabel(value: string): string | null {
  if (value === "0") return null;
  const elevation = BigInt(value);
  const sign = elevation > 0n ? "+" : "-";
  const absolute = elevation > 0n ? elevation : -elevation;
  const feet = absolute / 12n;
  const remainingInches = absolute % 12n;
  if (feet === 0n) return `${sign}${remainingInches}寸`;
  return remainingInches === 0n
    ? `${sign}${feet}尺`
    : `${sign}${feet}尺${remainingInches}寸`;
}

function formatTacticalState(value: string): string {
  return TACTICAL_STATE_LABEL[value] ?? value;
}

function formatPublicState(value: string): string {
  const separator = value.indexOf(":");
  if (separator === -1) return CONDITION_LABEL[value] ?? value;
  const kind = value.slice(0, separator);
  const state = value.slice(separator + 1);
  if (kind === "life") return TACTICAL_STATE_LABEL[state] ?? state;
  if (kind === "condition") return CONDITION_LABEL[state] ?? state;
  return value;
}

function formatEffectTag(value: string): string {
  return EFFECT_LABEL[value] ?? value;
}

function polygonPoints(points: Array<{ x: string; y: string }>): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function polygonCenter(points: Array<{ x: string; y: string }>): { x: number; y: number } {
  const sum = points.reduce(
    (current, point) => ({
      x: current.x + inches(point.x),
      y: current.y + inches(point.y),
    }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function featureMechanics(feature: TacticalKnownFeature): string[] {
  return [
    feature.impassable ? "阻挡移动" : "不阻挡移动",
    feature.opaque ? "阻挡视线" : "不阻挡视线",
    COVER_LABEL[feature.cover],
    feature.propagation === "blocks" ? "阻断区域传播" : "允许区域传播",
    TERRAIN_LABEL[feature.terrain],
  ];
}

function entityMapLabel(entity: TacticalEntity): string {
  return entity.relation === "self" ? "我" : Array.from(entity.name).slice(0, 2).join("");
}

function entitySelectionKey(entityId: string): string {
  return `entity:${entityId}`;
}

function featureSelectionKey(featureId: string): string {
  return `feature:${featureId}`;
}

function zoneSelectionKey(zoneId: string): string {
  return `zone:${zoneId}`;
}

function resolveSelection(
  projection: TacticalProjection,
  selectedKey: string | null,
): TacticalSelection | null {
  if (!selectedKey) return null;
  if (selectedKey.startsWith("entity:")) {
    const entityId = selectedKey.slice("entity:".length);
    const entity = [projection.self, ...projection.visibleEntities]
      .find((candidate) => candidate.id === entityId);
    return entity ? { kind: "entity", value: entity } : null;
  }
  if (selectedKey.startsWith("feature:")) {
    const featureId = selectedKey.slice("feature:".length);
    const feature = projection.knownFeatures.find((candidate) => candidate.id === featureId);
    return feature ? { kind: "feature", value: feature } : null;
  }
  if (selectedKey.startsWith("zone:")) {
    const zoneId = selectedKey.slice("zone:".length);
    const zone = projection.knownZones.find((candidate) => candidate.id === zoneId);
    return zone ? { kind: "zone", value: zone } : null;
  }
  return null;
}

function initialSelectionKey(projection: TacticalProjection): string {
  const activeEntityId = projection.encounter?.activeEntityId;
  const activeEntity = activeEntityId
    ? [projection.self, ...projection.visibleEntities]
      .find((candidate) => candidate.id === activeEntityId)
    : undefined;
  return entitySelectionKey(activeEntity?.id ?? projection.self.id);
}

function activateOnKeyboard(event: KeyboardEvent<SVGGElement>, activate: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

function TacticalEntityMark({
  entity,
  currentActor,
  selected,
  onSelect,
}: {
  entity: TacticalEntity;
  currentActor: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const x = inches(entity.position.x);
  const y = inches(entity.position.y);
  const width = inches(entity.footprint.width);
  const depth = inches(entity.footprint.depth);
  const mapLabel = entityMapLabel(entity);
  const elevationLabel = mapElevationLabel(entity.position.elevation);
  const title = `${entity.name}${currentActor ? "；当前行动" : ""}；占位 ${entity.footprint.width}×${entity.footprint.depth} 英寸；高程 ${formatElevation(entity.position.elevation)}；高度 ${formatLength(entity.footprint.height)}`;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`查看${entity.name}的战术详情`}
      aria-pressed={selected}
      data-entity-id={entity.id}
      data-relation={entity.relation}
      data-position-x={entity.position.x}
      data-position-y={entity.position.y}
      data-footprint-width={entity.footprint.width}
      data-footprint-depth={entity.footprint.depth}
      data-elevation-inches={entity.position.elevation}
      data-height-inches={entity.footprint.height}
      data-current-actor={String(currentActor)}
      data-map-label={mapLabel}
      data-selected={String(selected)}
      className={cn(
        RELATION_STYLE[entity.relation],
        "cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brass",
      )}
      onClick={onSelect}
      onKeyDown={(event) => activateOnKeyboard(event, onSelect)}
    >
      <title>{title}</title>
      <rect
        x={x - width / 2}
        y={y - depth / 2}
        width={width}
        height={depth}
        rx={Math.min(width, depth) / 5}
        className="stroke-[8] [vector-effect:non-scaling-stroke]"
      />
      {currentActor ? (
        <rect
          x={x - width / 2 - 10}
          y={y - depth / 2 - 10}
          width={width + 20}
          height={depth + 20}
          rx={Math.min(width, depth) / 4}
          fill="none"
          className="stroke-brass stroke-[6] [vector-effect:non-scaling-stroke]"
        />
      ) : null}
      {selected ? (
        <rect
          x={x - width / 2 - 18}
          y={y - depth / 2 - 18}
          width={width + 36}
          height={depth + 36}
          rx={Math.min(width, depth) / 3}
          fill="none"
          className="stroke-white/90 stroke-[5] [stroke-dasharray:12_8] [vector-effect:non-scaling-stroke]"
        />
      ) : null}
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        className="pointer-events-none fill-white stroke-black/70 text-[28px] font-semibold [paint-order:stroke] [stroke-width:6px]"
      >
        {mapLabel}
      </text>
      {elevationLabel ? (
        <text
          x={x + width / 2 + 10}
          y={y - depth / 2 - 8}
          textAnchor="start"
          className="pointer-events-none fill-primary stroke-black/80 text-[20px] font-semibold [paint-order:stroke] [stroke-width:5px]"
        >
          {elevationLabel}
        </text>
      ) : null}
    </g>
  );
}

function TacticalFeatureShape({
  feature,
  selected,
  onSelect,
  opaquePatternId,
  propagationPatternId,
}: {
  feature: TacticalKnownFeature;
  selected: boolean;
  onSelect: () => void;
  opaquePatternId: string;
  propagationPatternId: string;
}) {
  const mechanics = featureMechanics(feature);
  const center = polygonCenter(feature.polygon);
  const coverMark = COVER_MARK[feature.cover];
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`查看${feature.label}的战术详情`}
      aria-pressed={selected}
      data-feature-id={feature.id}
      data-feature-kind={feature.kind}
      data-feature-state={feature.state}
      data-impassable={String(feature.impassable)}
      data-opaque={String(feature.opaque)}
      data-cover={feature.cover}
      data-propagation={feature.propagation}
      data-terrain={feature.terrain}
      data-elevation-inches={feature.elevation}
      data-height-inches={feature.height}
      data-selected={String(selected)}
      className={cn(
        FEATURE_STYLE[feature.kind],
        "cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brass",
      )}
      onClick={onSelect}
      onKeyDown={(event) => activateOnKeyboard(event, onSelect)}
    >
      <title>{`${feature.label}；状态 ${formatTacticalState(feature.state)}；${mechanics.join("；")}；高程 ${formatElevation(feature.elevation)}；高度 ${formatLength(feature.height)}`}</title>
      <polygon
        points={polygonPoints(feature.polygon)}
        data-movement-encoding={feature.impassable ? "solid" : "dashed"}
        className={cn(
          "stroke-[8] [vector-effect:non-scaling-stroke]",
          !feature.impassable && "[stroke-dasharray:24_14]",
        )}
      />
      {feature.opaque ? (
        <polygon
          points={polygonPoints(feature.polygon)}
          data-vision-encoding="diagonal-hatch"
          fill={`url(#${opaquePatternId})`}
          className="pointer-events-none stroke-none"
        />
      ) : null}
      {feature.propagation === "blocks" ? (
        <polygon
          points={polygonPoints(feature.polygon)}
          data-propagation-encoding="dot-hatch"
          fill={`url(#${propagationPatternId})`}
          className="pointer-events-none stroke-none"
        />
      ) : null}
      {coverMark ? (
        <g
          data-cover-encoding={feature.cover}
          className="pointer-events-none"
        >
          <circle
            cx={center.x}
            cy={center.y}
            r={20}
            className="fill-[#0d0b0a] stroke-white/80 stroke-[3] [vector-effect:non-scaling-stroke]"
          />
          <text
            x={center.x}
            y={center.y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-white text-[22px] font-semibold"
          >
            {coverMark}
          </text>
        </g>
      ) : null}
      {selected ? (
        <polygon
          points={polygonPoints(feature.polygon)}
          fill="none"
          className="pointer-events-none stroke-white stroke-[14] [stroke-dasharray:18_10] [vector-effect:non-scaling-stroke]"
        />
      ) : null}
    </g>
  );
}

function TacticalZoneShape({
  zone,
  selected,
  onSelect,
}: {
  zone: TacticalZone;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`查看${zone.label}的战术详情`}
      aria-pressed={selected}
      data-zone-id={zone.id}
      data-zone-state={zone.state}
      data-elevation-inches={zone.geometry.elevation}
      data-height-inches={zone.geometry.height}
      data-selected={String(selected)}
      className={cn(
        ZONE_STYLE,
        "cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brass",
      )}
      onClick={onSelect}
      onKeyDown={(event) => activateOnKeyboard(event, onSelect)}
    >
      <title>{`${zone.label}；状态 ${formatTacticalState(zone.state)}；高程 ${formatElevation(zone.geometry.elevation)}；高度 ${formatLength(zone.geometry.height)}`}</title>
      <polygon
        points={polygonPoints(zone.geometry.points)}
        className={cn(
          "stroke-[6] [stroke-dasharray:18_12] [vector-effect:non-scaling-stroke]",
          selected && "stroke-white stroke-[12]",
        )}
      />
    </g>
  );
}

function encounterReadout(projection: TacticalProjection): string {
  if (projection.encounter === null) return "当前遭遇信息未知";
  if (projection.encounter.status === "concluded") return "遭遇已收束";
  const entities = [projection.self, ...projection.visibleEntities];
  const activeEntity = projection.encounter.activeEntityId
    ? entities.find((entity) => entity.id === projection.encounter?.activeEntityId)
    : undefined;
  if (!activeEntity) return `第 ${projection.encounter.round} 轮 · 当前行动者未知`;
  return activeEntity.id === projection.self.id
    ? `第 ${projection.encounter.round} 轮 · 轮到你`
    : `第 ${projection.encounter.round} 轮 · 当前行动：${activeEntity.name}`;
}

export function TacticalMap({
  projection,
  defaultExpanded = false,
}: {
  projection: TacticalProjection | null | undefined;
  defaultExpanded?: boolean;
}) {
  const baseId = useId().replace(/:/g, "");
  const desktopContentId = `tactical-map-${baseId}-desktop`;
  const mobileDialogId = `tactical-map-${baseId}-mobile`;
  const mobileTitleId = `${mobileDialogId}-title`;
  const desktopTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileDialogRef = useRef<HTMLDivElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const mobileReturnFocusRef = useRef<"mobile" | "desktop">("mobile");
  const [desktopExpanded, setDesktopExpanded] = useState(
    Boolean(projection) && defaultExpanded,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [view, setView] = useState<TacticalView>("map");
  const [selectedKey, setSelectedKey] = useState<string | null>(
    projection ? initialSelectionKey(projection) : null,
  );
  const isDesktopExpanded = Boolean(projection) && desktopExpanded;
  const isMobileOpen = Boolean(projection) && mobileOpen;
  const status = projection
    ? encounterReadout(projection)
    : "尚无观察者可见的战术地图数据";

  useEffect(() => {
    if (!isMobileOpen || typeof window === "undefined") return;
    const dialog = mobileDialogRef.current;
    if (!dialog) return;
    const desktopViewport = window.matchMedia("(min-width: 64rem)");
    const desktopTrigger = desktopTriggerRef.current;
    const mobileTrigger = mobileTriggerRef.current;
    if (desktopViewport.matches) {
      const closeFrame = window.requestAnimationFrame(() => {
        setMobileOpen(false);
        desktopTrigger?.focus();
      });
      return () => window.cancelAnimationFrame(closeFrame);
    }
    const previouslyFocused = document.activeElement;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mobileCloseRef.current?.focus();

    const focusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    )).filter((element) => element.getClientRects().length > 0);
    const containKeyboardFocus = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    const closeAtDesktopBreakpoint = (event: MediaQueryListEvent) => {
      if (!event.matches) return;
      mobileReturnFocusRef.current = "desktop";
      setMobileOpen(false);
    };
    window.addEventListener("keydown", containKeyboardFocus);
    desktopViewport.addEventListener("change", closeAtDesktopBreakpoint);
    return () => {
      window.removeEventListener("keydown", containKeyboardFocus);
      desktopViewport.removeEventListener("change", closeAtDesktopBreakpoint);
      document.body.style.overflow = previousBodyOverflow;
      const preferredFocus = mobileReturnFocusRef.current === "desktop"
        ? desktopTrigger
        : mobileTrigger;
      if (
        preferredFocus?.isConnected
        && preferredFocus.getClientRects().length > 0
      ) {
        preferredFocus.focus();
      } else if (
        previouslyFocused instanceof HTMLElement
        && previouslyFocused.isConnected
        && previouslyFocused.getClientRects().length > 0
      ) {
        previouslyFocused.focus();
      }
      mobileReturnFocusRef.current = "mobile";
    };
  }, [isMobileOpen]);

  return (
    <section
      data-tactical-map-disclosure={projection ? "ready" : "unknown"}
      aria-label="战术地图"
      className="min-w-0 max-w-full shrink-0 border-b border-border bg-bg/45"
    >
      <div className="px-4 py-2.5">
        <button
          ref={desktopTriggerRef}
          type="button"
          data-tactical-disclosure-trigger="desktop"
          aria-expanded={isDesktopExpanded}
          aria-controls={desktopContentId}
          disabled={!projection}
          onClick={() => setDesktopExpanded((current) => !current)}
          className="hidden min-w-0 w-full items-center justify-between gap-4 rounded-[12px] border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-70 lg:flex"
        >
          <span className="min-w-0">
            <span className="block truncate font-display text-sm">
              战术地图{projection ? ` · ${projection.scene.name}` : "暂不可用"}
            </span>
            <span className="block truncate text-[11px] text-subtle">{status}</span>
          </span>
          <span className="shrink-0 text-xs text-brass">
            {projection ? (isDesktopExpanded ? "收起" : "展开") : "暂不可用"}
          </span>
        </button>

        <button
          ref={mobileTriggerRef}
          type="button"
          data-tactical-disclosure-trigger="mobile"
          aria-expanded={isMobileOpen}
          aria-controls={mobileDialogId}
          aria-haspopup="dialog"
          disabled={!projection}
          onClick={() => {
            mobileReturnFocusRef.current = "mobile";
            setMobileOpen(true);
          }}
          className="flex min-w-0 w-full items-center justify-between gap-3 rounded-[12px] border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-70 lg:hidden"
        >
          <span className="min-w-0">
            <span className="block truncate font-display text-sm">
              地图{projection ? ` · ${projection.scene.name}` : "暂不可用"}
            </span>
            <span className="block truncate text-[11px] text-subtle">{status}</span>
          </span>
          <span className="shrink-0 text-xs text-brass">
            {projection ? "打开" : "暂不可用"}
          </span>
        </button>
      </div>

      <div
        id={desktopContentId}
        hidden={!isDesktopExpanded}
        className="hidden lg:block"
      >
        {isDesktopExpanded && projection ? (
          <TacticalMapExpanded
            projection={projection}
            instanceId={`${baseId}-desktop`}
            view={view}
            selectedKey={selectedKey}
            onViewChange={setView}
            onSelect={setSelectedKey}
          />
        ) : null}
      </div>

      {isMobileOpen && projection ? (
        <div
          ref={mobileDialogRef}
          id={mobileDialogId}
          role="dialog"
          aria-modal="true"
          aria-labelledby={mobileTitleId}
          tabIndex={-1}
          data-tactical-map-mobile="open"
          className="fixed inset-0 z-[70] flex min-h-0 flex-col bg-bg lg:hidden"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p id={mobileTitleId} className="truncate font-display text-base">
                {projection.scene.name}战术地图
              </p>
              <p className="truncate text-xs text-brass">{status}</p>
            </div>
            <button
              ref={mobileCloseRef}
              type="button"
              aria-label="关闭战术地图"
              onClick={() => setMobileOpen(false)}
              className="shrink-0 rounded-[10px] border border-border px-3 py-2 text-sm text-fg hover:bg-elevated"
            >
              关闭
            </button>
          </header>
          <TacticalMapExpanded
            projection={projection}
            instanceId={`${baseId}-mobile`}
            view={view}
            selectedKey={selectedKey}
            onViewChange={setView}
            onSelect={setSelectedKey}
            mobile
          />
        </div>
      ) : null}
    </section>
  );
}

function TacticalMapExpanded({
  projection,
  instanceId,
  view,
  selectedKey,
  onViewChange,
  onSelect,
  mobile = false,
}: {
  projection: TacticalProjection;
  instanceId: string;
  view: TacticalView;
  selectedKey: string | null;
  onViewChange: (view: TacticalView) => void;
  onSelect: (key: string) => void;
  mobile?: boolean;
}) {
  const selected = resolveSelection(projection, selectedKey)
    ?? { kind: "entity" as const, value: projection.self };
  const effectiveSelectedKey = selected.kind === "entity"
    ? entitySelectionKey(selected.value.id)
    : selected.kind === "feature"
      ? featureSelectionKey(selected.value.id)
      : zoneSelectionKey(selected.value.id);

  return (
    <section
      data-tactical-map="v1"
      data-tactical-layout={mobile ? "mobile-dialog" : "desktop-inline"}
      data-tactical-view={view}
      className={cn(
        "min-w-0 max-w-full",
        mobile ? "min-h-0 flex-1 overflow-y-auto p-3" : "px-4 pb-3",
      )}
    >
      <div className="mx-auto grid w-full max-w-[58rem] gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex items-center justify-between gap-3 lg:col-span-2">
          <div
            role="tablist"
            aria-label="战术地图显示方式"
            className="inline-flex rounded-[10px] border border-border bg-surface p-1"
          >
            {(["map", "text"] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                role="tab"
                data-tactical-view-trigger={candidate}
                aria-selected={view === candidate}
                onClick={() => onViewChange(candidate)}
                className={cn(
                  "rounded-[7px] px-3 py-1.5 text-xs transition-colors",
                  view === candidate
                    ? "bg-elevated text-fg"
                    : "text-subtle hover:text-fg",
                )}
              >
                {candidate === "map" ? "地图" : "文字版"}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-subtle">
            观察者投影 · 每格 {formatLength(String(projection.scene.gridInches))}
          </p>
        </div>

        {view === "map" ? (
          <>
            <TacticalMapCanvas
              projection={projection}
              instanceId={instanceId}
              selectedKey={effectiveSelectedKey}
              onSelect={onSelect}
            />
            <aside
              data-tactical-detail="v1"
              className="flex min-w-0 flex-col gap-3 rounded-[16px] border border-border bg-surface p-3 lg:h-[min(28dvh,17rem)]"
            >
              <SelectedTacticalDetail
                projection={projection}
                selected={selected}
              />
              <TacticalLegend />
              <div className="mt-auto space-y-1 border-t border-border pt-2 text-[11px] text-subtle">
                <p data-tactical-features={projection.knownFeatures.length > 0 ? "known" : "unknown"}>
                  {projection.knownFeatures.length > 0
                    ? `已知环境要素 ${projection.knownFeatures.length} 项`
                    : "尚无已知环境要素；未投影内容保持未知。"}
                </p>
                <p data-tactical-zones={projection.knownZones.length > 0 ? "known" : "unknown"}>
                  {projection.knownZones.length > 0
                    ? `已知区域效果 ${projection.knownZones.length} 项`
                    : "尚无已知区域效果；未投影内容保持未知。"}
                </p>
                <p data-tactical-interactions="deferred">
                  当前可点选查看详情；移动与范围预览后续支持。
                </p>
              </div>
            </aside>
          </>
        ) : (
          <TacticalTextReadout projection={projection} />
        )}
      </div>
    </section>
  );
}

function TacticalMapCanvas({
  projection,
  instanceId,
  selectedKey,
  onSelect,
}: {
  projection: TacticalProjection;
  instanceId: string;
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const xs = projection.scene.boundary.points.map((point) => inches(point.x));
  const ys = projection.scene.boundary.points.map((point) => inches(point.y));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(projection.scene.gridInches, Math.max(...xs) - minX);
  const height = Math.max(projection.scene.gridInches, Math.max(...ys) - minY);
  const gridId = `tactical-grid-${instanceId}-${projection.scene.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const opaquePatternId = `${gridId}-opaque`;
  const propagationPatternId = `${gridId}-propagation`;
  const entities = [projection.self, ...projection.visibleEntities];

  return (
    <div
      data-tactical-canvas="v1"
      className="aspect-[4/3] min-w-0 overflow-hidden rounded-[16px] border border-border bg-[#0d0b0a] p-2 lg:h-[min(28dvh,17rem)] lg:aspect-auto"
    >
      <svg
        role="group"
        aria-label={`${projection.scene.name}战术地图`}
        width={width}
        height={height}
        viewBox={`${minX} ${minY} ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full max-w-full touch-manipulation"
      >
        <defs>
          <pattern
            id={gridId}
            data-grid-inches={projection.scene.gridInches}
            width={projection.scene.gridInches}
            height={projection.scene.gridInches}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${projection.scene.gridInches} 0 L 0 0 0 ${projection.scene.gridInches}`}
              fill="none"
              className="stroke-white/12 stroke-[2]"
            />
          </pattern>
          <pattern
            id={opaquePatternId}
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M -7 7 L 7 -7 M 0 28 L 28 0 M 21 35 L 35 21"
              fill="none"
              className="stroke-white/55 stroke-[4]"
            />
          </pattern>
          <pattern
            id={propagationPatternId}
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="6" cy="6" r="3" className="fill-white/75" />
            <circle cx="18" cy="18" r="3" className="fill-white/75" />
          </pattern>
        </defs>
        <polygon
          data-scene-boundary={projection.scene.id}
          points={polygonPoints(projection.scene.boundary.points)}
          fill={`url(#${gridId})`}
          className="stroke-brass/80 stroke-[8] [vector-effect:non-scaling-stroke]"
        />
        {projection.knownZones.map((zone) => {
          const key = zoneSelectionKey(zone.id);
          return (
            <TacticalZoneShape
              key={zone.id}
              zone={zone}
              selected={selectedKey === key}
              onSelect={() => onSelect(key)}
            />
          );
        })}
        {projection.knownFeatures.map((feature) => {
          const key = featureSelectionKey(feature.id);
          return (
            <TacticalFeatureShape
              key={feature.id}
              feature={feature}
              selected={selectedKey === key}
              onSelect={() => onSelect(key)}
              opaquePatternId={opaquePatternId}
              propagationPatternId={propagationPatternId}
            />
          );
        })}
        {entities.map((entity) => {
          const key = entitySelectionKey(entity.id);
          return (
            <TacticalEntityMark
              key={entity.id}
              entity={entity}
              currentActor={entity.id === projection.encounter?.activeEntityId}
              selected={selectedKey === key}
              onSelect={() => onSelect(key)}
            />
          );
        })}
      </svg>
    </div>
  );
}

function SelectedTacticalDetail({
  projection,
  selected,
}: {
  projection: TacticalProjection;
  selected: TacticalSelection;
}) {
  if (selected.kind === "entity") {
    const entity = selected.value;
    return (
      <section data-tactical-selected={`entity:${entity.id}`} className="min-w-0">
        <p className="text-[11px] text-subtle">当前选中 · {RELATION_LABEL[entity.relation]}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h3 className="font-display text-base">{entity.name}</h3>
          {entity.id === projection.encounter?.activeEntityId ? (
            <span className="rounded-full border border-brass/50 px-2 py-0.5 text-[10px] text-brass">
              当前行动
            </span>
          ) : null}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <dt className="text-subtle">占位</dt>
            <dd className="mt-0.5 text-fg">
              {formatLength(entity.footprint.width)} × {formatLength(entity.footprint.depth)}
            </dd>
          </div>
          <div>
            <dt className="text-subtle">高程</dt>
            <dd className="mt-0.5 text-fg">{formatElevation(entity.position.elevation)}</dd>
          </div>
          <div>
            <dt className="text-subtle">高度</dt>
            <dd className="mt-0.5 text-fg">{formatLength(entity.footprint.height)}</dd>
          </div>
          <div>
            <dt className="text-subtle">公开状态</dt>
            <dd className="mt-0.5 break-words text-fg">
              {entity.publicStates.length > 0
                ? entity.publicStates.map(formatPublicState).join("、")
                : "无额外状态"}
            </dd>
          </div>
        </dl>
      </section>
    );
  }

  if (selected.kind === "feature") {
    const feature = selected.value;
    return (
      <section data-tactical-selected={`feature:${feature.id}`} className="min-w-0">
        <p className="text-[11px] text-subtle">当前选中 · {FEATURE_KIND_LABEL[feature.kind]}</p>
        <h3 className="mt-1 font-display text-base">{feature.label}</h3>
        <p className="mt-1 text-xs text-brass">状态：{formatTacticalState(feature.state)}</p>
        <ul className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted">
          {featureMechanics(feature).map((mechanic) => (
            <li key={mechanic} className="rounded-full border border-border px-2 py-1">
              {mechanic}
            </li>
          ))}
        </ul>
        {feature.durability ? (
          <p className="mt-3 text-xs text-muted">
            耐久 {feature.durability.current}/{feature.durability.maximum}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted">
          高程 {formatElevation(feature.elevation)} · 高度 {formatLength(feature.height)}
        </p>
      </section>
    );
  }

  const zone = selected.value;
  return (
    <section data-tactical-selected={`zone:${zone.id}`} className="min-w-0">
      <p className="text-[11px] text-subtle">当前选中 · 区域效果</p>
      <h3 className="mt-1 font-display text-base">{zone.label}</h3>
      <p className="mt-1 text-xs text-brass">状态：{formatTacticalState(zone.state)}</p>
      <p className="mt-3 break-words text-xs text-muted">
        {zone.effectTags.length > 0
          ? zone.effectTags.map(formatEffectTag).join(" · ")
          : "无额外公开效果标签"}
      </p>
      <p className="mt-2 text-xs text-muted">
        高程 {formatElevation(zone.geometry.elevation)} · 高度 {formatLength(zone.geometry.height)}
      </p>
    </section>
  );
}

function TacticalLegend() {
  return (
    <details className="rounded-[12px] border border-border px-3 py-2 text-xs">
      <summary className="text-muted">查看图例</summary>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted">
        <p><span className="mr-1 text-brass">■</span>自己</p>
        <p><span className="mr-1 text-moss">■</span>盟友</p>
        <p><span className="mr-1 text-danger">■</span>敌对</p>
        <p><span className="mr-1 text-stone-400">■</span>中立</p>
        <p><span className="mr-1 text-primary">□</span>可互动物</p>
        <p><span className="mr-1 text-violet-300">▧</span>区域效果</p>
      </div>
      <div className="mt-2 space-y-1 border-t border-border pt-2 text-[11px] text-subtle">
        <p>实线边阻挡移动；虚线边可通过。</p>
        <p>斜纹阻挡视线；点纹阻断区域传播。</p>
        <p>图形内 ½ / ¾ / 全 表示掩护等级。</p>
      </div>
    </details>
  );
}

function TacticalTextReadout({ projection }: { projection: TacticalProjection }) {
  return (
    <section
      data-tactical-readout="v1"
      role="tabpanel"
      aria-label={`${projection.scene.name}文字战术读数`}
      tabIndex={0}
      className="min-w-0 max-h-[min(50dvh,22rem)] overflow-y-auto break-words rounded-[16px] border border-border bg-surface px-4 py-3 text-sm outline-none [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-brass lg:col-span-2"
    >
      <p className="font-display text-base">{projection.scene.name} · 文字战术读数</p>
      <p className="mt-2 text-muted">{projection.textualReadout.summary}</p>
      {projection.textualReadout.entities.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted">
          {projection.textualReadout.entities.map((entry) => <li key={entry}>{entry}</li>)}
        </ul>
      ) : (
        <p className="mt-3 text-subtle">当前没有其他可见单位。</p>
      )}
      {projection.textualReadout.features.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted">
          {projection.textualReadout.features.map((entry) => <li key={entry}>{entry}</li>)}
        </ul>
      ) : (
        <p className="mt-3 text-subtle">尚无已知环境要素；未投影内容保持未知。</p>
      )}
      {projection.knownZones.length > 0 ? (
        <div className="mt-4 border-t border-border pt-3">
          <p className="font-display text-sm">已知区域效果</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
            {projection.knownZones.map((zone) => (
              <li key={zone.id}>
                {zone.label}；状态 {formatTacticalState(zone.state)}；
                {zone.effectTags.length > 0
                  ? zone.effectTags.map(formatEffectTag).join("、")
                  : "无额外公开效果"}；
                高程 {formatElevation(zone.geometry.elevation)}，
                高度 {formatLength(zone.geometry.height)}。
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-subtle">尚无已知区域效果；未投影内容保持未知。</p>
      )}
    </section>
  );
}
