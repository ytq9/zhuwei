import type { LegacyInitialEntity } from "../rules/legacy-adapter";
import type {
  AttackProfile,
  Command,
  Decision,
  PlayerProjection,
  SquadState,
  WorldEvent,
} from "../rules/model";
import type { Ability, RulesetVersion } from "../rules/ruleset";
import type { SpellcastingProfile } from "../rules/spell-model";

export type InitializeRoomInput = {
  roomId: string;
  moduleId: string;
  rulesetVersion: RulesetVersion;
  players: LegacyInitialEntity[];
  squads?: SquadState[];
};

export type UpsertPlayerInput = { player: LegacyInitialEntity };

export type SynchronizePlayerLoadoutInput = {
  playerId: string;
  ac: number;
  attacks: AttackProfile[];
  capabilities: string[];
  proficientSaves?: Ability[];
  creatureType?: string;
  conditionImmunities?: string[];
  spellLevels?: Record<string, number>;
  spellActionCosts?: Record<string, "action" | "bonusAction" | "reaction">;
  spellcasting?: Record<string, SpellcastingProfile>;
};

export type PrepareTurnInput = {
  actorId: string;
  nowMs?: number;
};

export type TurnTicket = {
  id: string;
  actorId: string;
  stateVersion: number;
  scopeVersions: Record<string, number>;
  expiresAt: number;
  projection: PlayerProjection;
};

export type CommitTurnInput = {
  ticketId: string;
  command: Command;
  nowMs?: number;
};

export type CommitTurnResult = {
  decision: Decision;
  stateVersion: number;
  projection?: PlayerProjection;
  idempotent: boolean;
  conflictedScope?: string;
};

export type RoomSnapshot = {
  roomId: string;
  moduleId: string;
  rulesetVersion: RulesetVersion;
  projection: PlayerProjection;
  ux: Array<{
    scopeId: string;
    phase: "interpreting" | "awaitingRoll" | "narrating";
    expiresAt: number;
  }>;
};

export type StoredRoomEvent = Pick<
  WorldEvent,
  "id" | "commandId" | "version" | "atSeconds" | "type"
> & { event: WorldEvent };
