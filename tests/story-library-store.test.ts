import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { canonicalHash } from "../app/_runtime/lib/kp/vnext/canonical-json";
import { StoryLibraryStore } from "../app/_runtime/lib/room/story-library-store";
import { StoryCreationStore } from "../app/_runtime/lib/room/story-creation-store";
import { storyLibraryEntry, buildStoryLibraryCatalogForScope } from "../app/_runtime/lib/room/story-library";
import { buildStoryArchive, validateStoryArchive } from "../app/_runtime/lib/room/story-archive";
import type { StoryHash } from "../app/_runtime/lib/room/story-creation/contracts";
import type { StoryLibraryRoom } from "../app/_runtime/lib/room/story-library-contracts";
import { createStoryAdmissionFixture, CLERK, SCENE, factSelector } from "./fixtures/kp-vnext-story-materialization.mjs";
import { storyLibraryFixture, freezeStoryReuse, admitStoryReuse } from "./fixtures/story-library.mjs";
import { storyArchiveFixture } from "./fixtures/story-archive.mjs";
import { branchStoryLibrary } from "./fixtures/story-library-history.mjs";
import { geometry } from "./fixtures/historical-world.mjs";

const hash = (value: unknown) => canonicalHash(value) as StoryHash;
const stub = (name: string) => env.ROOMS.getByName(`story-library-store-${name}`);
type Stub = ReturnType<typeof stub>;
async function withStores<T>(room: Stub, source: StoryLibraryRoom | (() => StoryLibraryRoom),
  callback: (library: StoryLibraryStore, journal: StoryCreationStore, storage: DurableObjectStorage) => T): Promise<T> {
  return runInDurableObject(room, (_instance, context) => {
    const storage = context.storage;
    const library = new StoryLibraryStore(storage, source);
    const journal = new StoryCreationStore(storage, { hash, now: () => 1_000, library });
    library.ensureSchema(); journal.ensureSchema();
    return callback(library, journal, storage);
  });
}
const quarantine = { enforcement: "hostRequiredBeforeRestoreExposure" as const,
  invocationIds: [] as string[], sourceBudgetAccountIds: [] as string[] };

it("keeps an immutable manuscript across eviction and active-branch changes without offering another branch's material", async () => {
  const f = await createStoryAdmissionFixture("library-sql-immutable", { newNpc: true, definitionOnly: true });
  const fixture = storyLibraryFixture(f), target = stub("immutable");
  let activeRoom = fixture.room;
  const snapshot = await runInDurableObject(target, (_instance, context) => {
    context.storage.sql.exec("CREATE TABLE story_library_mutations (value INTEGER NOT NULL); INSERT INTO story_library_mutations VALUES (0)");
    const library = new StoryLibraryStore(context.storage, () => activeRoom, {
      onMutation: () => { context.storage.sql.exec("UPDATE story_library_mutations SET value = value + 1"); },
    });
    library.ensureSchema();
    expect(library.save(fixture.entry)).toEqual({ kind: "saved", entry: fixture.entry });
    expect(library.save(structuredClone(fixture.entry))).toEqual({ kind: "saved", entry: fixture.entry });
    const changed = structuredClone(fixture.entry.artifact);
    changed.review.findings[0].explanation = "A different review must not replace the saved manuscript under its old identity.";
    const { artifactHash: _artifactHash, ...artifactBody } = changed;
    const edited = storyLibraryEntry(activeRoom, { ...artifactBody, artifactHash: hash(artifactBody) }, fixture.entry.origin);
    expect(() => library.save(edited)).toThrow("STORY_LIBRARY_BINDING_INVALID");
    expect(context.storage.sql.exec<{ value: number }>("SELECT value FROM story_library_mutations").one().value).toBe(1);
    expect(library.read(fixture.entry.libraryRef)).toEqual(fixture.entry);
    activeRoom = { ...activeRoom, branchId: "branch:after-current" };
    expect(library.listEntries()).toEqual([fixture.entry]);
    expect(buildStoryLibraryCatalogForScope({ room: activeRoom, scopeRefs: [SCENE], entries: library.listEntries(), jobs: [] }).offers).toEqual([]);
    return library.snapshot();
  });
  await evictDurableObject(target);
  await withStores(target, () => activeRoom, (library, journal) => {
    expect(library.snapshot()).toEqual(snapshot);
    expect(journal.listCreationJobs()).toEqual([]);
    expect(journal.readBudget(f.request.source.budgetAccountId)).toBeUndefined();
  });
  await withStores(stub("immutable-restore"), activeRoom, library => {
    library.restore(snapshot);
    expect(library.snapshot()).toEqual(snapshot);
    expect(() => library.restore(snapshot)).toThrow("STORY_LIBRARY_BINDING_INVALID");
  });
  await withStores(stub("immutable-wrong-room"), { ...activeRoom, roomId: "room:unrelated" }, library => {
    expect(() => library.restore(snapshot)).toThrow("STORY_LIBRARY_BINDING_INVALID");
    expect(library.isEmpty()).toBe(true);
  });
});

