import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const authUsers = sqliteTable(
  "auth_users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    passwordIterations: integer("password_iterations").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("idx_auth_users_email").on(table.email)],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_auth_sessions_user").on(table.userId),
    index("idx_auth_sessions_expires").on(table.expiresAt),
  ],
);

export const rooms = sqliteTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    hostUserId: text("host_user_id").notNull(),
    title: text("title").notNull(),
    moduleId: text("module_id").notNull().default("black-oak-will"),
    status: text("status").notNull().default("lobby"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_rooms_code").on(table.code),
    index("idx_rooms_host").on(table.hostUserId),
  ],
);

export const roomMembers = sqliteTable(
  "room_members",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    nickname: text("nickname").notNull(),
    isHost: integer("is_host", { mode: "boolean" }).notNull().default(false),
    seated: integer("seated", { mode: "boolean" }).notNull().default(true),
    joinedAt: text("joined_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.userId] }),
    index("idx_room_members_user").on(table.userId),
  ],
);

export const characters = sqliteTable(
  "characters",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    sheet: text("sheet").notNull(),
    locked: integer("locked", { mode: "boolean" }).notNull().default(true),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_characters_room_user").on(table.roomId, table.userId),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    body: text("body").notNull(),
    ttsText: text("tts_text"),
    meta: text("meta").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_messages_room_created").on(table.roomId, table.createdAt)],
);

export const gameStates = sqliteTable("game_states", {
  roomId: text("room_id")
    .primaryKey()
    .references(() => rooms.id, { onDelete: "cascade" }),
  chapterId: text("chapter_id").notNull().default("ch1"),
  sceneId: text("scene_id").notNull().default("wake"),
  revealedClues: text("revealed_clues").notNull().default("[]"),
  npcFlags: text("npc_flags").notNull().default("{}"),
  combat: text("combat"),
  pendingRolls: text("pending_rolls").notNull().default("[]"),
  kpBusy: integer("kp_busy", { mode: "boolean" }).notNull().default(false),
  secret: text("secret").notNull().default("{}"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sessionLogs = sqliteTable(
  "session_logs",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    entry: text("entry").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_session_logs_room_created").on(table.roomId, table.createdAt)],
);
