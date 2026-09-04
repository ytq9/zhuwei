import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * SPEC 0001 section 21 lists fifteen acceptance scenarios and says the test
 * form is left to a later implementation spec. This is that form.
 *
 * It is deliberately a registry rather than fifteen new tests. Most of these
 * behaviours are already asserted somewhere in this suite -- they were simply
 * never tied back to the scenario that demands them, so nobody could say which
 * of A–O held and which did not. The registry names the assertions, this file
 * proves those assertions still exist, and a scenario with no assertion has to
 * say so out loud instead of passing quietly.
 *
 * Each scenario is read as two halves, because they fail in different ways
 * and are fixed by different work.
 *
 * The MECHANICAL half is what the system enforces whatever the model says.
 * `covers` names the tests that assert it; `pending` says what is missing
 * when nothing does. That is the half the three counts below measure.
 *
 * The JUDGEMENT half is what only a ruling can settle -- whether a DC was
 * honestly chosen, whether a roll was worth asking for. No schema polices it,
 * so `judgement` states it and either `probe` names the behaviour probe that
 * measures it or `probePending` says why none exists yet. Exactly one, so a
 * judgement half is never silently unaccounted for.
 *
 * Two scenarios are worth reading twice, because their open half sounds like
 * a missing guard and is not one. G's second layer of trap and M's spotlight
 * switch take the KP as their subject, not the kernel: a dungeon may hold two
 * traps, and where a decision point falls is a reading of the fiction.
 * Enforcing either in code would reject correct content, so neither is a gap
 * this file can close, and calling them gaps would send the next reader to
 * write a guard that should not exist.
 */
const SPEC_PATH = new URL(
  "../docs/specs/0001-llm-kp-responsibility-contract.md",
  import.meta.url,
);

