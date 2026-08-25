import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const upstreamFiles = {
  "app/_runtime/components/character-wizard.tsx": "f3718f1aedd08226dd41812f07700465f85709616ae112ef39b1f98da910ef73",
  "app/_runtime/components/ui/button.tsx": "4c18b9e3676e5df089ce722b795ebf33e34bd21d5cdf441674f4f9755bcbd79d",
  "app/_runtime/components/ui/input.tsx": "33d15e661f6e9545024d2111752f78689add8afbac6ece3675c4e17a48e50326",
  "app/_runtime/lib/utils.ts": "0258450fa385716503ce96af40147b7d62b247816fcd4a6312bed0b4fa5936f7",
  "app/_runtime/lib/dnd/boosts.ts": "f0a701e6c8682b53d34d7b4a6e6bc71963833bcd31f09753672c4517b77df927",
  "app/_runtime/lib/dnd/compute.ts": "a19ec205c6ac494ce725f4f607227bf669fd856c711bb70ac16393342070344b",
  "app/_runtime/lib/dnd/gear.ts": "584ea2ff3bb4a7433503fa433d017f05004f51d2dca31453fcdf7e0dea2a0321",
  "app/_runtime/lib/dnd/resources.ts": "02e6f6ca0730ce91330f2b3b82276b08cc2034d9b447fe191cbf660567582ffc",
  "app/_runtime/lib/dnd/types.ts": "45dd9f8e4abcb2df96ae9638114a46c04403176c593aa103b1957ef25057d1c0",
  "app/_runtime/lib/kp/busy.ts": "99f2e46dcfbc43fe73ebc492148c5f69ba67863b75a19f5362cc4baa281562f4",
  "app/_runtime/lib/kp/combat.ts": "1dd9cbf2c29e9333acbcb5c7bb1d453973f3ec09e3b99bc13f9b6399b9d732a6",
  "app/_runtime/lib/kp/squad.ts": "0cfb5cdac63697a168a8fc1c491239ff0a6b6f4f5ae08a16c723c09790da6e89",
  "app/_runtime/lib/kp/stance.ts": "7d44e30bddcbd82771ecc4c1ab6bcc07dfc632dfad46bb0d4478868b966a69bc",
  "app/_runtime/lib/kp/where.ts": "800cda358cc8b2a8f86a4cb5b32f43c65fdf17c198fb0d1eaba3186808a5dffe",
};

const approvedProductDeltas = {
  // 上游游侠射术文案错误地移除了长射程劣势；按 2014 规则保留攻击检定 +2 并恢复长射程劣势。
  "app/_runtime/lib/dnd/catalog.ts": "ef9a91558dc9ce2e552cf09668dc0d02556ffa9ca7277dc6caeacff4e39d2f85",
  // 玩家明确要求检定选项不剧透，并由服务端裁定库存、环境物品与物理动作。
  "app/_runtime/lib/kp/clock.ts": "85a911284ffa0abbb3100fa0baf8df76a69f4db58441507d3bcad60c481b654a",
  "app/_runtime/lib/kp/prompt.ts": "a575bcdd2ac13a193068bd52335adfe6d58016083cac0ab3b6e086b28489d1ec",
  "app/_runtime/lib/kp/sanitize.ts": "1f7b576177bfe5c9f43033729216ff5ee2b04e5e4b462583842a1369d37e0ff2",
  // 通用规则 v2 的已批准结构化模组、唯一物件和 Portal 扩展。
  "app/_runtime/lib/module/index.ts": "bb074a5e76832ab9daaa18efed7c66f75d1be65133b861dcb4dd63de8f363343",
  "app/_runtime/lib/module/black-oak-will.ts": "c84341a5b09b77ecb71f4d70edabb2812911adc1889d9e69b0dadb746e7053de",
  "app/_runtime/lib/module/schema.ts": "d3fd3ce6acaa00f2b4b1ab76001ef0d9dbdd33ae918d75e481bc954be2d0801a",
  "app/_runtime/lib/module/writing.ts": "f28ead7af07049e8b14ad58264a38842ec55cb038cd2e3defff67fc2ecbad291",
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
