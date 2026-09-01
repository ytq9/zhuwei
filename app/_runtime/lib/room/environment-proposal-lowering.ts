import {
  project as projectAuthoritative,
  type AuthoritativeWorldState,
  type PlayerViewer,
  type RuntimeProfileManifest,
} from "../rules";
import {
  buildCustomEnvironmentFeatureDefinition,
} from "../rules/profiles/environment-definition-builder";
import { customEnvironmentDefinitionInputFromDraft } from "../rules/profiles/environment-form-lowering";
import {
  compileEnvironmentFeature,
  ENVIRONMENT_PROFILE,
} from "../rules/profiles/environment";
import { archiveSha256 as authorityHash } from "./archive";
import type { AuthorityCommitOutcome, JsonObject } from "./authority-types";
import { ownedEnvironmentAttackAbilityRef } from "./proposal-adapter";

type JsonRecord = Record<string, unknown>;

type DynamicEnvironmentProposalActor = {
  inputKind: string;
  rootActionId: string;
  principalId: string;
  characterId: string;
  viewer: PlayerViewer | undefined;
};

type DynamicEnvironmentProposalLowering =
  | { input: JsonRecord }
  | { rejection: Extract<AuthorityCommitOutcome, { kind: "rejected" }> };

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function rejectedAuthority(
  code: string,
  explanation: string,
): Extract<AuthorityCommitOutcome, { kind: "rejected" }> {
  return { kind: "rejected", code, explanation };
}

function environmentStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(nonEmptyString) : [];
}

function environmentFeatureCandidates(
  state: AuthoritativeWorldState,
  sceneId: string,
): JsonRecord[] {
  const scene = state.combatRuntime.scenes[sceneId];
  const geometry = isJsonRecord(scene) && isJsonRecord(scene.geometry)
    ? scene.geometry
    : undefined;
  if (!Array.isArray(geometry?.obstacles)) return [];
  return geometry.obstacles.filter(isJsonRecord).filter((feature) => {
    if (!isJsonRecord(feature.environment)
      || !isJsonRecord(feature.environment.featureDefinition)) return false;
    const compiled = compileEnvironmentFeature(feature.environment.featureDefinition);
    return compiled.ok
      && compiled.artifact.tacticalFeature.featureId === feature.featureId
      && compiled.artifact.tacticalFeature.environment.profile.profileId
        === ENVIRONMENT_PROFILE.profileId
      && compiled.artifact.tacticalFeature.environment.profile.profileHash
        === ENVIRONMENT_PROFILE.profileHash
      && compiled.artifact.tacticalFeature.environment.featureDefinition.sceneId === sceneId;
  });
}

function selectEstablishedEnvironmentFeature(
  state: AuthoritativeWorldState,
  sceneId: string,
  draft: JsonRecord,
): string | undefined {
  const candidates = environmentFeatureCandidates(state, sceneId);
  const basisRefs = new Set(environmentStringList(draft.basisRefs));
  const referenced = candidates.filter((feature) =>
    nonEmptyString(feature.featureId) && basisRefs.has(feature.featureId));
  if (referenced.length === 1) return referenced[0]!.featureId as string;
  return undefined;
}

/**
 * Binds one normalized dynamic environment proposal to the trusted Room
 * actor/root and lowers it into the exact current Rules input. This Module
 * performs no storage writes, randomness, or event submission.
 */
