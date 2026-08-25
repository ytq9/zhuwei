import type { InitialEntity } from "../rules/engine";
import type {
  AttackProfile,
  Command,
  Decision,
  PlayerProjection,
  SquadState,
  WorldEvent,
} from "../rules/model";
import type { RulesetVersion } from "../rules/ruleset";

export type InitializeRoomInput = {
  roomId: string;
  moduleId: string;
  rulesetVersion: RulesetVersion;
  players: InitialEntity[];
  squads?: SquadState[];
};

export type UpsertPlayerInput = { player: InitialEntity };

export type SynchronizePlayerLoadoutInput = {
  playerId: string;
  ac: number;
  attacks: AttackProfile[];
  capabilities: string[];
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
