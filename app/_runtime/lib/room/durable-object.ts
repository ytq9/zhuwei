import { DurableObject } from "cloudflare:workers";

import { findModule } from "../module";
import {
  applyEvents,
  createWorldState,
  project,
  step,
  type InitialEntity,
} from "../rules/engine";
import type { Command, Decision, WorldEvent, WorldState } from "../rules/model";
import { RULESET_VERSION } from "../rules/ruleset";
import {
  TURN_TICKET_TTL_MS,
  UX_LEASE_TTL_MS,
  advanceScopeVersions,
  commandScopes,
  scopeConflict,
} from "./coordinator";
import type {
  CommitTurnInput,
  CommitTurnResult,
  InitializeRoomInput,
  PrepareTurnInput,
  RoomSnapshot,
  StoredRoomEvent,
  SynchronizePlayerLoadoutInput,
  TurnTicket,
  UpsertPlayerInput,
} from "./types";

type RoomRow = {
  room_id: string;
  module_id: string;
  ruleset_version: string;
  state_json: string;
  scope_versions_json: string;
};

type TicketRow = {
  id: string;
  actor_id: string;
  state_version: number;
  scope_versions_json: string;
  projection_json: string;
  status: string;
  expires_at: number;
};

type UnstampedWorldEvent = WorldEvent extends infer Event
  ? Event extends WorldEvent
    ? Omit<Event, "id" | "commandId" | "version" | "atSeconds">
    : never
  : never;

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function staleDecision(commandId: string, message: string): Decision {
  return {
    kind: "rejected",
    rejection: { code: "stale_state", message },
    decisionId: `decision:${commandId}`,
    commandId,
  };
}