const SCENARIOS = [
  {
    id: "A",
    demand: "接受模组未登记但合理的方法，不得仅因没有对应 Interaction 就拒绝",
    covers: [
      {
        file: "tests/kp-vnext-stage3-room.test.ts",
        name: "lowers a vnext-2 Bundle: materializes a new scene object and interacts with it through its prospective handle as one atomic Rules transaction, never partially",
      },
    ],
    judgement: "方法是否『合理』由模型判断",
    probePending:
      "探针目前只覆盖 B 与 H。A 需要一道『模组未登记但合理』与"
      + "『模组未登记且不合理』难以混淆的题面，尚未构造。",
  },
  {
    id: "B",
    demand: "当前不可能的行动要明说不可行并留出替代路径，不得设置虚假高 DC",
    covers: [
      {
        file: "tests/kp-vnext-proposal-schema.test.mjs",
        name: "a refusal cannot carry a check, which is what scenario B forbids",
      },
      {
        file: "tests/kp-vnext-proposal-schema.test.mjs",
        name: "a wire refusal decodes and validates as a terminal bundle",
      },
      {
        file: "tests/kp-vnext-materialization-and-feasibility-rules.test.mjs",
        name: "ruleWorldInteractionFeasibility commits a refusal with no cost and replays identically",
      },
    ],
    judgement: "『确实不可行』与『只是很难』的区分由模型判断",
    probe: {
      file: "tools/spec-0001-behaviour-probes.mjs",
      probeId: "B-impossible-is-refused-not-priced",
    },
  },
  {
    id: "C",
    demand: "激进路径可以固化压倒性危险，规则内核不自动削弱，并完整执行死亡",
    covers: [
      {
        file: "tests/kp-vnext-hazard-actor-death-fold.test.mjs",
        name: "an interaction can kill its actor before its summary event is folded and replayed",
      },
      {
        file: "tests/npc-mechanical-definition-v5.test.mjs",
        name: "extreme but structurally valid NPC mechanics commit — the kernel reports danger and never scales it down",
      },
      {
        file: "tests/world-campaign-v2.test.mjs",
        name: "SPEC 0001 8: a hazard is never refused for being too dangerous",
      },
    ],
    judgement: "危险是否符合世界逻辑由模型判断",
    probePending:
      "内核只看结构不看量级这一半已由确定性用例证明；"
      + "『这个危险是否符合世界逻辑』没有可判定的题面，暂无探针。",
  },
  {
    id: "D",
    demand: "不可执行的动态实体返回具体不可执行项，修订后重提；高数值本身不是拒绝理由",
    covers: [
      {
        file: "tests/kp-vnext-proposal-schema.test.mjs",
        name: "one sparse correction can repair only an allowed path and is then fully revalidated",
      },
    ],
  },
  {
    id: "E",
    demand: "门后内容按第 7 节秘密固化，开门后不得依据 HP 或选择更换",
    covers: [
      {
        file: "tests/hidden-reality-room-v2.test.ts",
        name: "reuses the frozen set and face after eviction while exposing only the selected reality",
      },
    ],
  },
  {
    id: "F",
    demand: "真实感官证据与有来源的主张分开呈现；传闻可假，但火药味必须有已固化原因",
    covers: [
      {
        file: "tests/kp-vnext-claims.test.mjs",
        name: "an NPC source claim remains attributed and does not publish the hidden world truth",
      },
      {
        file: "tests/world-campaign-v2.test.mjs",
        name: "SPEC 0001 F: a rumour cannot be recorded without its source, its time, or its motive",
      },
      {
        file: "tests/world-campaign-v2.test.mjs",
        name: "SPEC 0001 F: sensory evidence citing a fact that was never frozen is refused",
      },
    ],
  },
  {
    id: "G",
    demand: "致命陷阱按固化的触发/豁免/伤害结算，允许致死，不降伤也不追加第二层机关",
    covers: [
      {
        file: "tests/kp-vnext-hazard-actor-death-fold.test.mjs",
        name: "an interaction can kill its actor before its summary event is folded and replayed",
      },
      {
        file: "tests/world-campaign-v2.test.mjs",
        name: "SPEC 0001 G: a frozen hazard's damage is applied at full amount even past the target's remaining HP",
      },
    ],
    judgement:
      "『不追加第二层机关』约束的是 KP 的作者判断，不是内核："
      + "一个地牢本来就可以有两个陷阱，内核去拦截反而是错的。",
    probePending:
      "wire 现在能表达 KP 自己冻结的危害，传输面不再是障碍；"
      + "剩下的只是题面本身尚未构造——需要一道『危害已经结算完毕』"
      + "且追加第二层机关与不追加同样自然的处境。",
  },
  {
    id: "H",
    demand: "普通无风险动作直接描述成功并推进，不要求掷骰",
    covers: [
      {
        file: "tests/kp-vnext-stage3-room.test.ts",
        name: "lowers a vnext-2 Bundle: materializes a new scene object and interacts with it through its prospective handle as one atomic Rules transaction, never partially",
      },
    ],
    judgement: "『这次不值得掷骰』由模型判断，schema 无法强制",
    probe: {
      file: "tools/spec-0001-behaviour-probes.mjs",
      probeId: "H-trivial-needs-no-roll",
    },
  },
  {
    id: "I",
    demand: "有真实后果的失败要产生相称的世界变化，不得原样返回并要求重复同一检定",
    covers: [
      {
        file: "tests/kp-vnext-stage3-room.test.ts",
        name: "settles one shared ability check across a vnext-2 Bundle: the roll picks the interaction's branch and decides whether the conditional entry is committed at all",
      },
      {
        file: "tests/ending-reorientation-room-v2.test.ts",
        name: "refuses a meaningful failure that changes nothing in the world",
      },
    ],
    judgement: "变化是否『相称』由模型判断",
    probePending:
      "『非空』是可以强制的下限，且已经强制；"
      + "『相称』不是，它需要一道能分辨『代价太轻』的题面，尚未构造。",
  },
  {
    id: "J",
    demand: "玩家停滞时先重新定向再给机会；不因现实思考时间惩罚，也不把玩家传送回主线",
    covers: [
      {
        file: "tests/ending-reorientation-room-v2.test.ts",
        name: "rejects the identical reroll and reorients a stuck player to an already-canonical opportunity",
      },
      {
        file: "tests/ending-reorientation-room-v2.test.ts",
        name: "advances neither fiction time nor punishment during real-world wait and DO eviction alone",
      },
    ],
  },
  {
    id: "K",
    demand: "NPC 不得对世界内未获知的玩家计划做出针对性反制",
    covers: [
      {
        file: "tests/observer-projection-v2.test.mjs",
        name: "an NPC Viewer contains only that NPC's finite knowledge",
      },
      {
        file: "tests/kp-vnext-claims.test.mjs",
        name: "an NPC source claim remains attributed and does not publish the hidden world truth",
      },
    ],
  },
  {
    id: "L",
    demand: "含糊的重大意图在提交前确认；玩家确认后不再劝阻",
    covers: [
      {
        file: "tests/authoritative-action.test.mjs",
        name: "major ambiguity becomes awaitingInput and is never answered by the system",
      },
      {
        file: "tests/kp-omitted-semantics-clarification-v3.test.mjs",
        name: "a clarification continuation is never converted again",
      },
    ],
  },
  {
    id: "M",
    demand: "分头行动时切换聚光灯，分别保护秘密投影，各人决定自己的角色行动",
    covers: [
      {
        file: "tests/multiplayer-room-v2.test.ts",
        name: "routes group-rest consent through trusted pending ownership without auto-resting another player",
      },
      {
        file: "tests/rules-multiplayer-v2.test.mjs",
        name: "split locations keep independent FictionTimeline/CausalFrontier and Spotlight never advances time",
      },
    ],
    judgement:
      "『在自然决定点切换聚光灯』约束的是 KP 的判断；"
      + "内核负责的聚光灯账本与逐 Viewer 保密已经覆盖。",
    probePending:
      "vnext-2 的 wire 没有聚光灯概念（Phase 4），这一半目前无法用探针衡量。"
      + "另注：app/_runtime/lib/kp/clock.ts 的 spotlightSkew/spotlightRefuseSpeech "
      + "是一套完整但从未接线的实现，今天只作为提示词文本存在，"
      + "MAX_SPOTLIGHT_SKEW 同样无人引用。",
  },
  {
    id: "N",
    demand: "发现裁决错误要公开说明并以可审计方式更正，不得秘密重写历史",
    covers: [
      {
        file: "tests/archive-correction-v2.test.ts",
        name: "requires the opaque correction capability and makes a production ActionPlan correction idempotent by correctionId",
      },
    ],
  },
  {
    id: "O",
    demand: "核心冲突真实解决后展示长期后果并允许收束，不得生成幕后黑手撤销胜利",
    covers: [
      {
        file: "tests/ending-reorientation-room-v2.test.ts",
        name: "keeps a victorious conclusion and its long-term consequences durable, without admitting a retroactive hidden villain",
      },
    ],
  },
];

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O"];

