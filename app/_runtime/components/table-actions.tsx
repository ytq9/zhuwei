"use client";

import type { TacticalMapActions } from "@/components/tactical-map-actions";
import {
  IDLE_TASK,
  NPC_TURN_LABEL,
  READY_EVENT_LABEL,
  abilityDetail,
  aimable,
  creaturePickable,
  inches,
  intentSentence,
  joinNames,
  mapGestures,
  mapPosition,
  playerEncounter,
  selfPoint,
  targetHint,
  taskPicksPoint,
  type ReadyPick,
} from "@/components/tactical-task";
import type { CombatAbilityTarget, TacticalProjection } from "@/lib/rules/tactical-projection";
import type { CombatControlAbility, NpcCombatTurnStatus } from "@/lib/table/authoritative";
import { cn } from "@/lib/utils";

export const ACTION_BUTTON = "min-h-9 rounded-[10px] border border-border bg-bg/40 px-3 py-1.5 text-xs text-fg transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-brass aria-pressed:bg-brass/15 aria-pressed:text-brass";
export const PRIMARY_BUTTON = "min-h-9 rounded-[10px] border border-brass/60 bg-brass/15 px-3 py-1.5 text-xs text-brass transition-colors hover:bg-brass/25 disabled:cursor-not-allowed disabled:opacity-50";

/** SPEC 0012 §8.1 (ADR 0099): the basic actions a Ready can hold besides the
 * actor's own action and attack abilities. */
const READYABLE_BASIC_ACTIONS: ReadonlySet<string> = new Set(["action:grapple", "action:shove", "action:shove-away"]);

const ABILITY_GROUP_LABEL: Record<CombatControlAbility["group"], string> = {
  attack: "武器与攻击",
  spell: "法术",
  feature: "职业能力",
  item: "物品",
  basic: "基础动作",
};

const COST_STYLE: Record<CombatControlAbility["activation"], string> = {
  action: "border-brass/50 text-brass",
  attack: "border-brass/50 text-brass",
  bonusAction: "border-moss text-fg",
  free: "border-transparent text-subtle",
};

const COST_LABEL: Record<CombatControlAbility["activation"], string> = {
  action: "动作",
  attack: "攻击",
  bonusAction: "附赠",
  free: "不占动作",
};

/** Who acts now, by the name the player can see. */
function activeName(projection: TacticalProjection): string {
  const activeEntityId = projection.encounter?.activeEntityId ?? null;
  if (activeEntityId === null) return "尚未确定";
  return [projection.self, ...projection.visibleEntities].find((entity) => entity.id === activeEntityId)?.name
    ?? "看不见的行动者";
}

/** The ways a pick ends, shared by the action list and the bar above the
 * composer (SPEC 0014 §§4、5, ADR 0091). On the player's own turn an ability
 * goes straight to Rules; outside an encounter it becomes the player's
 * sentence in the composer. */
