import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  STATIC_CORPUS_PROFILE,
  STATIC_CORPUS_SOURCE_TYPES,
  authoritativeStaticCorpusReader,
  compileStaticCorpus,
  corpusChineseTerms,
  createD1StaticCorpusAdapter,
  retrieveStaticReferencesFromD1,
} from "../app/_runtime/lib/kp/static-corpus.ts";
import {
  createStaticRetrievalRequest,
  rehydrateStaticContext,
  staticSearchTerms,
} from "../app/_runtime/lib/kp/static-retrieval.ts";
import { KP_STATIC_FTS_SCHEMA_SQL } from "../db/schema.ts";

test("static corpus compiler is deterministic, profile-bound, and rejects every dynamic source class", () => {
  assert.deepEqual(STATIC_CORPUS_SOURCE_TYPES, [
    "srd",
    "module",
    "story-bible",
    "ability",
    "enemy",
    "environment",
  ]);
  assert.match(STATIC_CORPUS_PROFILE.profileHash, /^fnv1a64:[0-9a-f]{16}$/u);

  const sources = authoritativeSources();
  const first = compileStaticCorpus(sources);
  const second = compileStaticCorpus(structuredClone(sources).reverse());
  assert.deepEqual(first, second);
  assert.match(first.corpusHash, /^fnv1a64:[0-9a-f]{16}$/u);
  assert.equal(first.compilerProfileHash, STATIC_CORPUS_PROFILE.profileHash);
  assert.equal(first.chunks.length, 7);
  assert.equal(new Set(first.chunks.map((chunk) => chunk.sourceRef)).size, first.chunks.length);
  assert.ok(first.chunks.every((chunk) => chunk.sourceKind === "static"));
  assert.ok(first.chunks.every((chunk) => chunk.dependencyRefs.some((ref) => chunk.sourceRef.startsWith(ref))));
  assert.ok(first.d1Rows.every((row) => row.corpusProfileHash === STATIC_CORPUS_PROFILE.profileHash));
  assert.ok(first.d1Rows.every((row) => !Object.hasOwn(row, "body")));
  assert.equal(first.d1Rows.length, 6);
  assert.ok(first.d1Rows.every((row) => row.sensitivity === "public"));
  assert.ok(first.d1Rows.every((row) => !row.sourceRef.startsWith("story-bible:")));
  assert.equal(
    staticSearchTerms("幕后真相：钥匙埋在黑橡树下。").includes("钥匙埋在黑橡树下"),
    false,
  );

  const chandelierRef = first.chunks.find((chunk) => chunk.aliases.includes("吊灯"))?.sourceRef;
  assert.ok(chandelierRef);
  const chandelierTerms = corpusChineseTerms(first, chandelierRef);
  assert.ok(chandelierTerms.includes("吊灯"));
  assert.ok(chandelierTerms.includes("锁链"));
  assert.ok(first.index.structuralRefs["scene:great-hall"].includes(chandelierRef));

  const changed = compileStaticCorpus(sources.map((source) => source.sourceRef === "module:great-hall"
    ? { ...source, body: `${source.body}新增一条静态描述。`, spans: undefined }
    : source));
  assert.notEqual(changed.corpusHash, first.corpusHash);
  assert.notEqual(
    changed.chunks.find((chunk) => chunk.sourceRef.startsWith("module:great-hall"))?.sourceHash,
    first.chunks.find((chunk) => chunk.sourceRef.startsWith("module:great-hall"))?.sourceHash,
  );

  const base = sources[0];
  for (const dynamic of [
    { ...base, sourceKind: "room" },
    { ...base, sourceRef: "room:active:state" },
    { ...base, sourceRef: "transcript:room:001" },
    { ...base, sourceRef: "current-tactical:positions" },
    { ...base, sourceRef: "knowledge:npc:warden" },
    { ...base, currentTacticalState: { zone: "balcony" } },
  ]) {
    assert.throws(() => compileStaticCorpus([dynamic]), /DYNAMIC_SOURCE_FORBIDDEN/);
  }
  assert.throws(() => compileStaticCorpus([{
    ...base,
    spans: [{ start: 0, end: 10 }, { start: 5, end: 15 }],
  }]), /SPAN_OVERLAP/);
});

