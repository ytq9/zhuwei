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
    rulesetVersion: text("ruleset_version")
      .notNull()
      .default("dnd5e-2014-srd5.1-authoritative-v2"),
    kpModel: text("kp_model").notNull().default("deepseek-v4-flash"),
    kpModelProfile: text("kp_model_profile")
      .notNull()
      .default("authoritative-kp-deepseek-v4-flash-private-tools-v1"),
    /** Every room created by product 0.4 binds the complete private
     * Form/Action-Language/Context workflow manifest. */
    kpWorkflowManifest: text("kp_workflow_manifest"),
    kpContextPlannerProfile: text("kp_context_planner_profile"),
    runtimeEpochId: text("runtime_epoch_id"),
    genesisHash: text("genesis_hash"),
    status: text("status").notNull().default("lobby"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_rooms_code").on(table.code),
    index("idx_rooms_host").on(table.hostUserId),
  ],
);

/** Rebuild metadata for the derived static index. The authoritative prose
 * remains in code/module registries; `body` is an empty derived-index sentinel. */
export const kpStaticChunks = sqliteTable(
  "kp_static_chunks",
  {
    sourceRef: text("source_ref").primaryKey(),
    sourceHash: text("source_hash").notNull(),
    sourceSpan: text("source_span").notNull(),
    profileRef: text("profile_ref").notNull(),
    corpusProfileRef: text("corpus_profile_ref"),
    corpusProfileHash: text("corpus_profile_hash"),
    corpusHash: text("corpus_hash"),
    sensitivity: text("sensitivity").notNull(),
    dependencyRefs: text("dependency_refs").notNull(),
    structuralRefs: text("structural_refs"),
    purpose: text("purpose").notNull(),
    sourceType: text("source_type"),
    body: text("body").notNull(),
    aliases: text("aliases").notNull(),
    searchText: text("search_text").notNull(),
    rebuiltAt: text("rebuilt_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_kp_static_chunks_profile").on(table.profileRef),
    index("idx_kp_static_chunks_hash").on(table.sourceHash),
  ],
);

export const kpStaticCorpusProfiles = sqliteTable(
  "kp_static_corpus_profiles",
  {
    profileRef: text("profile_ref").primaryKey(),
    profileHash: text("profile_hash").notNull(),
    corpusHash: text("corpus_hash"),
    compilerVersion: text("compiler_version"),
    chunkCount: integer("chunk_count").notNull(),
    rebuiltAt: text("rebuilt_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

/** Drizzle does not model SQLite virtual tables. Keeping the exact statement
 * beside the relational source makes the FTS projection reproducible and lets
 * migration/tests verify it byte-for-byte. */
export const KP_STATIC_FTS_SCHEMA_SQL =
  "CREATE VIRTUAL TABLE `kp_static_chunks_fts` USING fts5(`source_ref` UNINDEXED, `search_text`, tokenize='unicode61')";

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

/**
 * Immutable authoritative-v2 genesis copies. The Room Durable Object remains
 * the live authority; these rows exist only to rebuild an empty DO.
 */
export const authoritativeRoomGenesisArchive = sqliteTable(
  "authoritative_room_genesis_archive",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    runtimeEpochId: text("runtime_epoch_id").notNull(),
    genesisHash: text("genesis_hash").notNull(),
    manifestProfileId: text("manifest_profile_id").notNull(),
    manifestProfileHash: text("manifest_profile_hash").notNull(),
    rulesetProfileId: text("ruleset_profile_id").notNull(),
    rulesetProfileHash: text("ruleset_profile_hash").notNull(),
    eventSchemaProfileId: text("event_schema_profile_id").notNull(),
    eventSchemaProfileHash: text("event_schema_profile_hash").notNull(),
    moduleProfileId: text("module_profile_id").notNull(),
    moduleProfileHash: text("module_profile_hash").notNull(),
    definitionProfileId: text("definition_profile_id").notNull(),
    definitionProfileHash: text("definition_profile_hash").notNull(),
    genesisJson: text("genesis_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.runtimeEpochId] }),
    uniqueIndex("idx_authoritative_genesis_hash")
      .on(table.roomId, table.genesisHash),
  ],
);

/** Append-only authoritative-v2 events; never read as a live state snapshot. */
export const authoritativeRoomEventArchive = sqliteTable(
  "authoritative_room_event_archive",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    runtimeEpochId: text("runtime_epoch_id").notNull(),
    eventSeq: integer("event_seq").notNull(),
    eventId: text("event_id").notNull(),
    rootActionId: text("root_action_id").notNull(),
    branchId: text("branch_id").notNull(),
    eventType: text("event_type").notNull(),
    eventTypeVersion: text("event_type_version").notNull(),
    manifestProfileId: text("manifest_profile_id").notNull(),
    manifestProfileHash: text("manifest_profile_hash").notNull(),
    rulesetProfileId: text("ruleset_profile_id").notNull(),
    rulesetProfileHash: text("ruleset_profile_hash").notNull(),
    eventSchemaProfileId: text("event_schema_profile_id").notNull(),
    eventSchemaProfileHash: text("event_schema_profile_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    previousEventHash: text("previous_event_hash").notNull(),
    stateBeforeHash: text("state_before_hash").notNull(),
    stateHashAfter: text("state_hash_after").notNull(),
    eventHash: text("event_hash").notNull(),
    eventJson: text("event_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.runtimeEpochId, table.eventSeq] }),
    uniqueIndex("idx_authoritative_event_id")
      .on(table.roomId, table.runtimeEpochId, table.eventId),
    index("idx_authoritative_event_branch")
      .on(table.roomId, table.runtimeEpochId, table.branchId, table.eventSeq),
    index("idx_authoritative_event_action")
      .on(table.roomId, table.runtimeEpochId, table.rootActionId),
  ],
);

/** Hash-only representative projections used to verify archive rebuilds. */
export const authoritativeProjectionAuditArchive = sqliteTable(
  "authoritative_projection_audit_archive",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    runtimeEpochId: text("runtime_epoch_id").notNull(),
    eventSeq: integer("event_seq").notNull(),
    viewerHash: text("viewer_hash").notNull(),
    projectionHash: text("projection_hash").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({
      columns: [table.roomId, table.runtimeEpochId, table.eventSeq, table.viewerHash],
    }),
    index("idx_authoritative_projection_head")
      .on(table.roomId, table.runtimeEpochId, table.eventSeq),
  ],
);

/**
 * A checkpoint is advanced only in the same D1 batch that finishes the full
 * settled archive head.  It is the sole recovery locator; event rows after it
 * are deliberately ignored by disaster recovery until a later checkpoint is
 * committed.
 */
export const authoritativeRoomArchiveCheckpoint = sqliteTable(
  "authoritative_room_archive_checkpoint",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    runtimeEpochId: text("runtime_epoch_id").notNull(),
    genesisHash: text("genesis_hash").notNull(),
    settledEventSeq: integer("settled_event_seq").notNull(),
    eventHash: text("event_hash").notNull(),
    stateHash: text("state_hash").notNull(),
    activeBranchId: text("active_branch_id").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.runtimeEpochId] }),
  ],
);
