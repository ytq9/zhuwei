import { useId, useState } from "react";
import type {
  TacticalEntity,
  TacticalKnownFeature,
  TacticalProjection,
  TacticalZone,
} from "@/lib/rules/tactical-projection";

const FEATURE_STYLE: Record<TacticalKnownFeature["kind"], string> = {
  barrier: "fill-stone-500/45 stroke-stone-200",
  terrain: "fill-amber-700/25 stroke-amber-300",
  interactable: "fill-sky-600/30 stroke-sky-200",
  destructible: "fill-orange-700/35 stroke-orange-200",
  portal: "fill-emerald-700/35 stroke-emerald-200",
};

const RELATION_STYLE: Record<TacticalEntity["relation"], string> = {
  self: "fill-brass/75 stroke-white",
  ally: "fill-sky-500/70 stroke-sky-100",
  enemy: "fill-danger/70 stroke-red-100",
  neutral: "fill-stone-500/70 stroke-stone-100",
};

const ZONE_STYLE = "fill-violet-600/25 stroke-violet-200";

const FEATURE_KIND_LABEL: Record<TacticalKnownFeature["kind"], string> = {
  barrier: "屏障",
  terrain: "地形",
  interactable: "可互动物",
  destructible: "可破坏物",
  portal: "门或通路",
};

const COVER_LABEL: Record<TacticalKnownFeature["cover"], string> = {
  none: "无掩护",
  half: "半掩护",
  threeQuarters: "四分之三掩护",
  full: "全掩护",
};

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

function polygonPoints(points: Array<{ x: string; y: string }>): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function featureMechanics(feature: TacticalKnownFeature): string[] {
  return [
    feature.impassable ? "阻挡移动" : "不阻挡移动",
    feature.opaque ? "阻挡视线" : "不阻挡视线",
    COVER_LABEL[feature.cover],
    feature.propagation === "blocks" ? "阻断区域传播" : "允许区域传播",
  ];
}

function entityMapLabel(entity: TacticalEntity): string {
  return entity.relation === "self" ? "我" : Array.from(entity.name).slice(0, 2).join("");
}

function TacticalEntityMark({
  entity,
  currentActor,
}: {
  entity: TacticalEntity;
  currentActor: boolean;
}) {
  const x = inches(entity.position.x);
  const y = inches(entity.position.y);
  const width = inches(entity.footprint.width);
  const depth = inches(entity.footprint.depth);
  const mapLabel = entityMapLabel(entity);
  const title = `${entity.name}${currentActor ? "；当前行动" : ""}；占位 ${entity.footprint.width}×${entity.footprint.depth} 英寸；高程 ${formatElevation(entity.position.elevation)}；高度 ${formatLength(entity.footprint.height)}`;
  return (
    <g
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
      className={RELATION_STYLE[entity.relation]}
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
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-white stroke-black/70 text-[28px] font-semibold [paint-order:stroke] [stroke-width:6px]"
      >
        {mapLabel}
      </text>
    </g>
  );
}

function TacticalFeatureShape({ feature }: { feature: TacticalKnownFeature }) {
  const mechanics = featureMechanics(feature);
  return (
    <g
      data-feature-id={feature.id}
      data-feature-kind={feature.kind}
      data-feature-state={feature.state}
      data-impassable={String(feature.impassable)}
      data-opaque={String(feature.opaque)}
      data-cover={feature.cover}
      data-propagation={feature.propagation}
      data-elevation-inches={feature.elevation}
      data-height-inches={feature.height}
      className={FEATURE_STYLE[feature.kind]}
    >
      <title>{`${feature.label}；状态 ${feature.state}；${mechanics.join("；")}；高程 ${formatElevation(feature.elevation)}；高度 ${formatLength(feature.height)}`}</title>
      <polygon
        points={polygonPoints(feature.polygon)}
        className="stroke-[8] [vector-effect:non-scaling-stroke]"
      />
    </g>
  );
}

function TacticalZoneShape({ zone }: { zone: TacticalZone }) {
  return (
    <g
      data-zone-id={zone.id}
      data-zone-state={zone.state}
      data-elevation-inches={zone.geometry.elevation}
      data-height-inches={zone.geometry.height}
      className={ZONE_STYLE}
    >
      <title>{`${zone.label}；状态 ${zone.state}；高程 ${formatElevation(zone.geometry.elevation)}；高度 ${formatLength(zone.geometry.height)}`}</title>
      <polygon
        points={polygonPoints(zone.geometry.points)}
        className="stroke-[6] [stroke-dasharray:18_12] [vector-effect:non-scaling-stroke]"
      />
    </g>
  );
}