test("D1 corpus integrity is independent of SQLite BINARY versus JavaScript locale ordering", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhuwei-static-corpus-order-"));
  const databasePath = join(directory, "corpus.sqlite");
  const local = new LocalD1Database(databasePath);
  try {
    await applyDrizzleMigrations(local);
    const corpus = compileStaticCorpus([
      {
        sourceKind: "static",
        sourceType: "ability",
        sourceRef: "ability:shield",
        profileRef: "rules:srd5.1-2014-v2",
        sensitivity: "public",
        body: "盾牌提高持有者的护甲等级。",
        aliases: ["盾牌"],
        structuralRefs: ["equipment:shield"],
        dependencyRefs: ["rules:srd5.1-2014-v2"],
      },
      {
        sourceKind: "static",
        sourceType: "ability",
        sourceRef: "ability:shield-faith",
        profileRef: "rules:srd5.1-2014-v2",
        sensitivity: "public",
        body: "虔诚护盾在持续时间内提高目标的护甲等级。",
        aliases: ["虔诚护盾"],
        structuralRefs: ["spell:shield-of-faith"],
        dependencyRefs: ["rules:srd5.1-2014-v2"],
      },
    ]);
    const sourceRefs = corpus.d1Rows.map((row) => row.sourceRef);
    assert.notDeepEqual(
      [...sourceRefs].sort(),
      [...sourceRefs].sort((left, right) => left.localeCompare(right)),
      "fixture must preserve the production shield/shield-faith collation inversion",
    );
    const adapter = createD1StaticCorpusAdapter(local, {
      allowedProfileRefs: ["rules:srd5.1-2014-v2"],
      allowKpOnly: false,
    });
    await adapter.upsert(corpus);
    assert.equal(await adapter.isCurrent(corpus), true);
    assert.equal(await adapter.isCurrent(structuredClone(corpus)), true);
  } finally {
    local.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("fresh ordered Drizzle migrations support FTS upsert, MATCH, authoritative rehydration, and rebuild", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhuwei-static-corpus-"));
  const databasePath = join(directory, "corpus.sqlite");
  const local = new LocalD1Database(databasePath);
  try {
    const initialMigration = await readFile(
      join(process.cwd(), "drizzle", "0008_clumsy_lady_vermin.sql"),
      "utf8",
    );
    assert.ok(initialMigration.includes(`${KP_STATIC_FTS_SCHEMA_SQL};`));
    const corpus = compileStaticCorpus(authoritativeSources());
    const profileRefs = [...new Set(corpus.chunks.map((chunk) => chunk.profileRef))];
    const adapter = createD1StaticCorpusAdapter(local, {
      allowedProfileRefs: profileRefs,
      allowKpOnly: true,
    });

    await applyDrizzleMigrations(local);
    await adapter.upsert(corpus);
    await adapter.upsert(corpus);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_chunks"), corpus.d1Rows.length);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_chunks_fts"), corpus.d1Rows.length);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_corpus_profiles"), 1);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_chunks WHERE body <> ''"), 0);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_chunks WHERE sensitivity = 'kp-only'"), 0);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_chunks WHERE search_text LIKE '%大厅中央悬挂%'"), 0);

    const rawHits = await adapter.search({ terms: ["吊灯", "锁链"], limit: 8 });
    assert.ok(rawHits.length > 0);
    assert.deepEqual(Object.keys(rawHits[0]).sort(), ["score", "sourceRef"]);
    assert.ok(rawHits.some((hit) => hit.sourceRef.startsWith("module:great-hall#span:")));

    const request = createStaticRetrievalRequest({
      structuralRefs: ["scene:great-hall"],
      exactAliases: ["吊灯"],
      queryText: "射断锁链让吊灯坠落",
      limit: 8,
    });
    const mergedHits = await retrieveStaticReferencesFromD1(corpus.index, request, adapter);
    assert.ok(mergedHits.length > 0);
    assert.ok(mergedHits[0].routes.includes("structural"));
    assert.equal(Object.hasOwn(mergedHits[0], "body"), false);

    const readAuthority = authoritativeStaticCorpusReader(corpus);
    const hydrated = rehydrateStaticContext(mergedHits, readAuthority, {
      allowedProfileRefs: profileRefs,
      allowKpOnly: true,
    });
    assert.equal(hydrated.length, mergedHits.length);
    for (const [index, chunk] of hydrated.entries()) {
      const hit = mergedHits[index];
      assert.equal(chunk.sourceRef, hit.sourceRef);
      assert.equal(chunk.sourceHash, hit.sourceHash);
      assert.equal(chunk.profileRef, hit.profileRef);
      assert.deepEqual(chunk.sourceSpan, hit.sourceSpan);
      assert.equal(chunk.sensitivity, hit.sensitivity);
      assert.deepEqual([...chunk.dependencyRefs].sort(), [...hit.dependencyRefs].sort());
      assert.ok(chunk.body.length > 0);
    }
    assert.throws(() => rehydrateStaticContext([mergedHits[0]], (sourceRef) => ({
      ...readAuthority(sourceRef),
      sourceHash: "fnv1a64:0000000000000000",
    }), { allowedProfileRefs: profileRefs, allowKpOnly: true }), /SOURCE_HASH_MISMATCH/);
    const authoritative = readAuthority(mergedHits[0].sourceRef);
    for (const [mutation, expected] of [
      [{ profileRef: "profile:stale" }, /PROFILE_MISMATCH/],
      [{ sourceSpan: { start: authoritative.sourceSpan.start + 1, end: authoritative.sourceSpan.end } }, /SPAN_MISMATCH/],
      [{ sensitivity: authoritative.sensitivity === "public" ? "kp-only" : "public" }, /SENSITIVITY_MISMATCH/],
      [{ dependencyRefs: [...authoritative.dependencyRefs, "dependency:forged"] }, /DEPENDENCY_MISMATCH/],
    ]) {
      assert.throws(() => rehydrateStaticContext([mergedHits[0]], () => ({
        ...authoritative,
        ...mutation,
      }), { allowedProfileRefs: [...profileRefs, "profile:stale"], allowKpOnly: true }), expected);
    }

    await adapter.rebuild(corpus);
    const firstSnapshot = local.snapshot();
    await adapter.rebuild(structuredClone(corpus));
    const secondSnapshot = local.snapshot();
    assert.deepEqual(secondSnapshot, firstSnapshot);
    assert.equal(firstSnapshot.meta.corpus_hash, corpus.d1CorpusHash);
    assert.equal(firstSnapshot.meta.profile_hash, corpus.compilerProfileHash);
    assert.equal(firstSnapshot.meta.chunk_count, corpus.d1Rows.length);

    const storedRef = firstSnapshot.chunks[0].source_ref;
    local.database.prepare("DELETE FROM kp_static_chunks_fts WHERE source_ref = ?").run(storedRef);
    assert.equal(await adapter.isCurrent(corpus), false);
    await adapter.upsert(corpus);
    assert.equal(await adapter.isCurrent(corpus), true);
    local.database.prepare("DELETE FROM kp_static_chunks WHERE source_ref = ?").run(storedRef);
    assert.equal(await adapter.isCurrent(corpus), false);
    await adapter.upsert(corpus);
    assert.equal(await adapter.isCurrent(corpus), true);
    local.database.prepare(
      "UPDATE kp_static_chunks SET source_hash = ? WHERE source_ref = ?",
    ).run("fnv1a64:0000000000000000", storedRef);
    assert.equal(await adapter.isCurrent(corpus), false);
    await adapter.upsert(corpus);
    assert.equal(await adapter.isCurrent(corpus), true);
    local.database.prepare(
      "UPDATE kp_static_chunks_fts SET search_text = ? WHERE source_ref = ?",
    ).run("same-count-corrupt-fts-row", storedRef);
    assert.equal(await adapter.isCurrent(corpus), false);
    await adapter.upsert(corpus);
    assert.equal(await adapter.isCurrent(corpus), true);

    const publicAdapter = createD1StaticCorpusAdapter(local, {
      allowedProfileRefs: profileRefs,
      allowKpOnly: false,
    });
    assert.equal(await publicAdapter.isCurrent(corpus), true);
    assert.deepEqual(await publicAdapter.search({ terms: ["黑橡", "橡树"], limit: 8 }), []);
    const beforePrivateQuery = local.prepareHistory.length;
    assert.deepEqual(await adapter.search({ terms: ["黑橡", "橡树"], limit: 8 }), []);
    assert.equal(
      local.prepareHistory.length,
      beforePrivateQuery,
      "private-only query terms must not cross the D1 prepare/bind seam",
    );
    const privateRequest = createStaticRetrievalRequest({
      queryText: "黑橡树旧誓约的印记是谁伪造的？",
      limit: 8,
    });
    const privateHits = await retrieveStaticReferencesFromD1(corpus.index, privateRequest, adapter);
    assert.ok(privateHits.some((hit) =>
      hit.sourceRef.startsWith("story-bible:black-oak-secret#span:")
      && hit.sensitivity === "kp-only"));
    const rulesOnlyAdapter = createD1StaticCorpusAdapter(local, {
      allowedProfileRefs: ["rules:srd5.1-2014-v2"],
      allowKpOnly: true,
    });
    assert.equal(await rulesOnlyAdapter.isCurrent(corpus), true);
    assert.deepEqual(await rulesOnlyAdapter.search({ terms: ["吊灯", "锁链"], limit: 8 }), []);

    const smaller = compileStaticCorpus(authoritativeSources().slice(0, 2));
    await adapter.rebuild(smaller);
    const smallerScope = `corpus:${smaller.d1StorageScope}:%`;
    assert.equal(
      local.scalar("SELECT count(*) AS value FROM kp_static_chunks WHERE source_ref LIKE ?", smallerScope),
      smaller.d1Rows.length,
    );
    assert.equal(
      local.scalar("SELECT count(*) AS value FROM kp_static_chunks_fts WHERE source_ref LIKE ?", smallerScope),
      smaller.d1Rows.length,
    );
    assert.equal(await adapter.isCurrent(corpus), true);
    assert.equal(await adapter.isCurrent(smaller), true);
    assert.equal(
      local.scalar("SELECT count(*) AS value FROM kp_static_chunks WHERE source_ref LIKE 'story-bible:%'"),
      0,
    );
  } finally {
    local.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("two module corpora keep isolated D1 namespaces through sync and rebuild", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhuwei-static-corpus-scopes-"));
  const databasePath = join(directory, "corpus.sqlite");
  const local = new LocalD1Database(databasePath);
  try {
    await applyDrizzleMigrations(local);
    const first = compileStaticCorpus(authoritativeSources());
    const second = compileStaticCorpus(authoritativeSources().map((source) => ({
      ...source,
      profileRef: source.profileRef === "module:black-oak-v3"
        ? "module:silver-marsh-v3"
        : source.profileRef,
      body: source.sourceRef === "module:great-hall"
        ? "银沼高塔中央悬着一口青铜钟。\n守卫通常沿北侧回廊巡查。"
        : source.body,
      spans: source.sourceRef === "module:great-hall" ? undefined : source.spans,
    })));
    assert.notEqual(first.d1StorageScope, second.d1StorageScope);
    const firstAdapter = createD1StaticCorpusAdapter(local, {
      allowedProfileRefs: [...new Set(first.chunks.map((chunk) => chunk.profileRef))],
      allowKpOnly: true,
    });
    const secondAdapter = createD1StaticCorpusAdapter(local, {
      allowedProfileRefs: [...new Set(second.chunks.map((chunk) => chunk.profileRef))],
      allowKpOnly: true,
    });

    await firstAdapter.upsert(first);
    await secondAdapter.upsert(second);
    assert.equal(await firstAdapter.isCurrent(first), true);
    assert.equal(await secondAdapter.isCurrent(second), true);
    assert.equal(
      local.scalar("SELECT count(*) AS value FROM kp_static_chunks"),
      first.d1Rows.length + second.d1Rows.length,
    );
    assert.deepEqual(await firstAdapter.search({ terms: ["银沼", "高塔"], limit: 8 }), []);
    assert.ok((await secondAdapter.search({ terms: ["银沼", "高塔"], limit: 8 }))
      .some((hit) => hit.sourceRef.startsWith("module:great-hall#span:")));

    await secondAdapter.rebuild(second);
    assert.equal(await firstAdapter.isCurrent(first), true);
    assert.equal(await secondAdapter.isCurrent(second), true);
  } finally {
    local.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("two public corpus versions with identical profile refs keep isolated D1 namespaces", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhuwei-static-corpus-versions-"));
  const databasePath = join(directory, "corpus.sqlite");
  const local = new LocalD1Database(databasePath);
  try {
    await applyDrizzleMigrations(local);
    const first = compileStaticCorpus(authoritativeSources());
    const second = compileStaticCorpus(authoritativeSources().map((source) =>
      source.sourceRef === "srd:objects:damage"
        ? { ...source, body: `${source.body}法术也可能损坏对象。` }
        : source));
    assert.deepEqual(
      [...new Set(first.chunks.map((chunk) => chunk.profileRef))],
      [...new Set(second.chunks.map((chunk) => chunk.profileRef))],
    );
    assert.notEqual(first.d1CorpusHash, second.d1CorpusHash);
    assert.notEqual(first.d1StorageScope, second.d1StorageScope);

    const profileRefs = [...new Set(first.chunks.map((chunk) => chunk.profileRef))];
    const firstAdapter = createD1StaticCorpusAdapter(local, {
      allowedProfileRefs: profileRefs,
      allowKpOnly: true,
    });
    const secondAdapter = createD1StaticCorpusAdapter(local, {
      allowedProfileRefs: profileRefs,
      allowKpOnly: true,
    });
    await firstAdapter.upsert(first);
    await secondAdapter.upsert(second);

    assert.equal(await firstAdapter.isCurrent(first), true);
    assert.equal(await secondAdapter.isCurrent(second), true);
    assert.equal(
      local.scalar("SELECT count(*) AS value FROM kp_static_chunks"),
      first.d1Rows.length + second.d1Rows.length,
    );
    assert.deepEqual(await firstAdapter.search({ terms: ["法术"], limit: 8 }), []);
    assert.ok((await secondAdapter.search({ terms: ["法术"], limit: 8 }))
      .some((hit) => hit.sourceRef.startsWith("srd:objects:damage#span:")));

    await secondAdapter.rebuild(second);
    assert.equal(await firstAdapter.isCurrent(first), true);
    assert.equal(await secondAdapter.isCurrent(second), true);
  } finally {
    local.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an existing 0008 corpus upgrades through 0010, scrubs legacy rows, and rebuilds exactly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhuwei-static-corpus-upgrade-"));
  const databasePath = join(directory, "corpus.sqlite");
  const local = new LocalD1Database(databasePath);
  try {
    await applyDrizzleMigrations(local, { through: "0008_clumsy_lady_vermin.sql" });
    const corpus = compileStaticCorpus(authoritativeSources());
    const first = corpus.d1Rows[0];
    local.database.prepare(`
      INSERT INTO kp_static_chunks (
        source_ref, source_hash, source_span, profile_ref, sensitivity,
        dependency_refs, purpose, body, aliases, search_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      first.sourceRef,
      "fnv1a64:0000000000000000",
      JSON.stringify({ start: 0, end: 1 }),
      first.sourceProfileRef,
      first.sensitivity,
      "[]",
      first.purpose,
      "legacy-derived-prose-must-not-survive",
      "[]",
      "legacy",
    );
    local.database.prepare(
      "INSERT INTO kp_static_chunks_fts (source_ref, search_text) VALUES (?, ?)",
    ).run(first.sourceRef, "legacy");

    await applyDrizzleMigrations(local, { after: "0008_clumsy_lady_vermin.sql" });
    const columns = local.database.prepare("PRAGMA table_info(kp_static_chunks)").all()
      .map((row) => row.name);
    for (const column of [
      "corpus_profile_ref", "corpus_profile_hash", "corpus_hash",
      "structural_refs", "source_type",
    ]) assert.ok(columns.includes(column), column);

    const profileRefs = [...new Set(corpus.chunks.map((chunk) => chunk.profileRef))];
    const adapter = createD1StaticCorpusAdapter(local, {
      allowedProfileRefs: profileRefs,
      allowKpOnly: true,
    });
    await adapter.upsert(corpus);
    assert.equal(await adapter.isCurrent(corpus), true);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_chunks"), corpus.d1Rows.length);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_chunks_fts"), corpus.d1Rows.length);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_chunks WHERE body <> ''"), 0);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_chunks WHERE sensitivity = 'kp-only'"), 0);
    const hits = await adapter.search({ terms: ["吊灯", "锁链"], limit: 8 });
    assert.ok(hits.some((hit) => hit.sourceRef.startsWith("module:great-hall#span:")));
  } finally {
    local.close();
    await rm(directory, { recursive: true, force: true });
  }
});

async function applyDrizzleMigrations(local, options = {}) {
  const directory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(directory))
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
    .sort();
  const selected = files.filter((file) =>
    (options.after === undefined || file > options.after)
    && (options.through === undefined || file <= options.through));
  for (const file of selected) {
    const sql = await readFile(new URL(file, directory), "utf8");
    await local.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
}

function authoritativeSources() {
  const hallBody = "大厅中央悬挂一盏重型铁制吊灯，以旧锁链固定。\n守卫通常沿北侧回廊巡查。";
  const separator = hallBody.indexOf("\n");
  return [
    {
      sourceKind: "static",
      sourceType: "srd",
      sourceRef: "srd:objects:damage",
      profileRef: "rules:srd5.1-2014-v2",
      sensitivity: "public",
      body: "对象的护甲等级与生命值由材质决定；攻击可能损坏或摧毁对象。",
      aliases: ["对象伤害", "物体破坏"],
      structuralRefs: ["rule:object-damage"],
      dependencyRefs: ["rules:srd5.1-2014-v2"],
    },
    {
      sourceKind: "static",
      sourceType: "module",
      sourceRef: "module:great-hall",
      profileRef: "module:black-oak-v3",
      sensitivity: "public",
      body: hallBody,
      aliases: ["大厅"],
      structuralRefs: ["scene:great-hall"],
      dependencyRefs: ["module:black-oak-v3"],
      spans: [
        {
          start: 0,
          end: separator,
          aliases: ["吊灯", "大厅灯架"],
          structuralRefs: ["feature:chandelier"],
          dependencyRefs: ["module:black-oak-v3"],
        },
        {
          start: separator + 1,
          end: hallBody.length,
          aliases: ["北侧回廊"],
          structuralRefs: ["route:north-gallery"],
          dependencyRefs: ["module:black-oak-v3"],
        },
      ],
    },
    {
      sourceKind: "static",
      sourceType: "story-bible",
      sourceRef: "story-bible:black-oak-secret",
      profileRef: "module:black-oak-v3",
      sensitivity: "kp-only",
      body: "黑橡树旧誓约的印记曾被摄政者伪造。",
      aliases: ["黑橡树", "旧誓约"],
      structuralRefs: ["truth:black-oak-oath"],
      dependencyRefs: ["module:black-oak-v3"],
    },
    {
      sourceKind: "static",
      sourceType: "ability",
      sourceRef: "ability:second-wind",
      profileRef: "rules:srd5.1-2014-v2",
      sensitivity: "public",
      body: "回气允许战士以附赠动作恢复生命值。",
      aliases: ["回气", "Second Wind"],
      structuralRefs: ["class:fighter"],
      dependencyRefs: ["rules:srd5.1-2014-v2"],
    },
    {
      sourceKind: "static",
      sourceType: "enemy",
      sourceRef: "enemy:bandit-captain",
      profileRef: "rules:srd5.1-2014-v2",
      sensitivity: "public",
      body: "强盗首领善于多重攻击和招架。",
      aliases: ["强盗首领"],
      structuralRefs: ["enemy:bandit"],
      dependencyRefs: ["rules:srd5.1-2014-v2"],
    },
    {
      sourceKind: "static",
      sourceType: "environment",
      sourceRef: "environment:falling-chandelier",
      profileRef: "module:black-oak-v3",
      sensitivity: "public",
      body: "吊灯坠落后形成难以通行的金属残骸，并可能提供掩护。",
      aliases: ["吊灯残骸", "坠落吊灯"],
      structuralRefs: ["hazard:falling-chandelier"],
      dependencyRefs: ["module:black-oak-v3", "rules:srd5.1-2014-v2"],
    },
  ];
}

class LocalD1PreparedStatement {
  constructor(owner, sql, values = []) {
    this.owner = owner;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new LocalD1PreparedStatement(this.owner, this.sql, values);
  }

  async run() {
    return this.runSync();
  }

  async all() {
    return { success: true, results: this.owner.database.prepare(this.sql).all(...this.values) };
  }

  runSync() {
    const result = this.owner.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class LocalD1Database {
  constructor(path) {
    this.database = new DatabaseSync(path);
    this.prepareHistory = [];
  }

  async exec(sql) {
    this.database.exec(sql);
    return { count: 1, duration: 0 };
  }

  prepare(sql) {
    this.prepareHistory.push(sql);
    return new LocalD1PreparedStatement(this, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => {
        assert.ok(statement instanceof LocalD1PreparedStatement);
        assert.strictEqual(statement.owner, this);
        return statement.runSync();
      });
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  scalar(sql, ...values) {
    return Number(this.database.prepare(sql).get(...values).value);
  }

  snapshot() {
    const chunks = this.database.prepare(`
      SELECT source_ref, source_hash, source_span, profile_ref,
             corpus_profile_ref, corpus_profile_hash, corpus_hash,
             sensitivity, dependency_refs, structural_refs, aliases,
             purpose, source_type, body, search_text
      FROM kp_static_chunks
      ORDER BY source_ref
    `).all();
    const fts = this.database.prepare(`
      SELECT source_ref, search_text
      FROM kp_static_chunks_fts
      ORDER BY source_ref
    `).all();
    const meta = this.database.prepare(
      "SELECT * FROM kp_static_corpus_profiles ORDER BY profile_ref LIMIT 1",
    ).get();
    return structuredClone({ chunks, fts, meta });
  }

  close() {
    this.database.close();
  }
}