function abilityCommands(projection: TacticalProjection, actions: TacticalMapActions) {
  const { task, setTask } = actions;
  const elevation = projection.self.position.elevation;
  const armedRef = task.kind === "creatures" || task.kind === "area" || task.kind === "intent"
    || task.kind === "help" || task.kind === "ready"
    ? task.ability.abilityRef
    : null;

  async function finish(result: Promise<boolean>) {
    if (await result) setTask(IDLE_TASK);
  }

  /** Uses the ability now, or, with a ready pick, readies it as the response
   * to that trigger. */
  function submitAbility(ability: CombatControlAbility, target: CombatAbilityTarget, ready?: ReadyPick) {
    void finish(ready === undefined
      ? actions.useAbility(ability.abilityRef, target)
      : actions.useAbility("action:ready", { kind: "ready", trigger: { ref: ready.triggerRef, event: ready.event },
          response: { kind: "ability", abilityRef: ability.abilityRef, target } }));
  }

  /** Starts or submits a combat ability; true when it now waits for a pick. */
  function chooseCombatAbility(ability: CombatControlAbility, ready?: ReadyPick): boolean {
    if (armedRef === ability.abilityRef && ready === undefined) {
      setTask(IDLE_TASK);
      return false;
    }
    const target = ability.target;
    if (target.kind === "none") submitAbility(ability, { kind: "none" }, ready);
    else if (target.kind === "self") submitAbility(ability, { kind: "creatures", refs: [projection.self.id] }, ready);
    else if (target.kind === "creatures") {
      setTask({ kind: "creatures", ability, refs: [], purpose: "combat", point: null, ...(ready ? { ready } : {}) });
      return true;
    } else if (target.kind === "help") {
      setTask({ kind: "help", ability, allyRef: null, mode: "check", enemyRef: null });
      return true;
    } else if (target.kind === "ready") {
      setTask({ kind: "ready", ability, triggerRef: null, event: null });
      return true;
    } else if (target.origin === "self" && !target.needsDirection) {
      submitAbility(ability, { kind: "area", origin: structuredClone(projection.self.position) }, ready);
    } else {
      setTask({ kind: "area", ability, origin: target.origin === "self" ? selfPoint(projection) : null, direction: null,
        ...(ready ? { ready } : {}) });
      return true;
    }
    return false;
  }

  /** Outside an encounter every ability is put together as a sentence. */
  function chooseIntentAbility(ability: CombatControlAbility): boolean {
    if (armedRef === ability.abilityRef) {
      setTask(IDLE_TASK);
      return false;
    }
    if (ability.target.kind === "creatures") setTask({ kind: "creatures", ability, refs: [], purpose: "intent" });
    else setTask({ kind: "intent", ability, aimRef: null });
    return true;
  }

  function areaTarget(): CombatAbilityTarget | null {
    if (task.kind !== "area" || task.ability.target.kind !== "area" || task.origin === null) return null;
    const shape = task.ability.target;
    if (shape.needsDirection && task.direction === null) return null;
    const origin = shape.origin === "self"
      ? structuredClone(projection.self.position)
      : mapPosition(task.origin, elevation);
    // SPEC 0014 §5: the page submits only the origin and a direction (the way
    // from the origin to the second point); Rules finds who is inside.
    return {
      kind: "area",
      origin,
      ...(shape.needsDirection && task.direction !== null
        ? {
            direction: {
              x: String(task.direction.x - Number(origin.x)),
              y: String(task.direction.y - Number(origin.y)),
              elevation: "0",
            },
          }
        : {}),
    };
  }

  return { armedRef, finish, submitAbility, chooseCombatAbility, chooseIntentAbility, areaTarget };
}

/** The ability buttons a Ready can hold as its response. */
function ReadyResponseButtons({
  abilities,
  disabled,
  onChoose,
}: {
  abilities: CombatControlAbility[];
  disabled: boolean;
  onChoose: (ability: CombatControlAbility) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {abilities.map((ability) => (
        <button
          key={ability.abilityRef}
          type="button"
          data-tactical-ready-response={ability.abilityRef}
          aria-label={`${ability.name}，${abilityDetail(ability)}`}
          title={targetHint(ability)}
          disabled={disabled}
          onClick={() => onChoose(ability)}
          className={cn(ACTION_BUTTON, "max-w-full break-words text-left")}
        >
          {ability.name}
          <span className="ml-1 text-[10px] text-subtle">{abilityDetail(ability)}</span>
        </button>
      ))}
    </div>
  );
}

/** SPEC 0010 §7, SPEC 0014 §4 (ADR 0091): everything the character can do
 * now, from one list Rules projected. On the player's own turn a choice goes
 * straight to Rules; outside an encounter it is put together as the player's
 * sentence in the composer, where the player can add to it before sending. */
