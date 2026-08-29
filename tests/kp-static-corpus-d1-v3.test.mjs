import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
} from "../app/_runtime/lib/kp/static-retrieval.ts";

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

test("real local SQLite FTS seam migrates, upserts, MATCHes refs, rehydrates authority, and rebuilds exactly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhuwei-static-corpus-"));
  const databasePath = join(directory, "corpus.sqlite");
  const local = new LocalD1Database(databasePath);
  try {
    const corpus = compileStaticCorpus(authoritativeSources());
    const profileRefs = [...new Set(corpus.chunks.map((chunk) => chunk.profileRef))];
    const adapter = createD1StaticCorpusAdapter(local, {
      allowedProfileRefs: profileRefs,
      allowKpOnly: true,
    });

    await adapter.migrate();
    await adapter.migrate();
    await adapter.upsert(corpus);
    await adapter.upsert(corpus);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_corpus_chunks"), corpus.chunks.length);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_corpus_fts"), corpus.chunks.length);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_corpus_meta"), 1);

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
    assert.equal(firstSnapshot.meta.corpus_hash, corpus.corpusHash);
    assert.equal(firstSnapshot.meta.corpus_profile_hash, corpus.compilerProfileHash);
    assert.equal(firstSnapshot.meta.chunk_count, corpus.chunks.length);

    const publicAdapter = createD1StaticCorpusAdapter(local, {
      allowedProfileRefs: profileRefs,
      allowKpOnly: false,
    });
    assert.deepEqual(await publicAdapter.search({ terms: ["黑橡", "橡树"], limit: 8 }), []);
    const secretHits = await adapter.search({ terms: ["黑橡", "橡树"], limit: 8 });
    assert.ok(secretHits.some((hit) => hit.sourceRef.startsWith("story-bible:black-oak-secret#span:")));
    const rulesOnlyAdapter = createD1StaticCorpusAdapter(local, {
      allowedProfileRefs: ["rules:srd5.1-2014-v2"],
      allowKpOnly: true,
    });
    assert.deepEqual(await rulesOnlyAdapter.search({ terms: ["吊灯", "锁链"], limit: 8 }), []);

    const smaller = compileStaticCorpus(authoritativeSources().slice(0, 2));
    await adapter.rebuild(smaller);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_corpus_chunks"), smaller.chunks.length);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_corpus_fts"), smaller.chunks.length);
    assert.equal(
      local.scalar("SELECT count(*) AS value FROM kp_static_corpus_chunks WHERE source_ref LIKE 'story-bible:%'"),
      0,
    );
  } finally {
    local.close();
    await rm(directory, { recursive: true, force: true });
  }
});

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
      dependencyRefs: ["rule:objects"],
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
      dependencyRefs: ["module:black-oak"],
      spans: [
        {
          start: 0,
          end: separator,
          aliases: ["吊灯", "大厅灯架"],
          structuralRefs: ["feature:chandelier"],
          dependencyRefs: ["truth:hall-construction"],
        },
        {
          start: separator + 1,
          end: hallBody.length,
          aliases: ["北侧回廊"],
          structuralRefs: ["route:north-gallery"],
          dependencyRefs: ["npc:warden"],
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
      dependencyRefs: ["truth:seal-forged"],
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
      dependencyRefs: ["rule:bonus-action"],
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
      dependencyRefs: ["rule:multiattack"],
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
      dependencyRefs: ["feature:chandelier", "rule:cover"],
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
  }

  async exec(sql) {
    this.database.exec(sql);
    return { count: 1, duration: 0 };
  }

  prepare(sql) {
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

  scalar(sql) {
    return Number(this.database.prepare(sql).get().value);
  }

  snapshot() {
    const chunks = this.database.prepare(`
      SELECT source_ref, source_hash, source_span_start, source_span_end,
             source_profile_ref, corpus_profile_ref, corpus_profile_hash, corpus_hash,
             sensitivity, dependency_refs_json, structural_refs_json, aliases_json,
             purpose, source_type, search_text
      FROM kp_static_corpus_chunks
      ORDER BY source_ref
    `).all();
    const fts = this.database.prepare(`
      SELECT source_ref, search_text
      FROM kp_static_corpus_fts
      ORDER BY source_ref
    `).all();
    const meta = this.database.prepare("SELECT * FROM kp_static_corpus_meta WHERE singleton_key = 'active'").get();
    return structuredClone({ chunks, fts, meta });
  }

  close() {
    this.database.close();
  }
}
