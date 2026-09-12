import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const upstreamFiles = {
  "app/_runtime/components/ui/button.tsx": "4c18b9e3676e5df089ce722b795ebf33e34bd21d5cdf441674f4f9755bcbd79d",
  "app/_runtime/components/ui/input.tsx": "33d15e661f6e9545024d2111752f78689add8afbac6ece3675c4e17a48e50326",
  "app/_runtime/lib/utils.ts": "0258450fa385716503ce96af40147b7d62b247816fcd4a6312bed0b4fa5936f7",
  "app/_runtime/lib/dnd/resources.ts": "02e6f6ca0730ce91330f2b3b82276b08cc2034d9b447fe191cbf660567582ffc",
  "app/_runtime/lib/dnd/types.ts": "45dd9f8e4abcb2df96ae9638114a46c04403176c593aa103b1957ef25057d1c0",
  "app/_runtime/lib/kp/combat.ts": "1dd9cbf2c29e9333acbcb5c7bb1d453973f3ec09e3b99bc13f9b6399b9d732a6",
  "app/_runtime/lib/kp/where.ts": "800cda358cc8b2a8f86a4cb5b32f43c65fdf17c198fb0d1eaba3186808a5dffe",
};

const approvedProductDeltas = {
  // V5 统一物品把标准武器的封闭机械字段固化在既有装备目录中，展示文本不参与裁决。
  "app/_runtime/lib/dnd/gear.ts": "6a7becaafe26e633f0784a425661e2c396e48042707547c389c093bd38e77282",
  // 通用规则 v2 的三级人物卡显示结构化目标、伤害、豁免与状态，并按职业/种族计算施法档案。
  "app/_runtime/components/character-wizard.tsx": "5424ae8c31fd871141e2f39a7d11973832803c7f8bf10aa9f8cc8bb7d3a0bceb",
  "app/_runtime/lib/dnd/compute.ts": "55a843abe678b42465b7b2b9a67ef5147710d734b8252d667f3c01789962bd83",
  // 上游游侠射术文案错误地移除了长射程劣势；按 2014 规则保留攻击检定 +2 并恢复长射程劣势。
  // v2 还补齐易容术/治疗祈祷选择入口，并按 SRD 把治疗祈祷修正为 10 分钟施法。
  "app/_runtime/lib/dnd/catalog.ts": "8b9eb617dc284e985a8c036aa9d168d4b73c371c140cddef88af5b6be7a7a001",
  // 旧 KP（prompt/clock/squad/stance/sanitize/busy/clue-state/action-ruling）已退役；
  // 表格仍要读的 PendingRoll 类型迁到 kp/pending-roll.ts，boosts 只改这一行 import。
  "app/_runtime/lib/dnd/boosts.ts": "7b539e2244462e941ea2971c0cd714c58d0d1b07b1dfcceb4805c60070923f15",
  // 通用规则 v2 的已批准结构化模组、唯一物件和 Portal 扩展。
  "app/_runtime/lib/module/index.ts": "bb074a5e76832ab9daaa18efed7c66f75d1be65133b861dcb4dd63de8f363343",
  "app/_runtime/lib/module/black-oak-will.ts": "32655d143f226cef60672ffa0354ec2ed3b5bda3d9a277a263a878c89a1b3d2c",
  "app/_runtime/lib/module/schema.ts": "d3fd3ce6acaa00f2b4b1ab76001ef0d9dbdd33ae918d75e481bc954be2d0801a",
  "app/_runtime/lib/module/writing.ts": "5d1d0936e171b0399df764dcb17fcd9802bb8b254c818f6464a0c43eba1bef8a",
};

test("deterministic rules, module and character UI stay byte-identical to GitHub baseline", async () => {
  for (const [path, expected] of Object.entries(upstreamFiles)) {
    const bytes = await readFile(new URL(path, root));
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, expected, `${path} drifted from upstream 29eb06d`);
  }
});

test("keeps explicitly approved player-facing prompt deltas reviewed", async () => {
  for (const [path, expected] of Object.entries(approvedProductDeltas)) {
    const bytes = await readFile(new URL(path, root));
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, expected, `${path} changed without reviewing the approved delta`);
  }
});
