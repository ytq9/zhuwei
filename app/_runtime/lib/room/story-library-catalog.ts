import { canonicalHash, deepFreeze, isPlainRecord } from "../kp/vnext/canonical-json";
import type { VNextRequiredContext } from "../kp/vnext/required-context";
import type { StoryHash } from "./story-creation/contracts";
import type { StoryAdmissionOwner, StoryLibraryCatalog } from "./story-library-contracts";

/** Pure frozen DTO reader. It cannot import the library journal/lowerer: the
 * proposal selector is initialized before those host capabilities exist. */
export const STORY_LIBRARY_CATALOG_REF = "story-library:catalog";
const hash = (value: unknown) => canonicalHash(value) as StoryHash;
const isHash = (value: unknown): value is StoryHash => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => isPlainRecord(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = (): never => { throw new TypeError("STORY_LIBRARY_BINDING_INVALID"); };
export function validStoryAdmissionOwner(value: unknown): value is StoryAdmissionOwner {
  return exact(value, ["kind", "jobId"]) && value.kind === "creationJob" && typeof value.jobId === "string" && value.jobId.length > 0
    || exact(value, ["kind", "libraryRef"]) && value.kind === "hostingArtifact" && isHash(value.libraryRef);
}

export function storyLibraryCatalog(context: VNextRequiredContext): StoryLibraryCatalog | undefined {
  const rows = context.entries.filter(value => value.entryRef === STORY_LIBRARY_CATALOG_REF);
  if (!rows.length) return undefined;
  const row = rows[0], value = row.kind === "known" ? row.value : undefined;
  if (rows.length !== 1 || row.kind !== "known" || !exact(value, ["format", "room", "offers", "catalogHash"])
    || value.format !== "zhuwei.story-library-catalog/v1" || !Array.isArray(value.offers)
    || row.revisionOrHash !== hash(value) || !context.references.citations.nonCitableRefs.includes(STORY_LIBRARY_CATALOG_REF)) return fail();
  const catalog = value as unknown as StoryLibraryCatalog, { catalogHash, ...body } = catalog;
  if (hash(body) !== catalogHash || catalog.room.runtimeEpochId !== context.binding.roomEpochRef
    || new Set(catalog.offers.map(offer => offer.libraryRef)).size !== catalog.offers.length
    || catalog.offers.some(offer => !exact(offer, ["libraryRef", "opportunityId", "owner", "status", "preparationHash", "title", "centralQuestion", "sceneRefs", "entityRefs"])
      || !isHash(offer.libraryRef) || !validStoryAdmissionOwner(offer.owner)
      || !["preparing", "ready", "rejected", "noStory"].includes(offer.status)
      || !(offer.preparationHash === null || isHash(offer.preparationHash))
      || ![offer.opportunityId, offer.title, offer.centralQuestion].every(value => typeof value === "string" && value.length > 0)
      || ![offer.sceneRefs, offer.entityRefs].every(refs => Array.isArray(refs) && refs.every(value => typeof value === "string" && value.length > 0)))) return fail();
  return deepFreeze(structuredClone(catalog));
}