export class RoomDurableObject extends DurableObject<Env> {
  private readonly bindings: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.bindings = env;
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          room_id TEXT NOT NULL UNIQUE,
          module_id TEXT NOT NULL,
          ruleset_version TEXT NOT NULL,
          state_json TEXT NOT NULL,
          scope_versions_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS world_events (
          version INTEGER PRIMARY KEY,
          event_id TEXT NOT NULL UNIQUE,
          command_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          fiction_seconds INTEGER NOT NULL,
          event_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS world_events_command_idx
          ON world_events(command_id, version);
        CREATE TABLE IF NOT EXISTS commands (
          command_id TEXT PRIMARY KEY,
          result_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS turn_tickets (
          id TEXT PRIMARY KEY,
          actor_id TEXT NOT NULL,
          state_version INTEGER NOT NULL,
          scope_versions_json TEXT NOT NULL,
          projection_json TEXT NOT NULL,
          status TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS turn_tickets_expiry_idx
          ON turn_tickets(status, expires_at);
        CREATE TABLE IF NOT EXISTS ux_status (
          scope_id TEXT PRIMARY KEY,
          phase TEXT NOT NULL,
          ticket_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ux_status_expiry_idx
          ON ux_status(expires_at);
      `);
    });
  }

  private roomRow(): RoomRow {
    const row = this.ctx.storage.sql
      .exec<RoomRow>(
        `SELECT room_id, module_id, ruleset_version, state_json, scope_versions_json
         FROM room_state WHERE singleton = 1`,
      )
      .toArray()[0];
    if (!row) throw new Error("房间尚未初始化");
    return row;
  }

  private definition(moduleId: string) {
    const mod = findModule(moduleId);
    if (!mod) throw new Error(`未知模组：${moduleId}`);
    return mod;
  }

  private cleanupExpired(nowMs: number) {
    this.ctx.storage.sql.exec(
      "UPDATE turn_tickets SET status = 'expired' WHERE status = 'open' AND expires_at <= ?",
      nowMs,
    );
    this.ctx.storage.sql.exec("DELETE FROM ux_status WHERE expires_at <= ?", nowMs);
  }

  private async scheduleExpiryAlarm() {
    const row = this.ctx.storage.sql
      .exec<{ expires_at: number | null }>(`
        SELECT MIN(expires_at) AS expires_at FROM (
          SELECT expires_at FROM turn_tickets WHERE status = 'open'
          UNION ALL
          SELECT expires_at FROM ux_status
        )
      `)
      .toArray()[0];
    if (row?.expires_at) await this.ctx.storage.setAlarm(row.expires_at);
    else await this.ctx.storage.deleteAlarm();
  }

  private async archiveEvents(roomId: string, events: WorldEvent[]) {
    const db = (this.bindings as unknown as { DB?: D1Database }).DB;
    if (!db || !events.length) return;
    await db.batch(
      events.map((event) =>
        db.prepare(
          `INSERT OR IGNORE INTO room_event_archive (
             room_id, version, event_id, command_id, event_type, fiction_seconds, event_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          roomId,
          event.version,
          event.id,
          event.commandId,
          event.type,
          event.atSeconds,
          JSON.stringify(event),
        ),
      ),
    );
  }

  private async archiveAllRoomEvents() {
    const row = this.roomRow();
    await this.archiveEvents(
      row.room_id,
      this.getEvents().map((entry) => entry.event),
    );
  }

  async initialize(input: InitializeRoomInput) {
    const mod = this.definition(input.moduleId);
    if (input.rulesetVersion !== RULESET_VERSION || mod.rulesetVersion !== RULESET_VERSION) {
      throw new Error(`房间必须锁定 ${RULESET_VERSION}`);
    }
    const result = this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<RoomRow>(
          `SELECT room_id, module_id, ruleset_version, state_json, scope_versions_json
           FROM room_state WHERE singleton = 1`,
        )
        .toArray()[0];
      if (existing) {
        if (
          existing.room_id !== input.roomId ||
          existing.module_id !== input.moduleId ||
          existing.ruleset_version !== input.rulesetVersion
        ) {
          throw new Error("同一个 Room Durable Object 不能重新绑定到另一房间或规则集");
        }
        return { created: false, stateVersion: parseJson<WorldState>(existing.state_json).version };
      }
      const playerIds = new Set(input.players.map((entry) => entry.id));
      const npcEntities: InitialEntity[] = mod.npcs
        .filter((npc) => !playerIds.has(npc.id))
        .map((npc) => {
          const scene = mod.chapters
            .flatMap((chapter) => chapter.scenes)
            .find((candidate) => candidate.npcs.includes(npc.id));
          const attack = /([+-]\d+)\s+(\d+)d(\d+)([+-]\d+)?/i.exec(npc.stats);
          return {
            id: npc.id,
            kind: "npc",
            name: npc.name,
            ac: Number(/AC\s*(\d+)/i.exec(npc.stats)?.[1] ?? 10),
            hp: {
              current: Number(/HP\s*(\d+)/i.exec(npc.stats)?.[1] ?? 1),
              max: Number(/HP\s*(\d+)/i.exec(npc.stats)?.[1] ?? 1),
            },
            abilityScores: {
              str: 10,
              dex: 10 + 2 * Number(/敏捷\s*\+?(-?\d+)/.exec(npc.stats)?.[1] ?? 0),
              con: 10,
              int: 10,
              wis: 10,
              cha: 10,
            },
            sceneId: mod.world.locationSceneIds.includes(scene?.id ?? "")
              ? scene!.id
              : mod.world.initialSceneId,
            capabilities: [...(mod.world.npcCapabilities?.[npc.id] ?? [])],
            attacks: [
              {
                id: "primary-attack",
                name: "攻击",
                attackBonus: Number(attack?.[1] ?? 2),
                kind: "melee" as const,
                reachFeet: 5,
                damage: {
                  count: Number(attack?.[2] ?? 1),
                  sides: Number(attack?.[3] ?? 4),
                  bonus: Number(attack?.[4] ?? 0),
                  damageType: "physical",
                },
              },
            ],
          };
        });
      const state = createWorldState(mod.world, [...input.players, ...npcEntities], input.squads);
      const now = Date.now();
      this.ctx.storage.sql.exec(
        `INSERT INTO room_state (
           singleton, room_id, module_id, ruleset_version, state_json, scope_versions_json, updated_at
         ) VALUES (1, ?, ?, ?, ?, ?, ?)`,
        input.roomId,
        input.moduleId,
        input.rulesetVersion,
        JSON.stringify(state),
        "{}",
        now,
      );
      return { created: true, stateVersion: state.version };
    });
    return result;
  }

  async upsertPlayer(input: UpsertPlayerInput) {
    const result = this.ctx.storage.transactionSync(() => {
      const row = this.roomRow();
      const mod = this.definition(row.module_id);
      const state = parseJson<WorldState>(row.state_json);
      const existingEntity = state.entities[input.player.id];
      if (existingEntity?.active !== false) {
        return { created: false, rejoined: false, stateVersion: state.version };
      }
      if (existingEntity) {
        const peers = Object.values(state.entities).filter(
          (candidate) =>
            candidate.active !== false && candidate.sceneId === existingEntity.sceneId,
        );
        const toSeconds = Math.max(
          state.causalFrontierSeconds,
          ...peers.map((candidate) => state.timelines[candidate.id]?.fictionSeconds ?? 0),
        );
        const toSpotlightBeat = Math.max(
          0,
          ...peers.map((candidate) => state.timelines[candidate.id]?.spotlightBeat ?? 0),
        );
        const commandId = `system:reseat:${input.player.id}:${crypto.randomUUID()}`;
        const events: WorldEvent[] = [
          {
            type: "EntityRejoined",
            entityId: input.player.id,
            id: `${commandId}:1`,
            commandId,
            version: state.version + 1,
            atSeconds: toSeconds,
          },
          {
            type: "TimelinesSynchronized",
            entityIds: [input.player.id],
            toSeconds,
            toSpotlightBeat,
            id: `${commandId}:2`,
            commandId,
            version: state.version + 2,
            atSeconds: toSeconds,
          },
        ];
        const next = applyEvents(state, events);
        const currentVersions = parseJson<Record<string, number>>(row.scope_versions_json);
        const nextVersions = advanceScopeVersions(
          currentVersions,
          [`entity:${input.player.id}`, `scene:${existingEntity.sceneId}`],
          next.version,
        );
        for (const event of events) {
          this.ctx.storage.sql.exec(
            `INSERT INTO world_events (
               version, event_id, command_id, event_type, fiction_seconds, event_json
             ) VALUES (?, ?, ?, ?, ?, ?)`,
            event.version,
            event.id,
            event.commandId,
            event.type,
            event.atSeconds,
            JSON.stringify(event),
          );
        }
        this.ctx.storage.sql.exec(
          `UPDATE room_state SET state_json = ?, scope_versions_json = ?, updated_at = ?
           WHERE singleton = 1`,
          JSON.stringify(next),
          JSON.stringify(nextVersions),
          Date.now(),
        );
        return { created: false, rejoined: true, stateVersion: next.version };
      }
      const seed = createWorldState(mod.world, [{ ...input.player, kind: "player" }]);
      const entity = seed.entities[input.player.id];
      const sameSceneTimes = Object.values(state.entities)
        .filter((candidate) => candidate.sceneId === entity.sceneId)
        .map((candidate) => state.timelines[candidate.id]?.fictionSeconds ?? 0);
      const sameSceneBeats = Object.values(state.entities)
        .filter((candidate) => candidate.sceneId === entity.sceneId)
        .map((candidate) => state.timelines[candidate.id]?.spotlightBeat ?? 0);
      const timeline = {
        spotlightBeat: Math.max(0, ...sameSceneBeats),
        fictionSeconds: Math.max(state.causalFrontierSeconds, ...sameSceneTimes),
        causalVersion: state.version,
      };
      const commandId = `system:seat:${input.player.id}:${crypto.randomUUID()}`;
      const event: WorldEvent = {
        type: "EntityJoined",
        entity,
        timeline,
        id: `${commandId}:1`,
        commandId,
        version: state.version + 1,
        atSeconds: timeline.fictionSeconds,
      };
      const next = applyEvents(state, [event]);
      const scopes = [`entity:${entity.id}`, `scene:${entity.sceneId}`];
      const currentVersions = parseJson<Record<string, number>>(row.scope_versions_json);
      const nextVersions = advanceScopeVersions(currentVersions, scopes, next.version);
      const now = Date.now();
      this.ctx.storage.sql.exec(
        `INSERT INTO world_events (
           version, event_id, command_id, event_type, fiction_seconds, event_json
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        event.version,
        event.id,
        event.commandId,
        event.type,
        event.atSeconds,
        JSON.stringify(event),
      );
      this.ctx.storage.sql.exec(
        `UPDATE room_state SET state_json = ?, scope_versions_json = ?, updated_at = ?
         WHERE singleton = 1`,
        JSON.stringify(next),
        JSON.stringify(nextVersions),
        now,
      );
      return { created: true, rejoined: false, stateVersion: next.version };
    });
    await this.archiveAllRoomEvents();
    return result;
  }

  async departPlayer(playerId: string) {
    const result = this.ctx.storage.transactionSync(() => {
      const row = this.roomRow();
      const state = parseJson<WorldState>(row.state_json);
      const entity = state.entities[playerId];
      if (!entity || entity.active === false) return { changed: false, stateVersion: state.version };
      if (entity.kind !== "player") throw new Error("只能让玩家角色离席");
      const commandId = `system:depart:${playerId}:${crypto.randomUUID()}`;
      const event: WorldEvent = {
        type: "EntityDeparted",
        entityId: playerId,
        id: `${commandId}:1`,
        commandId,
        version: state.version + 1,
        atSeconds: state.timelines[playerId]?.fictionSeconds ?? 0,
      };
      const next = applyEvents(state, [event]);
      const currentVersions = parseJson<Record<string, number>>(row.scope_versions_json);
      const nextVersions = advanceScopeVersions(
        currentVersions,
        [`entity:${playerId}`, `scene:${entity.sceneId}`],
        next.version,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO world_events (
           version, event_id, command_id, event_type, fiction_seconds, event_json
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        event.version,
        event.id,
        event.commandId,
        event.type,
        event.atSeconds,
        JSON.stringify(event),
      );
      this.ctx.storage.sql.exec(
        `UPDATE room_state SET state_json = ?, scope_versions_json = ?, updated_at = ?
         WHERE singleton = 1`,
        JSON.stringify(next),
        JSON.stringify(nextVersions),
        Date.now(),
      );
      return { changed: true, stateVersion: next.version };
    });
    await this.archiveAllRoomEvents();
    return result;
  }

  async synchronizePlayerLoadout(input: SynchronizePlayerLoadoutInput) {
    const result = this.ctx.storage.transactionSync(() => {
      const row = this.roomRow();
      const state = parseJson<WorldState>(row.state_json);
      const entity = state.entities[input.playerId];
      if (!entity || entity.kind !== "player") {
        return { ok: false as const, error: "玩家不在这个房间中", stateVersion: state.version };
      }
      if (!Number.isInteger(input.ac) || input.ac < 1 || input.ac > 40) {
        return { ok: false as const, error: "护甲等级不合法", stateVersion: state.version };
      }
      const commandId = `system:loadout:${input.playerId}:${crypto.randomUUID()}`;
      const eventBodies: UnstampedWorldEvent[] = [];
      const combat = state.combats[entity.sceneId];
      if (combat?.status === "active") {
        const active = combat.order[combat.activeIndex];
        const combatant = combat.order.find((entry) => entry.entityId === input.playerId);
        if (!combatant || active?.entityId !== input.playerId) {
          return {
            ok: false as const,
            error: "战斗中只能在自己的回合调整手持或穿戴物品",
            stateVersion: state.version,
          };
        }
        if (combatant.economy.objectInteraction === false) {
          return {
            ok: false as const,
            error: "本回合的免费物件互动已经使用",
            stateVersion: state.version,
          };
        }
        eventBodies.push({
          type: "CombatActionSpent",
          sceneId: entity.sceneId,
          entityId: input.playerId,
          cost: "objectInteraction",
        });
      }
      eventBodies.push({
        type: "EntityLoadoutSynchronized",
        entityId: input.playerId,
        ac: input.ac,
        attacks: structuredClone(input.attacks),
        capabilities: [...new Set(input.capabilities)],
      });
      const events = eventBodies.map((body, index) => ({
        ...body,
        id: `${commandId}:${index + 1}`,
        commandId,
        version: state.version + index + 1,
        atSeconds: state.timelines[input.playerId]?.fictionSeconds ?? 0,
      })) as WorldEvent[];
      const next = applyEvents(state, events);
      const currentVersions = parseJson<Record<string, number>>(row.scope_versions_json);
      const nextVersions = advanceScopeVersions(
        currentVersions,
        [`entity:${input.playerId}`, `scene:${entity.sceneId}`],
        next.version,
      );
      const now = Date.now();
      for (const event of events) {
        this.ctx.storage.sql.exec(
          `INSERT INTO world_events (
             version, event_id, command_id, event_type, fiction_seconds, event_json
           ) VALUES (?, ?, ?, ?, ?, ?)`,
          event.version,
          event.id,
          event.commandId,
          event.type,
          event.atSeconds,
          JSON.stringify(event),
        );
      }
      this.ctx.storage.sql.exec(
        `UPDATE room_state SET state_json = ?, scope_versions_json = ?, updated_at = ?
         WHERE singleton = 1`,
        JSON.stringify(next),
        JSON.stringify(nextVersions),
        now,
      );
      return { ok: true as const, stateVersion: next.version };
    });
    await this.archiveAllRoomEvents();
    return result;
  }

  async prepareTurn(input: PrepareTurnInput): Promise<TurnTicket> {
    const now = input.nowMs ?? Date.now();
    const ticket = this.ctx.storage.transactionSync(() => {
      this.cleanupExpired(now);
      const row = this.roomRow();
      const mod = this.definition(row.module_id);
      const state = parseJson<WorldState>(row.state_json);
      const actor = state.entities[input.actorId];
      if (!actor || actor.active === false) throw new Error("行动者不在这个房间中");
      const scopeVersions = parseJson<Record<string, number>>(row.scope_versions_json);
      const ticket: TurnTicket = {
        id: crypto.randomUUID(),
        actorId: input.actorId,
        stateVersion: state.version,
        scopeVersions,
        expiresAt: now + TURN_TICKET_TTL_MS,
        projection: project(mod.world, state, input.actorId),
      };
      this.ctx.storage.sql.exec(
        `INSERT INTO turn_tickets (
           id, actor_id, state_version, scope_versions_json, projection_json, status, expires_at
         ) VALUES (?, ?, ?, ?, ?, 'open', ?)`,
        ticket.id,
        ticket.actorId,
        ticket.stateVersion,
        JSON.stringify(ticket.scopeVersions),
        JSON.stringify(ticket.projection),
        ticket.expiresAt,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO ux_status (scope_id, phase, ticket_id, expires_at)
         VALUES (?, 'interpreting', ?, ?)
         ON CONFLICT(scope_id) DO UPDATE SET
           phase = excluded.phase,
           ticket_id = excluded.ticket_id,
           expires_at = excluded.expires_at`,
        actor.sceneId,
        ticket.id,
        now + UX_LEASE_TTL_MS,
      );
      return ticket;
    });
    await this.scheduleExpiryAlarm();
    return ticket;
  }

  async commitTurn(input: CommitTurnInput): Promise<CommitTurnResult> {
    const now = input.nowMs ?? Date.now();
    const result = this.ctx.storage.transactionSync((): CommitTurnResult => {
      this.cleanupExpired(now);
      const existing = this.ctx.storage.sql
        .exec<{ result_json: string }>("SELECT result_json FROM commands WHERE command_id = ?", input.command.id)
        .toArray()[0];
      if (existing) {
        return { ...parseJson<CommitTurnResult>(existing.result_json), idempotent: true };
      }
      const row = this.roomRow();
      const mod = this.definition(row.module_id);
      const state = parseJson<WorldState>(row.state_json);
      const ticket = this.ctx.storage.sql
        .exec<TicketRow>(
          `SELECT id, actor_id, state_version, scope_versions_json, projection_json, status, expires_at
           FROM turn_tickets WHERE id = ?`,
          input.ticketId,
        )
        .toArray()[0];
      if (!ticket || ticket.status !== "open" || ticket.expires_at <= now) {
        return {
          decision: staleDecision(input.command.id, "行动票据不存在或已经过期，请重新解释行动。"),
          stateVersion: state.version,
          idempotent: false,
        };
      }
      if (ticket.actor_id !== input.command.actorId) {
        this.ctx.storage.sql.exec("UPDATE turn_tickets SET status = 'rejected' WHERE id = ?", ticket.id);
        return {
          decision: staleDecision(input.command.id, "行动票据不属于该角色。"),
          stateVersion: state.version,
          idempotent: false,
        };
      }
      const authoritativeCommand = {
        ...input.command,
        expectedVersion: state.version,
      } as Command;
      const scopes = commandScopes(mod.world, state, authoritativeCommand);
      const ticketVersions = parseJson<Record<string, number>>(ticket.scope_versions_json);
      const currentVersions = parseJson<Record<string, number>>(row.scope_versions_json);
      const conflict = scopeConflict(ticketVersions, currentVersions, scopes);
      if (conflict) {
        this.ctx.storage.sql.exec("UPDATE turn_tickets SET status = 'stale' WHERE id = ?", ticket.id);
        this.ctx.storage.sql.exec("DELETE FROM ux_status WHERE ticket_id = ?", ticket.id);
        return {
          decision: staleDecision(input.command.id, `行动相关状态已经变化：${conflict}`),
          stateVersion: state.version,
          idempotent: false,
          conflictedScope: conflict,
        };
      }
      const decision = step(mod.world, state, authoritativeCommand);
      const nextState = decision.kind === "rejected" ? state : applyEvents(state, decision.events);
      if (decision.kind !== "rejected") {
        for (const event of decision.events) {
          this.ctx.storage.sql.exec(
            `INSERT INTO world_events (
               version, event_id, command_id, event_type, fiction_seconds, event_json
             ) VALUES (?, ?, ?, ?, ?, ?)`,
            event.version,
            event.id,
            event.commandId,
            event.type,
            event.atSeconds,
            JSON.stringify(event),
          );
        }
      }
      const nextScopeVersions =
        decision.kind === "rejected"
          ? currentVersions
          : advanceScopeVersions(currentVersions, scopes, nextState.version);
      this.ctx.storage.sql.exec(
        `UPDATE room_state
         SET state_json = ?, scope_versions_json = ?, updated_at = ?
         WHERE singleton = 1`,
        JSON.stringify(nextState),
        JSON.stringify(nextScopeVersions),
        now,
      );
      const commitResult: CommitTurnResult = {
        decision,
        stateVersion: nextState.version,
        projection: project(mod.world, nextState, input.command.actorId),
        idempotent: false,
      };
      this.ctx.storage.sql.exec(
        "INSERT INTO commands (command_id, result_json, created_at) VALUES (?, ?, ?)",
        input.command.id,
        JSON.stringify(commitResult),
        now,
      );
      this.ctx.storage.sql.exec("UPDATE turn_tickets SET status = 'committed' WHERE id = ?", ticket.id);
      const phase = decision.kind === "awaitingRoll" ? "awaitingRoll" : "narrating";
      const actorScene = nextState.entities[input.command.actorId].sceneId;
      this.ctx.storage.sql.exec(
        `INSERT INTO ux_status (scope_id, phase, ticket_id, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope_id) DO UPDATE SET
           phase = excluded.phase,
           ticket_id = excluded.ticket_id,
           expires_at = excluded.expires_at`,
        actorScene,
        phase,
        ticket.id,
        now + UX_LEASE_TTL_MS,
      );
      return commitResult;
    });
    if (result.decision.kind !== "rejected") {
      await this.archiveEvents(
        this.roomRow().room_id,
        result.decision.events,
      );
    }
    await this.scheduleExpiryAlarm();
    return result;
  }

  async finishNarration(ticketId: string) {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM ux_status WHERE ticket_id = ?", ticketId);
    });
    await this.scheduleExpiryAlarm();
  }

  async markInterpretationFailed(ticketId: string) {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE turn_tickets SET status = 'failed' WHERE id = ? AND status = 'open'",
        ticketId,
      );
      this.ctx.storage.sql.exec("DELETE FROM ux_status WHERE ticket_id = ?", ticketId);
    });
    await this.scheduleExpiryAlarm();
  }

  getSnapshot(viewerId: string, nowMs = Date.now()): RoomSnapshot {
    return this.ctx.storage.transactionSync(() => {
      this.cleanupExpired(nowMs);
      const row = this.roomRow();
      const mod = this.definition(row.module_id);
      const state = parseJson<WorldState>(row.state_json);
      const ux = this.ctx.storage.sql
        .exec<{ scope_id: string; phase: RoomSnapshot["ux"][number]["phase"]; expires_at: number }>(
          "SELECT scope_id, phase, expires_at FROM ux_status WHERE expires_at > ? ORDER BY scope_id",
          nowMs,
        )
        .toArray()
        .map((entry) => ({ scopeId: entry.scope_id, phase: entry.phase, expiresAt: entry.expires_at }));
      return {
        roomId: row.room_id,
        moduleId: row.module_id,
        rulesetVersion: RULESET_VERSION,
        projection: project(mod.world, state, viewerId),
        ux,
      };
    });
  }

  getEvents(afterVersion = 0): StoredRoomEvent[] {
    return this.ctx.storage.sql
      .exec<{
        version: number;
        event_id: string;
        command_id: string;
        event_type: WorldEvent["type"];
        fiction_seconds: number;
        event_json: string;
      }>(
        `SELECT version, event_id, command_id, event_type, fiction_seconds, event_json
         FROM world_events WHERE version > ? ORDER BY version`,
        afterVersion,
      )
      .toArray()
      .map((row) => ({
        id: row.event_id,
        commandId: row.command_id,
        version: row.version,
        atSeconds: row.fiction_seconds,
        type: row.event_type,
        event: parseJson<WorldEvent>(row.event_json),
      }));
  }

  async alarm() {
    const now = Date.now();
    this.ctx.storage.transactionSync(() => this.cleanupExpired(now));
    await this.scheduleExpiryAlarm();
  }
}