export function TacticalMap({
  projection,
  defaultExpanded = false,
}: {
  projection: TacticalProjection | null | undefined;
  defaultExpanded?: boolean;
}) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(Boolean(projection) && defaultExpanded);
  const isExpanded = Boolean(projection) && expanded;

  return (
    <section
      data-tactical-map-disclosure={projection ? "ready" : "unknown"}
      aria-label="战术地图"
      className="min-w-0 max-w-full shrink-0 border-b border-border bg-bg/45"
    >
      <div className="flex min-w-0 items-center gap-3 px-4 py-2.5">
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={contentId}
          disabled={!projection}
          onClick={() => setExpanded((current) => !current)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-[12px] border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-70"
        >
          <span className="min-w-0">
            <span className="block font-display text-sm">二维战术地图</span>
            <span className="block truncate text-[11px] text-subtle">
              {projection ? projection.scene.name : "当前没有可显示的观察者投影"}
            </span>
          </span>
          <span className="shrink-0 text-xs text-brass">
            {projection ? (isExpanded ? "收起" : "展开") : "暂不可用"}
          </span>
        </button>
      </div>
      {!projection ? (
        <p className="break-words px-4 pb-2.5 text-xs text-muted [overflow-wrap:anywhere]">
          尚无观察者可见的战术地图数据；未投影的空间、实体与环境保持未知。
        </p>
      ) : null}
      <div id={contentId} hidden={!isExpanded}>
        {isExpanded && projection ? <TacticalMapExpanded projection={projection} /> : null}
      </div>
    </section>
  );
}

