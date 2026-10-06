import type { RuntimeProfileManifest } from "../profiles/types";
import type { ItemDefinitionV1, InitialItemEntryInput } from "./items";

export const CONTAINER_EVENT_PROFILE_ID = "room-world-events-vnext-stage3-v6";
export const CONTAINER_RUNTIME_PROFILE_ID = "runtime-srd51-2014-authoritative-vnext-stage3-v8";
/** Versioned definition identities, not labels or newly edited legacy catalog
 * data. Existing catalogs and their replay checksums remain unchanged. */
export const UNRESTRICTED_STANDARD_CONTAINER_REFS = Object.freeze([
  "item-definition:standard-gear:backpack:2", "item-definition:standard-gear:dark-cloak-bag:2",
  "item-definition:standard-gear:sand-pouch:2",
]);
export function unrestrictedContainerDefinition(definition: ItemDefinitionV1): boolean {
  return definition.content.tags.includes("container:unrestricted")
    || definition.content.tags.includes("standard-gear") && UNRESTRICTED_STANDARD_CONTAINER_REFS.includes(definition.definitionId);
}
export function initialContainerState(profiles: RuntimeProfileManifest | undefined, definition: ItemDefinitionV1,
  initialState?: InitialItemEntryInput["initialState"]): InitialItemEntryInput["initialState"] {
  return initialState ?? (profiles?.eventSchema.profileId === CONTAINER_EVENT_PROFILE_ID && unrestrictedContainerDefinition(definition) ? "absent" : undefined);
}
export function initialContainerStateForRuntime(runtimeRef: { profileId: string } | undefined, definition: ItemDefinitionV1): InitialItemEntryInput["initialState"] {
  return runtimeRef?.profileId === CONTAINER_RUNTIME_PROFILE_ID && unrestrictedContainerDefinition(definition) ? "absent" : undefined;
}
