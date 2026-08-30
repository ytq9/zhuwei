import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AUTHORITATIVE_KP_PROFILES,
  PRIVATE_FORM_NARROW_TOOLS_PROTOCOL_PROFILE,
  PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST,
  PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON,
  isV3AuthoritativeKpProfile,
  runtimeManifestForExactV3KpWorkflow,
} from "../app/_runtime/lib/kp/authoritative-policy.ts";
import { DISABLED_CONTEXT_PLANNER_PROFILE_REF } from "../app/_runtime/lib/kp/model-registry.ts";
import { authoritativeModuleProfile } from "../app/_runtime/lib/module/authoritative.ts";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests.ts";
import { AUTHORITATIVE_RULESET_VERSION } from "../app/_runtime/lib/rules/ruleset.ts";
import { validateV3RoomBinding } from "../app/_runtime/lib/room/v3-binding.ts";

const CURRENT_PROFILE = AUTHORITATIVE_KP_PROFILES.find(isV3AuthoritativeKpProfile);
const OTHER_CURRENT_PROFILE = AUTHORITATIVE_KP_PROFILES.find((profile) =>
  isV3AuthoritativeKpProfile(profile)
  && profile.modelProfileVersion !== CURRENT_PROFILE?.modelProfileVersion);

assert.ok(CURRENT_PROFILE);
assert.ok(OTHER_CURRENT_PROFILE);

const MODULE_PROFILE = await authoritativeModuleProfile("black-oak-will");

function binding() {
  return {
    ruleset_version: AUTHORITATIVE_RULESET_VERSION,
    module_id: MODULE_PROFILE.moduleId,
    host_user_id: "principal:host",
    kp_model: CURRENT_PROFILE.modelId,
    kp_model_profile: CURRENT_PROFILE.modelProfileVersion,
    kp_workflow_manifest: PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON,
    kp_context_planner_profile: DISABLED_CONTEXT_PLANNER_PROFILE_REF,
  };
}

function observation() {
  return {
    kind: "observed",
    readModel: {
      runtimeProfiles: structuredClone(ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST),
      campaign: { moduleRef: structuredClone(MODULE_PROFILE.moduleRef) },
    },
  };
}

function validate(overrides = {}) {
  return validateV3RoomBinding({
    binding: binding(),
    roomProfile: CURRENT_PROFILE,
    requestedProfile: CURRENT_PROFILE,
    expectedModuleRef: MODULE_PROFILE.moduleRef,
    observation: observation(),
    ...overrides,
  });
}

test("V3 correction and party binding accepts only the complete frozen workflow/runtime/module set", () => {
  assert.deepEqual(validate(), { kind: "valid" });

  const cases = [
    ["modelProfile", (value) => {
      value.binding.ruleset_version = "retired-ruleset";
    }],
    ["modelProfile", (value) => {
      value.binding.kp_model = "retired-model";
    }],
    ["modelProfile", (value) => {
      value.binding.kp_model_profile = "retired-profile";
    }],
    ["workflow", (value) => {
      value.binding.kp_workflow_manifest = null;
    }],
    ["planner", (value) => {
      value.binding.kp_context_planner_profile = "planner:unapproved";
    }],
    ["runtimeManifest", (value) => {
      value.observation.readModel.runtimeProfiles.ruleset.profileHash = `sha256:${"0".repeat(64)}`;
    }],
    ["runtimeManifest", (value) => {
      value.observation.readModel.runtimeProfiles.geometry.profileId = "geometry:forged";
    }],
    ["runtimeManifest", (value) => {
      value.observation.readModel.runtimeProfiles.eventSchema.profileHash = `sha256:${"1".repeat(64)}`;
    }],
    ["runtimeManifest", (value) => {
      value.observation.readModel.runtimeProfiles.extensions = [];
    }],
    ["module", (value) => {
      value.observation.readModel.campaign.moduleRef.profileHash = `sha256:${"2".repeat(64)}`;
    }],
  ];

  for (const [violation, mutate] of cases) {
    const value = {
      binding: binding(),
      observation: observation(),
    };
    mutate(value);
    assert.deepEqual(validate(value), { kind: "invalid", violation });
  }
});