export function ActionList({
  projection,
  actions,
  slots,
  onPicking,
}: {
  projection: TacticalProjection;
  actions: TacticalMapActions;
  /** The spell slots left at a level, as the character panel counts them. */
  slots?: (level: number) => { current: number; maximum: number } | undefined;
  /** A choice now waits for a pick on the map or in the bar. */
  onPicking?: () => void;
}) {
  const controls = actions.controls;
  const { inEncounter, myTurn } = playerEncounter(projection);
  const commands = abilityCommands(projection, actions);
  const abilities = inEncounter
    ? [...(controls?.abilities ?? []), ...(controls?.basicActions ?? [])]
    : controls?.abilities ?? [];
  const disabled = actions.busy || (inEncounter && !myTurn);
  const groups = (Object.keys(ABILITY_GROUP_LABEL) as CombatControlAbility["group"][])
    .map((group) => ({ group, entries: abilities.filter((ability) => ability.group === group) }))
    .filter((entry) => entry.entries.length > 0);
  const task = actions.task;
  // SPEC 0012 §8.1 (ADR 0099 decision 3): while a response is being picked for
  // a Ready, the Ready itself is the armed choice.
  const readyPick = task.kind === "path" || task.kind === "creatures" || task.kind === "area" ? task.ready : undefined;
  const armedRef = readyPick === undefined ? commands.armedRef : "action:ready";

  function choose(ability: CombatControlAbility) {
    const picking = inEncounter ? commands.chooseCombatAbility(ability) : commands.chooseIntentAbility(ability);
    if (picking) onPicking?.();
  }

  if (abilities.length === 0) {
    return <p className="text-xs text-subtle">现在没有可从这里使用的能力；可以直接用文字描述你的行动。</p>;
  }
  return (
    <section data-character-actions aria-label="可用行动" className="grid min-w-0 gap-3">
      <p className="text-[11px] leading-relaxed text-subtle" data-character-actions-mode={inEncounter ? "combat" : "intent"}>
        {inEncounter
          ? myTurn
            ? "轮到你：选择后直接结算，需要目标时在地图上或输入框上方选。"
            : `等待${activeName(projection)}行动，轮到你时再选。`
          : "选好能力和目标后，句子放进输入框，可以补充说法再发送。"}
      </p>
      {groups.map(({ group, entries }) => (
        <div key={group} role="group" aria-label={ABILITY_GROUP_LABEL[group]} data-tactical-ability-group={group} className="grid min-w-0 gap-1.5">
          <p className="text-xs font-medium text-muted">{ABILITY_GROUP_LABEL[group]}</p>
          {group === "basic" ? (
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {entries.map((ability) => (
                <button
                  key={ability.abilityRef}
                  type="button"
                  data-tactical-ability={ability.abilityRef}
                  aria-pressed={armedRef === ability.abilityRef}
                  aria-label={`${ability.name}，${abilityDetail(ability)}`}
                  title={targetHint(ability)}
                  disabled={disabled}
                  onClick={() => choose(ability)}
                  className={ACTION_BUTTON}
                >
                  {ability.name}
                </button>
              ))}
            </div>
          ) : (
            <ul className="grid min-w-0 gap-1.5">
              {entries.map((ability) => {
                const slot = ability.slotLevel === undefined ? undefined : slots?.(ability.slotLevel);
                return (
                  <li key={ability.abilityRef}>
                    <button
                      type="button"
                      data-tactical-ability={ability.abilityRef}
                      aria-pressed={armedRef === ability.abilityRef}
                      aria-label={`${ability.name}，${abilityDetail(ability)}`}
                      disabled={disabled}
                      onClick={() => choose(ability)}
                      className="flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-[10px] border border-border bg-bg/40 px-3 py-2 text-left transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-brass aria-pressed:bg-brass/15"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm text-fg">{ability.name}</span>
                        <span className="block text-[11px] text-subtle">{targetHint(ability)}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1 text-[11px]">
                        <span className={cn("rounded-full border px-1.5 py-0.5", COST_STYLE[ability.activation])}>
                          {COST_LABEL[ability.activation]}
                        </span>
                        {ability.spellLevel === 0 ? <span className="text-subtle">戏法</span> : null}
                        {ability.slotLevel !== undefined ? (
                          <span className="tabular-nums text-subtle">
                            {ability.slotLevel} 环{slot ? ` · 剩 ${slot.current}/${slot.maximum}` : ""}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

/** SPEC 0014 §4 (ADR 0091): the round and whose turn it is, what the player
 * has left this turn, moving and ending the turn, above the composer. */
export function TurnBar({
  projection,
  actions,
  npcTurn,
}: {
  projection: TacticalProjection;
  actions: TacticalMapActions;
  npcTurn?: NpcCombatTurnStatus;
}) {
  const { task, setTask } = actions;
  const { myTurn } = playerEncounter(projection);
  const commands = abilityCommands(projection, actions);
  const controls = actions.controls;
  const turn = controls?.turn ?? null;
  const movement = controls?.movement ?? null;
  const combatDisabled = actions.busy || !myTurn;
  const activeEntityId = projection.encounter?.activeEntityId ?? null;
  const npcState = npcTurn !== undefined && npcTurn.npcRef === activeEntityId ? `（${NPC_TURN_LABEL[npcTurn.state]}）` : "";
  const grants = [
    ...(turn ? [`动作 ${turn.action}`, `附赠动作 ${turn.bonusAction}`, `反应 ${turn.reaction}`] : []),
    ...(turn && turn.attacksRemaining > 0 ? [`本次攻击动作还能攻击 ${turn.attacksRemaining} 次`] : []),
    ...(movement ? [`剩余移动 ${movement.remainingFeet} 尺（速度 ${movement.speedFeet} 尺）`] : []),
  ];
  const pip = (label: string, count: number) => (
    <span className="inline-flex items-center gap-1">
      {label}
      <span className={cn("size-2 rounded-full border", count > 0 ? "border-brass bg-brass" : "border-subtle")} />
    </span>
  );
  return (
    <section
      aria-label="回合"
      data-tactical-turn-bar
      data-tactical-my-turn={String(myTurn)}
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-bg/35 px-4 py-2 text-xs"
    >
      <p role="status" aria-live="polite" className="min-w-0 font-display text-sm text-fg">
        {myTurn
          ? `第 ${projection.encounter?.round ?? 0} 轮 · 轮到你`
          : `当前行动：${activeName(projection)}${npcState}。轮到你时再行动。`}
      </p>
      {grants.length > 0 ? (
        <span data-tactical-turn-grants aria-label={grants.join(" · ")} className="flex flex-wrap items-center gap-3 text-muted">
          {turn ? (
            <>
              {pip("动作", turn.action)}
              {pip("附赠", turn.bonusAction)}
              {pip("反应", turn.reaction)}
              {turn.attacksRemaining > 0 ? <span>还能攻击 {turn.attacksRemaining} 次</span> : null}
            </>
          ) : null}
          {movement ? (
            <span className="tabular-nums">移动 <span className="text-fg">{movement.remainingFeet}</span>/{movement.speedFeet} 尺</span>
          ) : null}
        </span>
      ) : null}
      {controls?.hidden ? (
        <span data-tactical-hidden className="text-brass">你正躲藏着：对方看不见你，攻击或被发现时暴露。</span>
      ) : null}
      <span className="ml-auto flex shrink-0 gap-1.5">
        <button
          type="button"
          data-tactical-move-mode
          aria-pressed={task.kind === "path"}
          disabled={combatDisabled}
          onClick={() => setTask(task.kind === "path" ? IDLE_TASK : { kind: "path", waypoints: [] })}
          className={ACTION_BUTTON}
        >
          移动
        </button>
        <button
          type="button"
          data-tactical-end-turn
          disabled={combatDisabled}
          onClick={() => void commands.finish(actions.endTurn())}
          className={PRIMARY_BUTTON}
        >
          结束回合
        </button>
      </span>
    </section>
  );
}

/** SPEC 0014 §§4、5、8: the pick in progress and its confirmation, above the
 * composer and under the narrow-screen map. Every pick can be made from the
 * name lists here, so the text readout keeps a full way to act. */
export function TaskBar({
  projection,
  actions,
  onOpenMap,
}: {
  projection: TacticalProjection;
  actions: TacticalMapActions;
  /** Opens the map on a narrow screen for a pick only the map can make. */
  onOpenMap?: () => void;
}) {
  const { task, setTask } = actions;
  const { myTurn } = playerEncounter(projection);
  const controls = actions.controls;
  const entities = [projection.self, ...projection.visibleEntities];
  const elevation = projection.self.position.elevation;
  const busy = actions.busy;
  const combatDisabled = busy || !myTurn;
  const commands = abilityCommands(projection, actions);
  // The bar has no map selection of its own; a name picked here marks the
  // target on the map through the shared pick.
  const gestures = mapGestures(projection, actions, () => {});
  const nameOf = (id: string) => id === projection.self.id
    ? "自己"
    : entities.find((entity) => entity.id === id)?.name ?? "目标";
  // SPEC 0012 §8.1 (ADR 0099 decision 3): the trigger a pick is readied for.
  const readyChosen: ReadyPick | undefined = task.kind === "ready" && task.triggerRef !== null && task.event !== null
    ? { triggerRef: task.triggerRef, event: task.event } : undefined;
  const area = commands.areaTarget();
  const intent = task.kind === "creatures" && task.purpose === "intent"
    ? { sentence: intentSentence(task.ability, task.refs.map(nameOf)), ready: task.refs.length > 0 }
    : task.kind === "intent"
      ? { sentence: intentSentence(task.ability, task.aimRef ? [nameOf(task.aimRef)] : []), ready: true }
      : task.kind === "climb" || task.kind === "goTo" ? { sentence: task.sentence, ready: true } : null;
  const needsMap = task.kind === "path" || (task.kind === "area" && taskPicksPoint(task))
    || (task.kind === "creatures" && task.purpose === "combat" && aimable(task.ability));

  if (task.kind === "idle" && !busy && !actions.error) return null;
  return (
    <section
      aria-label="正在进行的选择"
      data-tactical-task-bar={task.kind}
      className="min-w-0 shrink-0 space-y-2 break-words border-t border-border bg-bg/35 px-4 py-3 text-xs [overflow-wrap:anywhere]"
    >
      {needsMap && onOpenMap ? (
        <button type="button" data-tactical-open-map onClick={onOpenMap} className={cn(ACTION_BUTTON, "lg:hidden")}>
          在地图上选
        </button>
      ) : null}

      {task.kind === "destination" ? (
        <div data-tactical-destination-picker className="flex flex-wrap items-center gap-1.5">
          <span className="text-fg">目的地已在地图上用虚线方框标出。</span>
          <button
            type="button"
            data-tactical-destination-submit
            disabled={busy}
            onClick={() => void commands.finish(actions.moveTo({
              kind: "point",
              x: String(task.point.x),
              y: String(task.point.y),
            }))}
            className={PRIMARY_BUTTON}
          >
            走到这里
          </button>
          <button type="button" onClick={() => setTask(IDLE_TASK)} className={ACTION_BUTTON}>取消</button>
        </div>
      ) : null}

      {task.kind === "path" ? (
        <div data-tactical-path-picker className="space-y-2">
          <p className="text-muted">
            {task.ready ? `预备：${nameOf(task.ready.triggerRef)}${READY_EVENT_LABEL[task.ready.event]}，用反应走这条路。` : ""}
            {`从你所在处出发，依次点地图放下路径点（已放 ${task.waypoints.length} 个）。也可用方向键移动选点框，按回车放点。`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-tactical-path-submit
              disabled={combatDisabled || task.waypoints.length === 0}
              onClick={() => {
                const path = [
                  structuredClone(projection.self.position),
                  ...task.waypoints.map((point) => mapPosition(point, elevation)),
                ];
                void commands.finish(task.ready === undefined
                  ? actions.walkPath(path)
                  : actions.useAbility("action:ready", { kind: "ready",
                      trigger: { ref: task.ready.triggerRef, event: task.ready.event }, response: { kind: "move", path } }));
              }}
              className={PRIMARY_BUTTON}
            >
              {task.ready ? "确认预备" : "确认移动"}
            </button>
            <button
              type="button"
              disabled={task.waypoints.length === 0}
              onClick={() => setTask({ ...task, waypoints: task.waypoints.slice(0, -1) })}
              className={ACTION_BUTTON}
            >
              撤回一点
            </button>
            <button
              type="button"
              data-tactical-path-clear
              onClick={() => setTask({ kind: "path", waypoints: [], ...(task.ready ? { ready: task.ready } : {}) })}
              className={ACTION_BUTTON}
            >
              清除
            </button>
            <button type="button" onClick={() => setTask(IDLE_TASK)} className={ACTION_BUTTON}>取消</button>
          </div>
        </div>
      ) : null}

      {task.kind === "help" && task.ability.target.kind === "help" ? (
        <div data-tactical-help-picker className="space-y-2">
          <p className="text-muted">帮助：选一名同伴。它下一次属性检定有优势；或选你身边 5 尺内的一个敌人，同伴在你下回合开始前第一次攻击它时有优势。</p>
          <div className="flex flex-wrap gap-1.5">
            {task.ability.target.allyRefs.map((ref) => (
              <button
                key={ref}
                type="button"
                data-tactical-help-ally={ref}
                aria-pressed={task.allyRef === ref}
                onClick={() => setTask({ ...task, allyRef: ref })}
                className={ACTION_BUTTON}
              >
                {nameOf(ref)}
              </button>
            ))}
          </div>
          <div role="radiogroup" aria-label="帮助方式" className="flex flex-wrap gap-1.5">
            <button
              type="button"
              role="radio"
              data-tactical-help-mode="check"
              aria-checked={task.mode === "check"}
              onClick={() => setTask({ ...task, mode: "check", enemyRef: null })}
              className={ACTION_BUTTON}
            >
              下一次检定
            </button>
            <button
              type="button"
              role="radio"
              data-tactical-help-mode="attack"
              aria-checked={task.mode === "attack"}
              disabled={task.ability.target.enemyRefs.length === 0}
              onClick={() => setTask({ ...task, mode: "attack" })}
              className={ACTION_BUTTON}
            >
              攻击身边的敌人
            </button>
          </div>
          {task.mode === "attack" ? (
            <div className="flex flex-wrap gap-1.5">
              {task.ability.target.enemyRefs.map((ref) => (
                <button
                  key={ref}
                  type="button"
                  data-tactical-help-enemy={ref}
                  aria-pressed={task.enemyRef === ref}
                  onClick={() => setTask({ ...task, enemyRef: ref })}
                  className={ACTION_BUTTON}
                >
                  {nameOf(ref)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-tactical-help-submit
              disabled={combatDisabled || task.allyRef === null || (task.mode === "attack" && task.enemyRef === null)}
              onClick={() => {
                if (task.allyRef === null) return;
                void commands.finish(actions.useAbility(task.ability.abilityRef, task.mode === "attack" && task.enemyRef !== null
                  ? { kind: "help", allyRef: task.allyRef, enemyRef: task.enemyRef }
                  : { kind: "help", allyRef: task.allyRef }));
              }}
              className={PRIMARY_BUTTON}
            >
              确认
            </button>
            <button type="button" onClick={() => setTask(IDLE_TASK)} className={ACTION_BUTTON}>取消</button>
          </div>
        </div>
      ) : null}

      {task.kind === "ready" && task.ability.target.kind === "ready" ? (
        <div data-tactical-ready-picker className="space-y-2">
          <p className="text-muted">预备：先选触发的人和时机，再选那时要做的事——走一条路，或下面的一项能力。触发时会问你用不用反应执行。</p>
          <div className="flex flex-wrap gap-1.5">
            {task.ability.target.triggerRefs.map((ref) => (
              <button
                key={ref}
                type="button"
                data-tactical-ready-trigger={ref}
                aria-pressed={task.triggerRef === ref}
                onClick={() => setTask({ ...task, triggerRef: ref })}
                className={ACTION_BUTTON}
              >
                {nameOf(ref)}
              </button>
            ))}
          </div>
          <div role="radiogroup" aria-label="触发时机" className="flex flex-wrap gap-1.5">
            {task.ability.target.events.map((event) => (
              <button
                key={event}
                type="button"
                role="radio"
                data-tactical-ready-event={event}
                aria-checked={task.event === event}
                onClick={() => setTask({ ...task, event })}
                className={ACTION_BUTTON}
              >
                {READY_EVENT_LABEL[event]}
              </button>
            ))}
          </div>
          {readyChosen ? (
            <div className="space-y-2">
              <p className="text-fg">那时要做：</p>
              <button
                type="button"
                data-tactical-ready-move
                disabled={combatDisabled}
                onClick={() => setTask({ kind: "path", waypoints: [], ready: readyChosen })}
                className={ACTION_BUTTON}
              >
                走一条路
              </button>
              <ReadyResponseButtons
                abilities={[
                  ...(controls?.abilities ?? []).filter((ability) => ability.activation === "action" || ability.activation === "attack"),
                  // A grapple or shove can be readied too; its defender picks its skill when it resolves.
                  ...(controls?.basicActions ?? []).filter((ability) => READYABLE_BASIC_ACTIONS.has(ability.abilityRef)),
                ]}
                disabled={combatDisabled}
                onChoose={(ability) => { commands.chooseCombatAbility(ability, readyChosen); }}
              />
            </div>
          ) : null}
          <button type="button" onClick={() => setTask(IDLE_TASK)} className={ACTION_BUTTON}>取消</button>
        </div>
      ) : null}

      {task.kind === "creatures" ? (
        <div data-tactical-target-picker={task.purpose} className="space-y-2">
          <p className="text-muted">
            {task.ready ? `预备：${nameOf(task.ready.triggerRef)}${READY_EVENT_LABEL[task.ready.event]}，用反应——` : ""}
            {task.ability.name}：{targetHint(task.ability)}。在地图上点选，或从下面选择。
            {task.ability.target.kind === "creatures" && task.ability.target.npcOpponentsOnly
              ? "只能对非玩家角色使用；对其他玩家请用文字说明你的行动。"
              : ""}
            {gestures.aimPick ? "看不见的目标：点地图空地，朝你猜的位置攻击（劣势，猜错则落空）。" : ""}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {entities.filter((entity) => creaturePickable(task.ability, entity)).map((entity) => (
              <button
                key={entity.id}
                type="button"
                data-tactical-target-option={entity.id}
                aria-pressed={task.refs.includes(entity.id)}
                onClick={() => gestures.activateEntity(entity)}
                className={ACTION_BUTTON}
              >
                {nameOf(entity.id)}
              </button>
            ))}
          </div>
          <p className="text-fg">
            已选：{task.refs.length > 0 ? joinNames(task.refs.map(nameOf))
              : task.point ? `地图上一处（${task.point.x}, ${task.point.y}）` : "尚未选择"}
          </p>
          {task.purpose === "combat" ? (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                data-tactical-target-submit
                disabled={combatDisabled || (task.refs.length === 0 && !task.point)}
                onClick={() => commands.submitAbility(task.ability, task.refs.length === 0 && task.point
                  ? { kind: "point", position: mapPosition(task.point, elevation) }
                  : { kind: "creatures", refs: [...task.refs] }, task.ready)}
                className={PRIMARY_BUTTON}
              >
                确认
              </button>
              <button type="button" onClick={() => setTask(IDLE_TASK)} className={ACTION_BUTTON}>取消</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {task.kind === "area" ? (
        <div data-tactical-area-picker className="space-y-2">
          <p className="text-muted">{task.ability.name}：{targetHint(task.ability)}。</p>
          <p className="text-fg">
            {task.origin === null
              ? "在地图上点选位置，或从下面选一个人所在处。"
              : task.ability.target.kind === "area" && task.ability.target.needsDirection && task.direction === null
                ? "再点地图上一处，或从下面选一个人，定出朝向。"
                : "已选好。范围内有谁由规则结算。"}
          </p>
          {taskPicksPoint(task) ? (
            <div className="flex flex-wrap gap-1.5">
              {entities.map((entity) => (
                <button
                  key={entity.id}
                  type="button"
                  data-tactical-area-option={entity.id}
                  onClick={() => gestures.pickPoint({ x: inches(entity.position.x), y: inches(entity.position.y) })}
                  className={ACTION_BUTTON}
                >
                  {nameOf(entity.id)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-tactical-area-submit
              disabled={combatDisabled || area === null}
              onClick={() => {
                if (area !== null) commands.submitAbility(task.ability, area, task.ready);
              }}
              className={PRIMARY_BUTTON}
            >
              确认
            </button>
            <button
              type="button"
              onClick={() => setTask({
                ...task,
                origin: task.ability.target.kind === "area" && task.ability.target.origin === "self" ? selfPoint(projection) : null,
                direction: null,
              })}
              className={ACTION_BUTTON}
            >
              重选
            </button>
            <button type="button" onClick={() => setTask(IDLE_TASK)} className={ACTION_BUTTON}>取消</button>
          </div>
        </div>
      ) : null}

      {task.kind === "intent" && task.ability.target.kind === "area" && task.ability.target.origin === "point" ? (
        <div data-tactical-aim-picker className="space-y-2">
          <p className="text-muted">{task.ability.name}：可以在地图上或下面选一个人，说明朝谁施放。</p>
          <div className="flex flex-wrap gap-1.5">
            {projection.visibleEntities.map((entity) => (
              <button
                key={entity.id}
                type="button"
                data-tactical-aim-option={entity.id}
                aria-pressed={task.aimRef === entity.id}
                onClick={() => gestures.activateEntity(entity)}
                className={ACTION_BUTTON}
              >
                {entity.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {intent ? (
        <div data-tactical-intent-preview className="space-y-2">
          <p className="text-fg">放进输入框的句子：{intent.ready ? intent.sentence : "请先选择目标。"}</p>
          {task.kind === "goTo" && !task.passable ? (
            <p data-tactical-go-to-closed className="text-brass">这扇门现在关着；能不能打开由 KP 裁定。</p>
          ) : null}
          {actions.intentUnavailable ? <p className="text-subtle">{actions.intentUnavailable}</p> : null}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-tactical-intent-submit
              disabled={busy || !intent.ready || actions.intentUnavailable !== undefined}
              onClick={() => {
                setTask(IDLE_TASK);
                actions.draftIntent(intent.sentence);
              }}
              className={PRIMARY_BUTTON}
            >
              放进输入框
            </button>
            <button type="button" onClick={() => setTask(IDLE_TASK)} className={ACTION_BUTTON}>取消</button>
          </div>
        </div>
      ) : null}

      {busy ? <p role="status" className="text-brass">正在提交……</p> : null}
      {actions.error ? (
        <div role="alert" data-tactical-action-error className="flex flex-wrap items-start gap-2 rounded-[12px] border border-danger/40 bg-danger/10 p-2">
          <p className="min-w-0 flex-1 text-fg">{actions.error}</p>
          <button type="button" onClick={actions.dismissError} className={ACTION_BUTTON}>知道了</button>
        </div>
      ) : null}
    </section>
  );
}
