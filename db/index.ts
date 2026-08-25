import { env } from "cloudflare:workers";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS auth_users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iterations INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email)",
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at)",
  `CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    host_user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    module_id TEXT NOT NULL DEFAULT 'black-oak-will',
    ruleset_version TEXT NOT NULL DEFAULT 'legacy',
    kp_model TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
    status TEXT NOT NULL DEFAULT 'lobby',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_rooms_host ON rooms(host_user_id)",
  `CREATE TABLE IF NOT EXISTS room_members (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    is_host INTEGER NOT NULL DEFAULT 0,
    seated INTEGER NOT NULL DEFAULT 1,
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id)",
  `CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    sheet TEXT NOT NULL,
    locked INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (room_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id TEXT,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    tts_text TEXT,
    meta TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id, created_at)",
  `CREATE TABLE IF NOT EXISTS game_states (
    room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL DEFAULT 'ch1',
    scene_id TEXT NOT NULL DEFAULT 'wake',
    revealed_clues TEXT NOT NULL DEFAULT '[]',
    npc_flags TEXT NOT NULL DEFAULT '{}',
    combat TEXT,
    pending_rolls TEXT NOT NULL DEFAULT '[]',
    kp_busy INTEGER NOT NULL DEFAULT 0,
    secret TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS session_logs (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    entry TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_session_logs_room_created ON session_logs(room_id, created_at)",
  `CREATE TABLE IF NOT EXISTS room_event_archive (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    event_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    fiction_seconds INTEGER NOT NULL,
    event_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, version),
    UNIQUE (room_id, event_id)
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_room_event_archive_event ON room_event_archive(room_id, event_id)",
  "CREATE INDEX IF NOT EXISTS idx_room_event_archive_command ON room_event_archive(room_id, command_id)",
];

let ready: Promise<void> | null = null;

async function ensureCompatibilityColumns(db: D1Database) {
  const additions = [
    { table: "rooms", column: "ruleset_version", sql: "ALTER TABLE rooms ADD COLUMN ruleset_version TEXT NOT NULL DEFAULT 'legacy'" },
    { table: "rooms", column: "kp_model", sql: "ALTER TABLE rooms ADD COLUMN kp_model TEXT NOT NULL DEFAULT 'deepseek-v4-flash'" },
    { table: "room_members", column: "seated", sql: "ALTER TABLE room_members ADD COLUMN seated INTEGER NOT NULL DEFAULT 1" },
    { table: "messages", column: "tts_text", sql: "ALTER TABLE messages ADD COLUMN tts_text TEXT" },
    { table: "game_states", column: "combat", sql: "ALTER TABLE game_states ADD COLUMN combat TEXT" },
  ] as const;
  for (const addition of additions) {
    const info = await db
      .prepare(`PRAGMA table_info(${addition.table})`)
      .all<{ name: string }>();
    if (!info.results.some((column) => column.name === addition.column)) {
      await db.prepare(addition.sql).run();
    }
  }
}

export function getD1(): D1Database {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) {
    throw new Error("D1 数据库尚未绑定。");
  }
  return binding;
}

export async function ensureDb(): Promise<D1Database> {
  const db = getD1();
  ready ??= db
    .batch(schemaStatements.map((statement) => db.prepare(statement)))
    .then(() => ensureCompatibilityColumns(db))
    .catch((error) => {
      ready = null;
      throw error;
    });
  await ready;
  return db;
}

export async function all<T>(
  sql: string,
  ...values: Array<string | number | null>
): Promise<T[]> {
  const db = await ensureDb();
  const result = await db.prepare(sql).bind(...values).all<T>();
  return result.results;
}

export async function first<T>(
  sql: string,
  ...values: Array<string | number | null>
): Promise<T | null> {
  const db = await ensureDb();
  return db.prepare(sql).bind(...values).first<T>();
}

export async function run(
  sql: string,
  ...values: Array<string | number | null>
): Promise<D1Result<unknown>> {
  const db = await ensureDb();
  return db.prepare(sql).bind(...values).run();
}