test("the registry covers exactly the fifteen scenarios SPEC 0001 declares", async () => {
  assert.deepEqual(SCENARIOS.map((entry) => entry.id), LETTERS);

  // Tie the registry to the specification's own text: renaming or dropping a
  // scenario there must break this gate rather than silently orphan an entry.
  const spec = await readFile(SPEC_PATH, "utf8");
  for (const { id, demand } of SCENARIOS) {
    assert.match(
      spec,
      new RegExp(`^### ${id}\\. `, "mu"),
      `SPEC 0001 no longer declares scenario ${id}`,
    );
    assert.ok(demand.length > 0, id);
  }
});

test("every scenario names assertions that still exist, or says what is missing", async () => {
  const sources = new Map();
  const readSource = async (file) => {
    if (!sources.has(file)) {
      sources.set(file, await readFile(new URL(`../${file}`, import.meta.url), "utf8"));
    }
    return sources.get(file);
  };

  for (const scenario of SCENARIOS) {
    const { id, covers, pending } = scenario;
    assert.ok(
      covers.length > 0 || (typeof pending === "string" && pending.length > 0),
      `scenario ${id} has neither an assertion nor a stated gap`,
    );
    for (const { file, name } of covers) {
      const source = await readSource(file);
      // The registry points at a test by its exact name, so a rename or a
      // deletion surfaces here instead of quietly reducing coverage.
      assert.ok(
        source.includes(JSON.stringify(name)) || source.includes(`"${name}"`),
        `scenario ${id}: ${file} no longer declares a test named ${JSON.stringify(name)}`,
      );
    }
  }
});

