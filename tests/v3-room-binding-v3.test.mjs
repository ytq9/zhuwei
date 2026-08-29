import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AUTHORITATIVE_KP_PROFILES,
  V3_KP_WORKFLOW_MANIFEST_JSON,
  V4_KP_WORKFLOW_MANIFEST_JSON,
  isV3AuthoritativeKpProfile,
} from "../app/_runtime/lib/kp/authoritative-policy.ts";
import { DISABLED_CONTEXT_PLANNER_PROFILE_REF } from "../app/_runtime/lib/kp/model-registry.ts";
import { authoritativeModuleProfile } from "../app/_runtime/lib/module/authoritative.ts";
import {
  ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
  ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
} from "../app/_runtime/lib/rules/profiles/manifests.ts";
import { AUTHORITATIVE_RULESET_VERSION } from "../app/_runtime/lib/rules/ruleset.ts";
import { validateV3RoomBinding } from "../app/_runtime/lib/room/v3-binding.ts";

const V3_PROFILE = AUTHORITATIVE_KP_PROFILES.find(isV3AuthoritativeKpProfile);
const OTHER_V3_PROFILE = AUTHORITATIVE_KP_PROFILES.find((profile) =>
  isV3AuthoritativeKpProfile(profile)
  && profile.modelProfileVersion !== V3_PROFILE?.modelProfileVersion);
const HISTORICAL_PROFILE = AUTHORITATIVE_KP_PROFILES.find((profile) =>
  !isV3AuthoritativeKpProfile(profile));

assert.ok(V3_PROFILE);
assert.ok(OTHER_V3_PROFILE);
assert.ok(HISTORICAL_PROFILE);

const MODULE_PROFILE = await authoritativeModuleProfile("black-oak-will");

function binding() {
  return {
    ruleset_version: AUTHORITATIVE_RULESET_VERSION,
    module_id: MODULE_PROFILE.moduleId,
    host_user_id: "principal:host",
    kp_model: V3_PROFILE.modelId,
    kp_model_profile: V3_PROFILE.modelProfileVersion,
    kp_workflow_manifest: V3_KP_WORKFLOW_MANIFEST_JSON,
    kp_context_planner_profile: DISABLED_CONTEXT_PLANNER_PROFILE_REF,
  };
}

function observation() {
  return {
    kind: "observed",
    readModel: {
      runtimeProfiles: structuredClone(ENVIRONMENT_RUNTIME_PROFILE_MANIFEST),
      campaign: { moduleRef: structuredClone(MODULE_PROFILE.moduleRef) },
    },
  };
}

function validate(overrides = {}) {
  return validateV3RoomBinding({
    binding: binding(),
    roomProfile: V3_PROFILE,
    requestedProfile: V3_PROFILE,
    expectedModuleRef: MODULE_PROFILE.moduleRef,
    observation: observation(),
    ...overrides,
  });
}

test("V3 correction and party binding accepts only the complete frozen workflow/runtime/module set", () => {
  assert.deepEqual(validate(), { kind: "valid" });

  const cases = [
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

test("old and new V3 workflows bind only to their exact environment manifest generation", () => {
  const oldBinding = binding();
  const oldObservation = observation();
  assert.deepEqual(validate({ binding: oldBinding, observation: oldObservation }), { kind: "valid" });

  const newBinding = {
    ...binding(),
    kp_workflow_manifest: V4_KP_WORKFLOW_MANIFEST_JSON,
  };
  const newObservation = {
    kind: "observed",
    readModel: {
      runtimeProfiles: structuredClone(ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST),
      campaign: { moduleRef: structuredClone(MODULE_PROFILE.moduleRef) },
    },
  };
  assert.deepEqual(validate({ binding: newBinding, observation: newObservation }), { kind: "valid" });
  assert.deepEqual(validate({ binding: oldBinding, observation: newObservation }), {
    kind: "invalid",
    violation: "runtimeManifest",
  });
  assert.deepEqual(validate({ binding: newBinding, observation: oldObservation }), {
    kind: "invalid",
    violation: "runtimeManifest",
  });
});

test("V3 missing projection and caller/room profile disagreement fail with stable reasons", () => {
  assert.deepEqual(validate({ observation: undefined }), {
    kind: "invalid",
    violation: "runtimeManifest",
  });
  assert.deepEqual(validate({ requestedProfile: OTHER_V3_PROFILE }), {
    kind: "invalid",
    violation: "modelProfile",
  });
  assert.deepEqual(validate({ expectedModuleRef: undefined }), {
    kind: "invalid",
    violation: "module",
  });
});

test("historical profiles remain outside the V3 workflow/runtime gate", () => {
  const historicalBinding = {
    ...binding(),
    kp_model: HISTORICAL_PROFILE.modelId,
    kp_model_profile: HISTORICAL_PROFILE.modelProfileVersion,
    kp_workflow_manifest: null,
    kp_context_planner_profile: null,
  };
  assert.deepEqual(validateV3RoomBinding({
    binding: historicalBinding,
    roomProfile: HISTORICAL_PROFILE,
  }), { kind: "historical" });

  for (const mutate of [
    (candidate) => {
      candidate.kp_workflow_manifest = "{\"kind\":\"partial-v3\"}";
    },
    (candidate) => {
      candidate.kp_workflow_manifest = V3_KP_WORKFLOW_MANIFEST_JSON;
    },
    (candidate) => {
      candidate.kp_context_planner_profile = "planner:partial-v3";
    },
    (candidate) => {
      candidate.kp_model_profile = V3_PROFILE.modelProfileVersion;
    },
  ]) {
    const candidate = structuredClone(historicalBinding);
    mutate(candidate);
    assert.equal(validateV3RoomBinding({
      binding: candidate,
      roomProfile: HISTORICAL_PROFILE,
    }).kind, "invalid");
  }
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

  for (const section of [correction, party]) {
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

  const actionStart = server.indexOf("export async function runAuthoritativeRoomAction");
  const actionEnd = server.indexOf("export async function retryAuthoritativeViewerNarration", actionStart);
  const action = server.slice(actionStart, actionEnd);
  assert.match(action, /if \(v3Binding\.kind === "invalid"\)/u);

  const tableServer = await readFile(
    new URL("../app/_runtime/lib/table/server.ts", import.meta.url),
    "utf8",
  );
  const startGame = tableServer.slice(
    tableServer.indexOf("export const startGame"),
    tableServer.indexOf("export const sendAction"),
  );
  assert.match(startGame, /claimsV3RoomBinding/u);
  assert.match(startGame, /canonicalJson\(initialized\.runtimeProfiles\)/u);
  assert.ok(
    startGame.indexOf("canonicalJson(initialized.runtimeProfiles)")
      < startGame.indexOf('set status = ${"play"}'),
  );
});
