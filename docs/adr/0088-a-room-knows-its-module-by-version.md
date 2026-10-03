# ADR 0088：房间按版本认模组，去掉钉死的哈希

- 状态：已接受
- 日期：2026-10-04
- 依据：合并 `kp-battle`、`contested-check`、`actor-movement` 时，每个分支都要重新钉测试里写死的工作流哈希；`actor-movement` 改了黑橡开场站位，因为模组档案的哈希写死在登记表里、内容一变就拒绝载入，只能为此登记新版本并在多处核对哈希。用户说"哈希都去掉"，在三个范围里选了"去掉钉死的哈希"：删掉测试里写死的工作流哈希断言，以及模组登记表里写死的档案哈希和"内容变了就必须升版本"的哈希比对，房间按版本号认模组；运行时用来识别版本、生成 id、幂等和骰子的哈希不动。随后确认了 SPEC 0006 §§2、9 的条款文字。
- 当前规则：[SPEC 0006 §§2、9](../specs/0006-module-npc-and-faction-protocol.md)
- 取代范围：2026-09-25 第 3b 步决定保留的哈希中，模组档案的写死哈希与载入时的内容核对（[ADR 0056](0056-comparisons-and-self-hashes-without-hashing.md) 之后仍在的一处自带哈希重算）。其余保留项不变。

## 决定

1. **模组登记只记版本。** `module/registry.ts` 列出每个模组可用的版本，不再写档案哈希。`authoritativeModuleProfile` 载入时现算内容哈希，放进 `moduleRef` 供新房间的 genesis 记录，不与任何写死的值比较。
2. **已有房间按版本载入，沿用自己存的引用。** `authoritativeModuleProfileForRoom` 按房间 `moduleRef` 里的版本载入当前正文，并把引用换回房间存的那一份。Room 读取房间模组、归档恢复、`room/server` 的绑定读取都走它，所以房间的读取集、裁定上下文和绑定都用同一个引用；同一版本的正文原地改动后，已有房间照常载入。重复初始化、房间绑定校验、历史房间和建房结果只核对版本（`profileId`）。
3. **KP 上下文不再重算模组正文的哈希。** 上下文只核对房间引用与传入档案的引用是同一个；正文本身不做哈希比对。
4. **开场准备目录只写版本。** `black-oak-will-preparation.json` 的 `moduleRef` 只留 `profileId`，按版本核对。
5. **测试不再钉工作流哈希。** 删除只断言 `VNEXT_KP_WORKFLOW_HASH` 等于某个值的测试。工作流哈希仍在运行时识别版本（[ADR 0038](0038-reask-unfinished-work-after-a-version-change.md)、[ADR 0046](0046-a-room-keeps-its-model-while-the-workflow-version-follows-the-deploy.md)）。
6. **不在本次范围。** `rules/profiles` 各 Profile 文档写死的哈希、归档协议常量、夹具里的引用，以及派生 id、幂等载荷、骰子承诺、D1 键等运行时哈希都不动。

## 影响

- 改模组正文不再被载入拒绝。会让已有房间的状态与正文对不上的改动仍要登记新版本（SPEC 0006 §2），这一点靠写代码的人判断，不再有哈希提醒。
- 已有房间 genesis 里记的哈希保留，只作引用的一部分。
- 合并改提示词的分支时，不用再为测试里的哈希值改文件。
