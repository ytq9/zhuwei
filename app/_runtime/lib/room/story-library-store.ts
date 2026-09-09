import { canonicalHash } from "../kp/vnext/canonical-json";
import type { StoryHash } from "./story-creation/contracts";
import type { StoryLibraryEntry, StoryLibraryRoom, StoryLibrarySnapshot } from "./story-library-contracts";
import { validateStoryLibraryEntry } from "./story-library";

/** Host-owned immutable manuscripts, in the same Room SQLite transaction.
 * This table stores no NPC state, evolving mapping, invocation or budget. */
export class StoryLibraryStore {
  constructor(private readonly storage: DurableObjectStorage, private readonly room: StoryLibraryRoom,
    private readonly ports: { onMutation?: () => void } = {}) {}

  ensureSchema(): void {
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS story_hosting_library (
      library_ref TEXT PRIMARY KEY, entry_json TEXT NOT NULL
    )`);
  }
  read(libraryRef: string): StoryLibraryEntry | undefined {
    const row = this.storage.sql.exec<{ entry_json: string }>(
      "SELECT entry_json FROM story_hosting_library WHERE library_ref = ?", libraryRef).toArray()[0];
    if (!row) return undefined;
    const entry: unknown = JSON.parse(row.entry_json); validateStoryLibraryEntry(entry, this.room);
    if (entry.libraryRef !== libraryRef) throw new TypeError("STORY_LIBRARY_BINDING_INVALID");
    return entry;
  }
  listEntries(): readonly StoryLibraryEntry[] {
    return this.storage.sql.exec<{ library_ref: string }>("SELECT library_ref FROM story_hosting_library ORDER BY library_ref")
      .toArray().map(row => this.read(row.library_ref)!);
  }
  save(entry: StoryLibraryEntry): { kind: "saved"; entry: StoryLibraryEntry } {
    validateStoryLibraryEntry(entry, this.room);
    return this.storage.transactionSync(() => {
      const previous = this.read(entry.libraryRef);
      if (previous) {
        if (previous.entryHash !== entry.entryHash) throw new TypeError("STORY_LIBRARY_BINDING_INVALID");
        return { kind: "saved", entry: previous };
      }
      this.storage.sql.exec("INSERT INTO story_hosting_library (library_ref, entry_json) VALUES (?, ?)", entry.libraryRef, JSON.stringify(entry));
      this.ports.onMutation?.();
      return { kind: "saved", entry: structuredClone(entry) };
    });
  }
  snapshot(): StoryLibrarySnapshot {
    const body = { format: "zhuwei.story-library-snapshot/v1" as const, room: this.room, entries: this.listEntries() };
    return { ...body, snapshotHash: canonicalHash(body) as StoryHash };
  }
  restore(snapshot: StoryLibrarySnapshot): void {
    const { snapshotHash, ...body } = snapshot;
    if (Object.keys(snapshot).sort().join() !== ["entries", "format", "room", "snapshotHash"].sort().join()
      || snapshot.format !== "zhuwei.story-library-snapshot/v1" || canonicalHash(body) !== snapshotHash
      || canonicalHash(snapshot.room) !== canonicalHash(this.room) || !Array.isArray(snapshot.entries)
      || new Set(snapshot.entries.map(entry => entry.libraryRef)).size !== snapshot.entries.length) throw new TypeError("STORY_LIBRARY_BINDING_INVALID");
    snapshot.entries.forEach(entry => validateStoryLibraryEntry(entry, this.room));
    this.storage.transactionSync(() => {
      if (this.listEntries().length) throw new TypeError("STORY_LIBRARY_BINDING_INVALID");
      snapshot.entries.forEach(entry => this.save(entry));
      if (this.snapshot().snapshotHash !== snapshot.snapshotHash) throw new TypeError("STORY_LIBRARY_BINDING_INVALID");
    });
  }
  clearForRoomDeletion(): void {
    this.storage.transactionSync(() => {
      if (!this.listEntries().length) return;
      this.storage.sql.exec("DELETE FROM story_hosting_library"); this.ports.onMutation?.();
    });
  }
}