it("rolls library saves and mutation markers back with the owning Room SQLite transaction", async () => {
  const f = await createStoryAdmissionFixture("library-sql-rollback", { newNpc: true, definitionOnly: true });
  const fixture = storyLibraryFixture(f);
  await runInDurableObject(stub("rollback"), (_instance, context) => {
    const storage = context.storage;
    storage.sql.exec("CREATE TABLE story_library_mutations (value INTEGER NOT NULL); INSERT INTO story_library_mutations VALUES (0)");
    const library = new StoryLibraryStore(storage, fixture.room, {
      onMutation: () => { storage.sql.exec("UPDATE story_library_mutations SET value = value + 1"); },
    });
    library.ensureSchema();
    expect(() => storage.transactionSync(() => {
      library.save(fixture.entry);
      throw new Error("outer Room initialization interrupted");
    })).toThrow("outer Room initialization interrupted");
    expect(library.isEmpty()).toBe(true);
    expect(storage.sql.exec<{ value: number }>("SELECT value FROM story_library_mutations").one().value).toBe(0);
    library.save(fixture.entry); library.clearForRoomDeletion(); library.clearForRoomDeletion();
    expect(library.isEmpty()).toBe(true);
    expect(storage.sql.exec<{ value: number }>("SELECT value FROM story_library_mutations").one().value).toBe(2);
  });
});

it("restores a historical manuscript and later actual NPC fact admission without cloning a generation job or budget", async () => {
  const remote = "scene:library:sql-remote";
  const f = await createStoryAdmissionFixture("library-sql-history", { newNpc: true, definitionOnly: true,
    worldOptions: { additionalScenes: [{ id: remote, name: "异地档案馆", geometry: geometry() }], characterScenes: { [CLERK]: remote } } });
  const source = await storyArchiveFixture("library-sql-history", true, f);
  const built = await buildStoryArchive(source.input, source.ports);
  if (built.kind !== "prepared") throw new Error(JSON.stringify(built));
  const validated = await validateStoryArchive(built.envelope, source.ports);
  if (validated.kind !== "validated") throw new Error(JSON.stringify(validated));
  const branch = await branchStoryLibrary(f, validated, "sql-history", { focusSceneId: remote });
  const fixture = storyLibraryFixture(branch.target, branch.entries), entry = branch.entries[0], target = stub("historical");
  const currentSource = { roomId: branch.room.roomId, runtimeEpochId: branch.room.runtimeEpochId };
  const baseline = await withStores(target, branch.room, (library, journal) => {
    library.save(entry);
    expect(journal.exportHistoryMaterials()).toMatchObject({ kind: "available", preparations: [{ recordedAtEventSeq: "0",
      definitions: f.admission.definitions, facts: [] }] });
    const saved = journal.archiveSnapshot(currentSource);
    if (saved.kind !== "available") throw new Error(JSON.stringify(saved));
    for (const name of ["accounts", "jobs", "invocations", "admissions"] as const) expect(saved.snapshot[name]).toEqual([]);
    expect(saved.snapshot.hostingArtifacts).toEqual(branch.entries);
    return library.snapshot();
  });
  await evictDurableObject(target);
  const frozen = freezeStoryReuse(branch.target, fixture);
  const actual = admitStoryReuse(branch.target, fixture, frozen, [factSelector(branch.target)]);
  const { bindingHash: _bindingHash, ...body } = actual.binding;
  const saved = await withStores(target, branch.room, (library, journal, storage) => {
    expect(library.snapshot()).toEqual(baseline);
    expect(journal.prepareAdmission(body)).toEqual({ kind: "saved", binding: actual.binding });
    expect(() => storage.transactionSync(() => {
      expect(journal.recordAdmission(actual.admission).kind).toBe("saved");
      throw new Error("outer fact commit interrupted");
    })).toThrow("outer fact commit interrupted");
    expect(journal.readAdmissions(actual.admission.owner)).toEqual([]);
    expect(journal.recordAdmission(actual.admission)).toEqual({ kind: "saved", admission: actual.admission });
    expect(journal.recordAdmission(actual.admission)).toEqual({ kind: "saved", admission: actual.admission });
    const archived = journal.archiveSnapshot(currentSource);
    if (archived.kind !== "available") throw new Error(JSON.stringify(archived));
    expect(archived.snapshot.jobs).toEqual([]); expect(archived.snapshot.accounts).toEqual([]); expect(archived.snapshot.invocations).toEqual([]);
    return { snapshot: archived.snapshot, library: library.snapshot(), materials: journal.exportHistoryMaterials() };
  });
  await evictDurableObject(target);
  await withStores(target, branch.room, (library, journal) => {
    expect(library.snapshot()).toEqual(saved.library);
    expect(journal.archiveSnapshot(currentSource)).toEqual({ kind: "available", snapshot: saved.snapshot });
  });
  await withStores(stub("historical-restore"), branch.room, (library, journal, storage) => {
    expect(journal.restoreArchiveSnapshot({ source: currentSource, snapshot: saved.snapshot, quarantine }).kind).toBe("rejected");
    expect(journal.isEmpty()).toBe(true);
    expect(() => storage.transactionSync(() => {
      library.restore(saved.library);
      expect(journal.restoreArchiveSnapshot({ source: currentSource, snapshot: saved.snapshot, quarantine }).kind).toBe("restored");
      throw new Error("outer history restore interrupted");
    })).toThrow("outer history restore interrupted");
    expect(library.isEmpty()).toBe(true); expect(journal.isEmpty()).toBe(true);
    storage.transactionSync(() => {
      library.restore(saved.library);
      expect(journal.restoreArchiveSnapshot({ source: currentSource, snapshot: saved.snapshot, quarantine }).kind).toBe("restored");
    });
    expect(journal.exportHistoryMaterials()).toEqual(saved.materials);
    expect(journal.readAdmissions(actual.admission.owner)).toEqual([actual.admission]);
    expect(journal.archiveSnapshot(currentSource)).toEqual({ kind: "available", snapshot: saved.snapshot });
    expect(library.snapshot()).toEqual(saved.library);
    expect(journal.prepareAdmission(body)).toEqual({ kind: "saved", binding: actual.binding });
    expect(journal.recordAdmission(actual.admission)).toEqual({ kind: "saved", admission: actual.admission });
  });
});
