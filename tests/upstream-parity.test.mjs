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
  "app/_runtime/lib/dnd/catalog.ts": "f1ed3e358e08737dcb414cd1bf7cfaf1a0e6b2083df31576e87ad0f3a1965ce6",
  "app/_runtime/lib/dnd/compute.ts": "a19ec205c6ac494ce725f4f607227bf669fd856c711bb70ac16393342070344b",
  "app/_runtime/lib/dnd/gear.ts": "584ea2ff3bb4a7433503fa433d017f05004f51d2dca31453fcdf7e0dea2a0321",
  "app/_runtime/lib/dnd/resources.ts": "02e6f6ca0730ce91330f2b3b82276b08cc2034d9b447fe191cbf660567582ffc",
  "app/_runtime/lib/dnd/types.ts": "45dd9f8e4abcb2df96ae9638114a46c04403176c593aa103b1957ef25057d1c0",
  "app/_runtime/lib/kp/busy.ts": "99f2e46dcfbc43fe73ebc492148c5f69ba67863b75a19f5362cc4baa281562f4",
  "app/_runtime/lib/kp/clock.ts": "6d52a518a4229a64fbb28d0973efddc4c17374c6ee9b1f58452308cba84a6557",
  "app/_runtime/lib/kp/combat.ts": "1dd9cbf2c29e9333acbcb5c7bb1d453973f3ec09e3b99bc13f9b6399b9d732a6",
  "app/_runtime/lib/kp/prompt.ts": "51a866d342e6bb8bf4f3de2617e5c37c2f5d6ee261af1233b3710b183a702ae3",
  "app/_runtime/lib/kp/sanitize.ts": "0997ca7b2d641b92848d46650234836d8183fe99ce3720fc337c4b0d9e0897eb",
  "app/_runtime/lib/kp/squad.ts": "0cfb5cdac63697a168a8fc1c491239ff0a6b6f4f5ae08a16c723c09790da6e89",
  "app/_runtime/lib/kp/stance.ts": "7d44e30bddcbd82771ecc4c1ab6bcc07dfc632dfad46bb0d4478868b966a69bc",
  "app/_runtime/lib/kp/where.ts": "800cda358cc8b2a8f86a4cb5b32f43c65fdf17c198fb0d1eaba3186808a5dffe",
  "app/_runtime/lib/module/black-oak-will.ts": "7b3c28829a29e483184a01ef24afd44cdd2bfe0f126270b5b84168f3a73d0dd2",
  "app/_runtime/lib/module/index.ts": "c593be1fcfb06598b563bd109ef3bf6ec3acf5c6f76c31c6d1da970892dac868",
  "app/_runtime/lib/module/schema.ts": "c3dc303c04ec1192c46c2f48d38a0f2fd1c831d7adcfd3d107d1bcb3cff13a2f",
  "app/_runtime/lib/module/writing.ts": "b5300ac28783e5c7a719ecf9a720904c6a8dacdffbece5aca14db0df09a9d106",
};

test("deterministic rules, module and character UI stay byte-identical to GitHub baseline", async () => {
  for (const [path, expected] of Object.entries(upstreamFiles)) {
    const bytes = await readFile(new URL(path, root));
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, expected, `${path} drifted from upstream 29eb06d`);
  }
});
