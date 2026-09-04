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
 * `covers` therefore means "a test asserts this today", and `pending` means
 * "no test asserts this yet, and here is what is missing". Adding coverage is
 * a matter of moving an entry from one field to the other.
 *
 * Several scenarios also carry a MODEL JUDGEMENT half that no deterministic
 * fixture can settle -- whether a DC was honestly chosen, whether a roll was
 * worth asking for. Those halves are recorded here and belong in the KP
 * evaluation suite, not in this file.
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
  },
  {
    id: "C",
    demand: "激进路径可以固化压倒性危险，规则内核不自动削弱，并完整执行死亡",
    covers: [
      {
        file: "tests/kp-vnext-hazard-actor-death-fold.test.mjs",
        name: "an interaction can kill its actor before its summary event is folded and replayed",
      },
    ],
    pending:
      "死亡这一半有覆盖；『校验不因数值过高而拒绝或缩放』这一半没有。"
      + "需要一个用例：同一结构在极高 AC/HP/伤害下仍被原样接受。",
    judgement: "危险是否符合世界逻辑由模型判断",
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
    ],
    pending:
      "『主张与事实不混淆』有覆盖；『传闻必须固化来源、时间、动机与知识依据』没有。"
      + "需要一个用例：缺少其中任一项的传闻提交被拒绝。",
  },
  {
    id: "G",
    demand: "致命陷阱按固化的触发/豁免/伤害结算，允许致死，不降伤也不追加第二层机关",
    covers: [
      {
        file: "tests/kp-vnext-hazard-actor-death-fold.test.mjs",
        name: "an interaction can kill its actor before its summary event is folded and replayed",
      },
    ],
    pending:
      "致死与冻结结算有覆盖；『不得追加第二层机关』没有。"
      + "需要一个用例：已提交的危害之上不能再挂一层新的危害。",
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
  },
  {
    id: "I",
    demand: "有真实后果的失败要产生相称的世界变化，不得原样返回并要求重复同一检定",
    covers: [
      {
        file: "tests/kp-vnext-stage3-room.test.ts",
        name: "settles one shared ability check across a vnext-2 Bundle: the roll picks the interaction's branch and decides whether the conditional entry is committed at all",
      },
    ],
    pending:
      "『失败分支被真实提交、条件步骤被跳过』有覆盖；"
      + "『失败必须携带非空状态增量，空增量的失败应被拒绝』没有。",
    judgement: "变化是否『相称』由模型判断",
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
    ],
    pending:
      "『不得代他人决定』与逐 Viewer 保密有覆盖；『在自然决定点切换聚光灯』没有。",
    judgement: "何处是『自然决定点』由模型判断",
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
  assert.equal(covered.length, 10, covered.map((entry) => entry.id).join(","));
  assert.equal(partial.length, 5, partial.map((entry) => entry.id).join(","));
  assert.equal(uncovered.length, 0, uncovered.map((entry) => entry.id).join(","));

  // A scenario whose only open half is model judgement is not a coverage gap
  // in this file; it belongs to the evaluation suite. Recording it keeps the
  // two kinds of gap from being confused for one another.
  const judgement = SCENARIOS.filter((entry) => entry.judgement !== undefined);
  assert.deepEqual(
    judgement.map((entry) => entry.id),
    ["A", "B", "C", "H", "I", "M"],
  );
});
