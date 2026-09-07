import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { playTableSnapFixture } from "./fixtures/tactical-map-v2.mjs";
import { projectAuthoritativeTableObservation } from "../app/_runtime/lib/table/authoritative.ts";

function renderedText(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node?.children?.map(renderedText).join("") ?? "";
}

test("the real table shows exact authority wait progress, terminal outcomes and honest technical holds", async () => {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, queryClient;
  try {
    const [{ QueryClient, QueryClientProvider }, { compileSheet }, { PlayTable }, { act, create }] = await Promise.all([
      import("@tanstack/react-query"), import("../app/_runtime/lib/dnd/compute.ts"),
      import("../app/_runtime/components/play-table.tsx"), import("react-test-renderer"),
    ]);
    queryClient = new QueryClient();
    const snap = playTableSnapFixture(compileSheet);
    snap.state.authoritative.inCombat = false;
    snap.state.authoritative.tacticalProjection = null;
    snap.state.fictionTime = { nowMicros: "9000000", branchId: "current-timeline" };
    const activity = { activityId: "activity:waiting", characterId: "character:waiting", kind: "timePassage",
      status: "active", startedAtFictionMicros: "0", intendedDurationMicros: "60000000", progressFictionMicros: "2000000" };
    const cases = [
      [activity, "等待中 · 实际经过 2 秒 / 计划 60 秒"],
      [{ ...activity, status: "completed", endedAtFictionMicros: "60000000" }, "等待已结束 · 实际经过 60 秒 / 计划 60 秒"],
      [{ ...activity, status: "interrupted", endedAtFictionMicros: "2250000", interruptionReason: "actorUnavailable" }, "等待已中断 · 实际经过 2.25 秒 / 计划 60 秒 · 无法继续行动"],
      [{ ...activity, processingState: "blocked" }, "系统尚未完成本次处理，等待尚未完成，已过时间已保留。"],
      [{ ...activity, processingState: "cannotSafelyContinue" }, "系统无法安全继续本次处理，等待尚未完成，已过时间已保留。"],
    ];
    for (const [current, expected] of cases) {
      const observation = { readModel: { kind: "projected", viewer: { kind: "player", principalId: "viewer" }, controlledCharacter: null,
        lifecycle: { kind: "successorRequired", defaultPredecessorCharacterId: current.characterId,
          eligiblePredecessors: [{ characterId: current.characterId, name: "等待者", tenureStatus: "dead" }] }, activities: [current] } };
      // Exercise the direct server DTO before rendering, including the former
      // controller path. It must retain only the public time values.
      const projected = projectAuthoritativeTableObservation({ userId: "viewer", members: ["viewer"], locationLabels: {}, observation });
      snap.state.authoritative.activities = projected.activities;
      const tree = createElement(QueryClientProvider, { client: queryClient }, createElement(PlayTable, { code: "TIME", snap: structuredClone(snap) }));
      await act(async () => { if (renderer) renderer.update(tree); else renderer = create(tree); });
      const status = renderer.root.findAllByProps({ role: "status" }).map(renderedText).join("\n");
      assert.ok(status.includes(expected), status);
      assert.ok(!status.includes("实际经过 9 秒"), "a changed current timeline must not replace the wait's source clock");
    }
  } finally {
    if (renderer) { const { act } = await import("react-test-renderer"); await act(async () => renderer.unmount()); }
    queryClient?.clear();
    if (previous === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
