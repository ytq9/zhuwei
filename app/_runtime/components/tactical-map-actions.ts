import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { combatAbility, endTurn, moveOnMap } from "@/lib/table/client";
import { tableActionAccepted, type TableActionResponse } from "@/lib/table/authoritative-client";
import type { CombatControls } from "@/lib/table/authoritative";
import type {
  CombatAbilityTarget,
  MapMoveDestination,
  TacticalPosition,
  TacticalProjection,
} from "@/lib/rules/tactical-projection";
import { IDLE_TASK, type MapPoint, type MapTask, type TacticalTaskControl } from "@/components/tactical-task";

/** What the map, the character panel's action list and the bar above the
 * composer may ask the table to do (SPEC 0014 §§3、4、8, ADR 0091), and the
 * pick in progress they share. Moves, the end of a turn and abilities used on
 * the actor's own turn go straight to Rules; an ability picked outside an
 * encounter becomes the player's sentence in the composer. */
export type TacticalMapActions = TacticalTaskControl & {
  controls: CombatControls | null;
  busy: boolean;
  error: string | null;
  /** Why a sentence cannot be put in the composer now, if it cannot. */
  intentUnavailable?: string;
  moveTo(destination: MapMoveDestination): Promise<boolean>;
  walkPath(path: TacticalPosition[]): Promise<boolean>;
  useAbility(abilityRef: string, target: CombatAbilityTarget): Promise<boolean>;
  endTurn(): Promise<boolean>;
  /** Puts the player's sentence in the composer, to add to and send. */
  draftIntent(sentence: string): void;
  dismissError(): void;
};

export function useTacticalMapActions(input: {
  code: string;
  projection: TacticalProjection | null;
  controls: CombatControls | null;
  sending: boolean;
  intentUnavailable?: string;
  draftIntent(sentence: string): void;
}): TacticalMapActions {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  // A pick started on one turn never carries into the next one.
  const encounter = input.projection?.encounter;
  const turnKey = encounter
    ? `${encounter.id}:${encounter.round}:${encounter.activeEntityId ?? ""}`
    : "exploration";
  const [taskState, setTaskState] = useState<{ key: string; task: MapTask }>({ key: turnKey, task: IDLE_TASK });
  const task = taskState.key === turnKey ? taskState.task : IDLE_TASK;
  const [cursor, setCursor] = useState<MapPoint | null>(null);
  const setTask = (next: MapTask) => {
    setTaskState({ key: turnKey, task: next });
    // The keyboard cursor starts again from the player for a new kind of pick.
    const family = (candidate: MapTask) => candidate.kind === "destination" ? "idle" : candidate.kind;
    if (family(next) !== family(task)) setCursor(null);
  };

  async function submit(
    call: (spatialRevision: string) => Promise<TableActionResponse>,
    failure: string,
  ): Promise<boolean> {
    // A submission names the spatial revision the player chose against; Rules
    // rejects it when the public space changed in between.
    const projection = input.projection;
    if (busyRef.current || input.sending || projection === null) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await call(projection.spatialRevision);
      void queryClient.invalidateQueries({ queryKey: ["table", input.code] });
      if (tableActionAccepted(result)) return true;
      setError(typeof result.error === "string" && result.error.trim() ? result.error : failure);
      return false;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return {
    controls: input.controls,
    busy: busy || input.sending,
    error,
    ...(input.intentUnavailable === undefined ? {} : { intentUnavailable: input.intentUnavailable }),
    task,
    setTask,
    cursor,
    setCursor,
    moveTo: (destination) => submit(
      (spatialRevision) => moveOnMap({ data: { code: input.code, spatialRevision, destination } }),
      "没能走过去",
    ),
    walkPath: (path) => submit(
      (spatialRevision) => moveOnMap({ data: { code: input.code, spatialRevision, path } }),
      "没能完成这段移动",
    ),
    useAbility: (abilityRef, target) => submit(
      (spatialRevision) => combatAbility({ data: { code: input.code, spatialRevision, abilityRef, target } }),
      "没能完成这个动作",
    ),
    endTurn: () => submit(() => endTurn({ data: { code: input.code } }), "没能结束回合"),
    draftIntent: input.draftIntent,
    dismissError: () => setError(null),
  };
}