export async function lowerDynamicEnvironmentProposal(input: {
  proposal: JsonObject;
  profiles: RuntimeProfileManifest;
  state: AuthoritativeWorldState;
  actor: DynamicEnvironmentProposalActor;
}): Promise<DynamicEnvironmentProposalLowering> {
  const { actor, profiles, proposal, state } = input;
  if (
    (actor.inputKind !== "intent" && actor.inputKind !== "answer")
    || proposal.environmentProgramVersion !== ENVIRONMENT_PROFILE.profileId
    || !nonEmptyString(proposal.formProgramHash)
    || !isJsonRecord(proposal.draft)
    || !isJsonRecord(proposal.causalActionProgram)
    || !nonEmptyString(proposal.actionLanguageRef)
    || !nonEmptyString(proposal.actionLanguageHash)
    || proposal.formProgramHash !== proposal.causalActionProgram.semanticHash
  ) {
    return {
      rejection: rejectedAuthority(
        "invalidMechanicalProposal",
        "The dynamic environment proposal is not bound to the installed Rules Profile.",
      ),
    };
  }
  const entity = state.entities[actor.characterId];
  const sceneId = nonEmptyString(entity?.sceneId) ? entity.sceneId : undefined;
  if (sceneId === undefined) {
    return {
      rejection: rejectedAuthority(
        "privateOrUnknownReference",
        "The acting character has no authoritative environment scene.",
      ),
    };
  }
  const draft = proposal.draft;
  const disposition = draft.featureDisposition;
  let featureId: string;
  let featureDefinition: ReturnType<typeof buildCustomEnvironmentFeatureDefinition> | undefined;
  if (disposition === "reuse-existing") {
    const selected = selectEstablishedEnvironmentFeature(state, sceneId, draft);
    if (selected === undefined) {
      return {
        rejection: rejectedAuthority(
          "privateOrUnknownReference",
          "The KP proposal did not resolve to exactly one established environment feature.",
        ),
      };
    }
    featureId = selected;
  } else if (disposition === "reasonable-open-blank") {
    const basisRefs = environmentStringList(draft.basisRefs);
    const actorProjection = actor.viewer === undefined
      ? undefined
      : projectAuthoritative(profiles, state, actor.viewer);
    const visibleFactIds = actorProjection?.kind === "projected"
      && "visibleFacts" in actorProjection
      ? new Set(actorProjection.visibleFacts.map((fact) => fact.id))
      : new Set<string>();
    const basisAvailable = basisRefs.length > 0 && basisRefs.every((reference) =>
      reference === sceneId || visibleFactIds.has(reference));
    if (!basisAvailable) {
      return {
        rejection: rejectedAuthority(
          "privateOrUnknownReference",
          "The KP-frozen custom environment basis is unavailable to the acting character.",
        ),
      };
    }
    const digest = await authorityHash({
      rootActionId: actor.rootActionId,
      sceneId,
      formProgramHash: proposal.formProgramHash,
    });
    featureId = `feature:v3:${digest.slice("sha256:".length, "sha256:".length + 32)}`;
    try {
      featureDefinition = buildCustomEnvironmentFeatureDefinition(
        customEnvironmentDefinitionInputFromDraft({ draft, featureId, sceneId }),
      );
    } catch {
      return {
        rejection: rejectedAuthority(
          "invalidMechanicalProposal",
          "The KP-frozen custom environment definition failed the installed Rules compiler.",
        ),
      };
    }
  } else {
    return {
      rejection: rejectedAuthority(
        "invalidMechanicalProposal",
        "The environment feature disposition is unavailable.",
      ),
    };
  }

  let activation: JsonObject;
  let abilityRef: string | undefined;
  if (draft.activation === "attack") {
    abilityRef = ownedEnvironmentAttackAbilityRef(state, actor.characterId, draft);
    if (abilityRef === undefined) {
      return {
        rejection: rejectedAuthority(
          "privateOrUnknownReference",
          "The KP proposal did not supply an owned authoritative attack compatible with this activation.",
        ),
      };
    }
    activation = { kind: "attack" };
  } else if (draft.activation === "check") {
    activation = {
      kind: "check",
      ability: draft.checkAbility as string,
      skill: draft.checkSkill as string,
      dc: String(draft.checkDc),
      mode: draft.checkMode as string,
    };
  } else if (draft.activation === "direct") {
    activation = { kind: "direct" };
  } else {
    return {
      rejection: rejectedAuthority(
        "invalidMechanicalProposal",
        "The environment activation is unavailable.",
      ),
    };
  }
  return {
    input: {
      kind: "invokeEnvironmentalStunt",
      rootActionId: actor.rootActionId,
      controllerPrincipalId: actor.principalId,
      actorCharacterId: actor.characterId,
      featureId,
      actionLanguageRef: proposal.actionLanguageRef,
      actionLanguageHash: proposal.actionLanguageHash,
      causalActionProgram: structuredClone(proposal.causalActionProgram),
      activation,
      ...(abilityRef === undefined ? {} : { abilityRef }),
      ...(draft.resourceRef === undefined
        ? {}
        : {
            resourceCost: {
              resourceRef: draft.resourceRef,
              amount: draft.resourceAmount,
            },
          }),
      ...(featureDefinition === undefined
        ? {}
        : { materialization: { featureDefinition } }),
    },
  };
}