test("the acceptance gate reports its own honest state", () => {
  const covered = SCENARIOS.filter((entry) => entry.covers.length > 0 && !entry.pending);
  const partial = SCENARIOS.filter((entry) => entry.covers.length > 0 && entry.pending);
  const uncovered = SCENARIOS.filter((entry) => entry.covers.length === 0);

  // These three numbers are the gate. Raising the first is the work; this
  // assertion exists so that raising it is a deliberate edit, and so that
  // coverage can never quietly fall.
  assert.equal(covered.length, 15, covered.map((entry) => entry.id).join(","));
  assert.equal(partial.length, 0, partial.map((entry) => entry.id).join(","));
  assert.equal(uncovered.length, 0, uncovered.map((entry) => entry.id).join(","));

  // Fifteen covered does not mean fifteen finished. Every scenario's
  // MECHANICAL half -- what the system enforces whatever the model says -- now
  // has a named assertion, and that is what the three numbers above count.
  // Seven scenarios also carry a JUDGEMENT half that no fixture can settle,
  // and two of those constrain the KP's authoring rather than the kernel:
  // G's second layer and M's spotlight switch would be wrong to enforce in
  // code, because a dungeon may hold two traps and the natural decision point
  // is a reading of the fiction. Keeping the two kinds apart is the point of
  // this file; collapsing them would let a judgement gap masquerade as done.
  const judgement = SCENARIOS.filter((entry) => entry.judgement !== undefined);
  assert.deepEqual(
    judgement.map((entry) => entry.id),
    ["A", "B", "C", "G", "H", "I", "M"],
  );
});

test("every judgement half either names a probe or says why it has none", async () => {
  const probes = await readFile(
    new URL("../tools/spec-0001-behaviour-probes.mjs", import.meta.url),
    "utf8",
  );

  for (const scenario of SCENARIOS) {
    const { id, judgement, probe, probePending } = scenario;
    if (judgement === undefined) {
      assert.equal(probe, undefined, `scenario ${id} names a probe but no judgement half`);
      assert.equal(probePending, undefined, `scenario ${id} defers a probe it does not need`);
      continue;
    }
    // Exactly one, so a judgement half can never be silently unaccounted for:
    // it is measured, or the reason it is not is written down.
    assert.ok(
      (probe === undefined) !== (probePending === undefined),
      `scenario ${id} must name exactly one of probe / probePending`,
    );
    if (probe === undefined) {
      assert.ok(probePending.length > 0, id);
      continue;
    }
    assert.equal(probe.file, "tools/spec-0001-behaviour-probes.mjs", id);
    // The probe registry is load-bearing the same way the test names are:
    // deleting a probe has to break this gate, not quietly stop measuring.
    assert.ok(
      probes.includes(JSON.stringify(probe.probeId)),
      `scenario ${id}: no probe named ${JSON.stringify(probe.probeId)}`,
    );
  }

  const measured = SCENARIOS.filter((entry) => entry.probe !== undefined);
  const deferred = SCENARIOS.filter((entry) => entry.probePending !== undefined);
  assert.deepEqual(measured.map((entry) => entry.id), ["B", "H"]);
  assert.deepEqual(deferred.map((entry) => entry.id), ["A", "C", "G", "I", "M"]);
});
