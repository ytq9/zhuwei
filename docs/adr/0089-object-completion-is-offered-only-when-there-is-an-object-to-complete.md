# ADR 0089：没有可补全的场景对象时，不提供补全

- 状态：已接受
- 日期：2026-10-04
- 依据：[round159](../agent/receipts/vnext-round159-validation.md) 第一个用例"走到炉台旁看灰烬"失败，批次停止。KP 写对了走动，失败出在同一草稿里补全炉台样貌的 completeObject 一步。用户选择"先修补全，再重跑三个用例"，并确认了 SPEC 0016 §7.2 的条款文字。
- 当前规则：[SPEC 0016 §7.2](../specs/0016-part-c-compound-actions-and-claims.md)
- 取代范围：§7.2"全部已注册能力均可召回"对 completeObject 的适用。

## 原因

completeObject 只能改写行动者所在场景里、行动者看得见的场景对象定义（sceneFeature）。新房间里没有这种定义：黑橡的炉台、楼梯、账台只是地图物件。指引却在每个阶段要求，为回答本次问题新确定的对象位置、朝向、构造或工作状态，须在同束 completeObject 写入原对象，不能只放 sensoryEvidence。round159-1 的 KP 照此为炉台写了 completeObject，诊断给出的可补全列表为空，修订时 KP 自造了一个引用，行动以 `PROPOSAL_REPAIR_EXHAUSTED` 结束。round147-2 出现过同一个诊断。

## 决定

1. **不提供。** 冻结上下文里行动者所在场景没有行动者看得见的 sceneFeature 定义时，选择工具和补选工具的类型列表不含 completeObject，选择阶段的类型目录和填写边界也不列它。选了按未选处理，与 [ADR 0064](0064-ruling-kinds-are-decision-values-and-a-selection-naming-one-is-read-without-it.md) 对 decision.kind 的处理相同；首轮只选了它，按什么都没选处理。
2. **指引同步。** 同样情况下，指引里提到 completeObject 的七处文字不发送，列在 `VNEXT_PROPOSAL_GUIDANCE_POLICY.objectCompletionSentences`。其中六处把对象新确定的样子交给 completeObject，包括阅读指引里"不能只放 sensoryEvidence"那句；另一处是做不到的填写说明里的"不另写completeObject"。行动者看到的样子写在感官证据里。不新增提示词文字。
3. **有对象时不变。** 场景里有可补全的定义（例如用 materializeObject 建过对象）时，选择、填写和指引与此前相同。
4. **Room 复核。** Room 复核每次调用的请求时，按同一冻结上下文重算不提供哪些类型、用哪一版阅读指引。NPC 自己的工作、当场反应和回答审核的请求不变。
5. **版本。** 能力策略 v7，指引 v74。工作流 hash 变化，尚未冻结的方案按 [ADR 0038](0038-reask-unfinished-work-after-a-version-change.md) 重问。

## 影响

- 黑橡开场房间的选择请求少约 700 个字符（目录一项、填写边界一段、阅读指引一句），填写请求少约 200 个字符（阅读指引一句、填写规则两句）。请求体积棘轮的测量不带冻结上下文，数值不变。
- 地图物件新确定的样子只留在行动者的感官证据和知识里，不写入世界状态。以后若要持久保存，需要另行决定，例如为模组的地图物件登记场景对象定义。
- 真实调用验证见 [round160](../agent/receipts/vnext-round160-validation.md)：开场房间的三个用例都没有再选 completeObject，均通过。