function TacticalMapExpanded({ projection }: { projection: TacticalProjection }) {
  const xs = projection.scene.boundary.points.map((point) => inches(point.x));
  const ys = projection.scene.boundary.points.map((point) => inches(point.y));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(projection.scene.gridInches, Math.max(...xs) - minX);
  const height = Math.max(projection.scene.gridInches, Math.max(...ys) - minY);
  const gridId = `tactical-grid-${projection.scene.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const entities = [projection.self, ...projection.visibleEntities];
  const activeEntity = projection.encounter?.activeEntityId
    ? entities.find((entity) => entity.id === projection.encounter?.activeEntityId)
    : undefined;
  const encounterReadout = projection.encounter === null
    ? "当前遭遇信息未知"
    : projection.encounter.status === "concluded"
      ? "遭遇已收束"
      : activeEntity === undefined
        ? "当前行动者未知"
        : `当前行动：${activeEntity.name}`;

  return (
    <section
      data-tactical-map="v1"
      className="flex max-h-[32dvh] min-w-0 max-w-full shrink-0 flex-col gap-3 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-3 lg:max-h-[45dvh]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-display text-base">{projection.scene.name}</p>
          <p className="text-[11px] text-subtle">
            观察者战术投影 · 每格 {formatLength(String(projection.scene.gridInches))}
          </p>
        </div>
        {projection.encounter ? (
          <p className="max-w-full break-words text-xs text-brass [overflow-wrap:anywhere]">
            遭遇第 {projection.encounter.round} 轮 · {encounterReadout}
          </p>
        ) : (
          <p className="text-xs text-subtle">{encounterReadout}</p>
        )}
      </div>

      <div className="min-w-0 max-w-full shrink-0 overflow-hidden rounded-[16px] border border-border bg-slate-950/90 p-2">
        <svg
          role="img"
          aria-label={`${projection.scene.name}战术地图`}
          width={width}
          height={height}
          viewBox={`${minX} ${minY} ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          className="block h-auto max-h-[20dvh] w-full max-w-full touch-manipulation sm:max-h-[28dvh] lg:max-h-[32dvh]"
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
                className="stroke-white/15 stroke-[2]"
              />
            </pattern>
          </defs>
          <polygon
            data-scene-boundary={projection.scene.id}
            points={polygonPoints(projection.scene.boundary.points)}
            fill={`url(#${gridId})`}
            className="stroke-brass/80 stroke-[8] [vector-effect:non-scaling-stroke]"
          />
          {projection.knownZones.map((zone) => (
            <TacticalZoneShape key={zone.id} zone={zone} />
          ))}
          {projection.knownFeatures.map((feature) => (
            <TacticalFeatureShape key={feature.id} feature={feature} />
          ))}
          {entities.map((entity) => (
            <TacticalEntityMark
              key={entity.id}
              entity={entity}
              currentActor={entity.id === projection.encounter?.activeEntityId}
            />
          ))}
        </svg>
      </div>

      <ul data-tactical-entities="v1" className="flex min-w-0 max-w-full flex-wrap gap-2 text-[11px] text-muted">
        {entities.map((entity) => (
          <li
            key={entity.id}
            data-current-actor={String(entity.id === projection.encounter?.activeEntityId)}
            className="min-w-0 max-w-full break-words rounded-[12px] border border-border px-2 py-1 [overflow-wrap:anywhere]"
          >
            <span className="font-medium text-fg">{entity.name}</span>
            {entity.id === projection.encounter?.activeEntityId ? (
              <span className="text-brass"> · 当前行动</span>
            ) : null}
            <span> · 当前位置 ({entity.position.x}, {entity.position.y})</span>
            <span> · 高程 {formatElevation(entity.position.elevation)}</span>
            <span> · 高度 {formatLength(entity.footprint.height)}</span>
          </li>
        ))}
      </ul>

      {projection.knownFeatures.length > 0 ? (
        <ul data-tactical-features="v1" className="grid min-w-0 max-w-full gap-1 text-[11px] text-muted sm:grid-cols-2">
          {projection.knownFeatures.map((feature) => (
            <li
              key={feature.id}
              className="min-w-0 max-w-full break-words rounded-[10px] border border-border px-2 py-1.5 [overflow-wrap:anywhere]"
            >
              <span className="font-medium text-fg">{feature.label}</span>
              <span> · {FEATURE_KIND_LABEL[feature.kind]} · 状态 {feature.state}</span>
              <span> · {featureMechanics(feature).join(" · ")}</span>
              {feature.terrain === "rubble" ? <span> · 碎石地</span> : null}
              {feature.durability ? (
                <span> · 耐久 {feature.durability.current}/{feature.durability.maximum}</span>
              ) : null}
              <span> · 高程 {formatElevation(feature.elevation)} · 高度 {formatLength(feature.height)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p data-tactical-features="unknown" className="text-xs text-subtle">
          尚无已知环境要素；未投影的障碍、门、地形与可互动物保持未知。
        </p>
      )}

      {projection.knownZones.length > 0 ? (
        <ul data-tactical-zones="v1" className="grid min-w-0 max-w-full gap-1 text-[11px] text-muted sm:grid-cols-2">
          {projection.knownZones.map((zone) => (
            <li
              key={zone.id}
              className="min-w-0 max-w-full break-words rounded-[10px] border border-violet-300/40 px-2 py-1.5 [overflow-wrap:anywhere]"
            >
              <span className="font-medium text-fg">{zone.label}</span>
              <span> · 区域效果 · 状态 {zone.state}</span>
              <span> · 高程 {formatElevation(zone.geometry.elevation)} · 高度 {formatLength(zone.geometry.height)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p data-tactical-zones="unknown" className="text-xs text-subtle">
          尚无已知区域效果；未投影的区域保持未知。
        </p>
      )}

      <section
        data-tactical-readout="v1"
        aria-label={`${projection.scene.name}文字战术读数`}
        tabIndex={0}
        className="min-w-0 max-w-full break-words rounded-[14px] border border-border bg-surface px-3 py-2 text-sm outline-none [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-brass"
      >
        <p className="font-medium">文字战术读数</p>
        <p className="mt-1 text-muted">{projection.textualReadout.summary}</p>
        {projection.textualReadout.entities.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            {projection.textualReadout.entities.map((entry) => <li key={entry}>{entry}</li>)}
          </ul>
        ) : null}
        {projection.textualReadout.features.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            {projection.textualReadout.features.map((entry) => <li key={entry}>{entry}</li>)}
          </ul>
        ) : null}
      </section>

      <p data-tactical-interactions="deferred" className="text-xs text-subtle">
        地图交互后续支持；当前地图只显示观察者投影，不提供拖拽移动、点选施法或精确预览。
      </p>
    </section>
  );
}
