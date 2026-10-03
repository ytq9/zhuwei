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

/** What the tactical map may ask the table to do (SPEC 0014 §§3、4、8, ADR
 * 0091). Moves, the end of a turn and abilities used on the actor's own turn
 * go straight to Rules; an ability picked outside an encounter becomes a
 * player intent sentence for the KP. */
export type TacticalMapActions = {
  controls: CombatControls | null;
  busy: boolean;
  error: string | null;
  /** Why an intent sentence cannot be sent now, if it cannot. */
  intentUnavailable?: string;
  moveTo(destination: MapMoveDestination): Promise<boolean>;
  walkPath(path: TacticalPosition[]): Promise<boolean>;
  useAbility(abilityRef: string, target: CombatAbilityTarget): Promise<boolean>;
  endTurn(): Promise<boolean>;
  sendIntent(sentence: string): Promise<void>;
  dismissError(): void;
};

export function useTacticalMapActions(input: {
  code: string;
  projection: TacticalProjection | null;
  controls: CombatControls | null;
  sending: boolean;
  intentUnavailable?: string;
  sendIntent(sentence: string): Promise<void>;
}): TacticalMapActions {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

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
    sendIntent: input.sendIntent,
    dismissError: () => setError(null),
  };
}
