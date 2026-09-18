import { describe, expect, it } from "vitest";

import { canonicalSha256 } from "../../../app/_runtime/lib/rules/profiles/canonical";
import { isCampaignContinuityManifest } from "../../../app/_runtime/lib/rules/v2/campaign-continuity";

describe("chapter continuity manifest responsibility", () => {
  it("accepts the current v2 shape and rejects the retired v1 shape", () => {
    const v2Core = {
      schema: "zhuwei.campaign-continuity-manifest/v2",
      characterStates: [],
      itemStates: [],
      knowledgeStates: [],
      relationshipStates: [],
      debtStates: [],
      promiseStates: [],
      activityStates: [],
      canonicalFactStates: [],
      definitionStates: [],
      precedentStates: [],
      combatEffectStates: [],
      fictionTimelineStates: [],
      causalFrontierStates: [],
      unresolvedThreatRefs: [],
      activityTransitions: [],
      actorPlanStates: [],
      factionPlanStates: [],
    };
    expect(isCampaignContinuityManifest({
      ...v2Core,
      manifestHash: canonicalSha256(v2Core),
    })).toBe(true);

    const v1Body = Object.fromEntries(Object.entries(v2Core).filter(([key]) =>
      key !== "actorPlanStates" && key !== "factionPlanStates"));
    const v1Core = {
      ...v1Body,
      schema: "zhuwei.campaign-continuity-manifest/v1",
    };
    expect(isCampaignContinuityManifest({
      ...v1Core,
      manifestHash: canonicalSha256(v1Core),
    })).toBe(false);
  });

});
