import { authorityRevisionOrHash, type AuthoritativeWorldState } from "../../rules/authority-read";
import { canonicalHash, compareCodeUnits, isPlainRecord } from "./canonical-json";
import type { VNextRequiredContext } from "./required-context";

/** The model never needs to name these authorization refs. The server selects
 * the frozen grant and adds its exact authority dependencies to every creation
 * plan, so omitting a basis in the tool call cannot bypass scope validation. */
export function materializationAuthorityBasis(input: Readonly<{
  context: VNextRequiredContext;
  state: AuthoritativeWorldState;
  scopeRef: string | undefined;
  kind: string;
  templateRef?: string;
  /** Registering an Item/Ability definition does not instantiate a thing. */
  createsInstance?: boolean;
}>): Readonly<{ kind: "accepted"; basisRefs: readonly string[] }>
  | Readonly<{ kind: "rejected"; code: "CONTEXT_INSUFFICIENT"; issues: readonly string[] }> {
  const { context, state, scopeRef } = input;
  if (scopeRef === undefined) return denied("materialization:scope-required");
  if (input.createsInstance !== false && context.entries.some((entry) => entry.kind === "knownAbsent"
    && entry.scopeRef === scopeRef && (
      (entry.selector.kind === "semanticKind" && entry.selector.semanticKind === input.kind)
      || (entry.selector.kind === "templateRef" && entry.selector.templateRef === input.templateRef)
      || (entry.selector.kind === "templateFamily" && input.templateRef?.startsWith(`${entry.selector.templateFamily}:`))
    ))) return denied("materialization:active-local-absence-conflict");
  const grants = context.entries.filter((entry) => entry.kind === "openBlank"
    && entry.scopeRef === scopeRef && entry.allowedKinds.includes(input.kind));
  if (grants.length !== 1) return denied("materialization:one-frozen-scope-grant-required");
  const grant = grants[0]!;
  if (grant.kind !== "openBlank") return denied("materialization:scope-grant-invalid");
  const known = new Map(context.entries.flatMap((entry) => entry.kind === "known" ? [[entry.entryRef, entry]] : []));
  const scope = known.get(scopeRef);
  const profile = known.get(grant.authorizationRef);
  if (scope === undefined || profile === undefined || !isPlainRecord(profile.value)
    || !isPlainRecord(profile.value.moduleRef) || !isPlainRecord(profile.value.materializationPermission)) {
    return denied("materialization:grant-authority-not-loaded");
  }
  const moduleRef = profile.value.moduleRef;
  const pinnedModuleRef = state.campaignRuntime.campaign?.moduleRef;
  const declaredKinds = profile.value.materializationPermission.allowedKinds;
  const expectedBasis = [scopeRef, grant.authorizationRef].sort(compareCodeUnits);
  const actualBasis = [...new Set(grant.basisRefs)].sort(compareCodeUnits);
  if (!isPlainRecord(pinnedModuleRef)
    || pinnedModuleRef.profileId !== moduleRef.profileId
    || pinnedModuleRef.profileHash !== moduleRef.profileHash
    || profile.entryRef !== `profile-context:${String(moduleRef.profileId)}`
    || profile.revisionOrHash !== moduleRef.profileHash
    || profile.value.scopeRef !== scopeRef
    || authorityRevisionOrHash(state, scopeRef) !== scope.revisionOrHash
    || !Array.isArray(profile.value.openBlanks) || profile.value.openBlanks.length === 0
    || !Array.isArray(declaredKinds) || !declaredKinds.includes(input.kind)
    || grant.allowedKinds.some((kind) => !declaredKinds.includes(kind))
    || canonicalHash(actualBasis) !== canonicalHash(expectedBasis)
    || grant.authorizationHash !== canonicalHash({
      moduleRef, scopeRef, scopeRevisionOrHash: scope.revisionOrHash,
      allowedKinds: grant.allowedKinds, basisRefs: expectedBasis,
    })) {
    return denied("materialization:grant-binding-invalid-or-stale");
  }
  return { kind: "accepted", basisRefs: expectedBasis };
}

function denied(issue: string) {
  return { kind: "rejected" as const, code: "CONTEXT_INSUFFICIENT" as const, issues: [issue] };
}