test("current private-tool protocol and workflow hashes freeze the exact tool/runtime binding", () => {
  assert.equal(
    PRIVATE_FORM_NARROW_TOOLS_PROTOCOL_PROFILE.protocolHash,
    "fnv1a64:8754253b2593e263",
  );
  assert.equal(PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST.workflowHash, "fnv1a64:076a3f9a1e2e2330");
  assert.equal(
    PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST.proposalProtocolRef,
    PRIVATE_FORM_NARROW_TOOLS_PROTOCOL_PROFILE.protocolRef,
  );
  assert.equal(
    PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST.proposalProtocolHash,
    PRIVATE_FORM_NARROW_TOOLS_PROTOCOL_PROFILE.protocolHash,
  );
  assert.deepEqual(
    runtimeManifestForExactV3KpWorkflow(PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON),
    ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
  );
  assert.equal(
    runtimeManifestForExactV3KpWorkflow(`${PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON} `),
    undefined,
  );
});

test("V3 missing projection and caller/room profile disagreement fail with stable reasons", () => {
  assert.deepEqual(validate({ observation: undefined }), {
    kind: "invalid",
    violation: "runtimeManifest",
  });
  assert.deepEqual(validate({ requestedProfile: OTHER_CURRENT_PROFILE }), {
    kind: "invalid",
    violation: "modelProfile",
  });
  assert.deepEqual(validate({ expectedModuleRef: undefined }), {
    kind: "invalid",
    violation: "module",
  });
});

test("correction and party reject V3 binding failures before constructing a model adapter", async () => {
  const server = await readFile(
    new URL("../app/_runtime/lib/room/server.ts", import.meta.url),
    "utf8",
  );
  const correctionStart = server.indexOf("export async function runAuthoritativeRoomCorrection");
  const correctionEnd = server.indexOf("async function executeAuthoritativeRoomAction", correctionStart);
  const correction = server.slice(correctionStart, correctionEnd);
  const partyStart = server.indexOf("export async function runAuthoritativePartyAction");
  const partyEnd = server.indexOf("export function observeAuthoritativeRoom", partyStart);
  const party = server.slice(partyStart, partyEnd);
  const actionStart = server.indexOf("export async function runAuthoritativeRoomAction");
  const actionEnd = server.indexOf("export async function retryAuthoritativeViewerNarration", actionStart);
  const action = server.slice(actionStart, actionEnd);
  const retryStart = actionEnd;
  const retryEnd = server.indexOf("export type AuthoritativeRoomCorrectionInput", retryStart);
  const retry = server.slice(retryStart, retryEnd);

  for (const section of [action, retry, correction, party]) {
    const validation = section.indexOf("validateV3RoomBinding");
    const rejection = section.indexOf("v3BindingRejection", validation);
    const adapter = section.indexOf("createAuthoritativeKpAdapter", validation);
    assert.notEqual(validation, -1);
    assert.notEqual(rejection, -1);
    assert.notEqual(adapter, -1);
    assert.ok(validation < rejection && rejection < adapter);
  }
  const partyLookup = party.indexOf("const sql = await getSql()");
  const unknownRequestedProfile = party.indexOf("if (requestedProfile === undefined)");
  const stableUnknownRejection = party.indexOf("return v3BindingRejection()", unknownRequestedProfile);
  assert.ok(partyLookup < unknownRequestedProfile);
  assert.ok(unknownRequestedProfile < stableUnknownRejection);

  assert.match(action, /v3Binding\.kind === "invalid"/u);
  assert.doesNotMatch(action, /productionContext === undefined/u);
  assert.match(retry, /expectedModuleRef/u);
  assert.match(retry, /observation/u);
  assert.doesNotMatch(retry, /hasExactV3KpWorkflowManifest/u);
  assert.doesNotMatch(correction, /correctionRequiresV3Binding/u);
  assert.doesNotMatch(party, /partyRequiresV3Binding|persistedRoomClaimsV3|\?\? await/u);

  const tableServer = await readFile(
    new URL("../app/_runtime/lib/table/server.ts", import.meta.url),
    "utf8",
  );
  const startGame = tableServer.slice(
    tableServer.indexOf("export const startGame"),
    tableServer.indexOf("export const sendAction"),
  );
  assert.match(startGame, /hasExactV3KpWorkflowManifest/u);
  assert.match(startGame, /canonicalJson\(initialized\.runtimeProfiles\)/u);
  assert.ok(
    startGame.indexOf("canonicalJson(initialized.runtimeProfiles)")
      < startGame.indexOf('set status = ${"play"}'),
  );
});
