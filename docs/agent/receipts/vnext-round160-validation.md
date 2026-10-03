# round160：补全只在有对象时提供之后，重跑行动者先走过去

2026-10-04（北京时间）。`tools/run-story-room-probe.mjs --live`，每个用例一个新房间，真实 HTTP 路径，DeepSeek `deepseek-flash`。[round159](vnext-round159-validation.md) 第一个用例失败后，用户选择"先修补全，再重跑三个用例"，按同一预算：每个房间 16 次、三个用例合计最多 48 次，首个失败即停，不重采样，不部署、不 push。实际 16 次调用，三个用例都通过。运行在 2026-10-03 18:53–18:55 UTC（北京时间 10 月 4 日 02:53 起，国庆假期），按空闲价（缓存命中 0.02、其余输入 1、输出 4，单位 ¥/百万 token）约 ¥0.22，按高峰价约 ¥0.43。连同 round159 的 3 次，这次验证共 19 次调用，空闲价约 ¥0.26。

在 `relaxed-saha-bd59ee` 工作树运行，源码等于 cloudflare `184dc865` 加三个提交：`09a3fe41`（探针用例与走动判定；探针房间用 `social-resolution-v2`）、`08c9d6c3`（round159 回执）、`51194f5e`（[ADR 0089](../../adr/0089-object-completion-is-offered-only-when-there-is-an-object-to-complete.md)）。运行前后源码清单一致，每个用例先做 `--preflight`（0 次调用）。没有远端 migration、Secrets 修改或部署。

## 这批验证什么

- [ADR 0087](../../adr/0087-the-actor-may-first-walk-within-the-scene.md)：玩家说"走到某处再做某事"时，KP 写 `approach`，Rules 先把行动者走过去。判定：行动者有且只有一个 `CharacterRepositioned`，最后的位置等于路径终点，并且在玩家说的人或地图物件旁边。
- ADR 0089：开场房间没有可补全的场景对象，选择阶段不再提供 completeObject，KP 不再因此修订失败。
- [ADR 0085](../../adr/0085-a-refusal-is-always-offered-at-filling.md)：对抗动作不判做不到（`contested-carry`）。

## 结果

| 批 | 用例 | 调用 | 输入（缓存命中）/ 输出 token | 结果 |
| --- | --- | --- | --- | --- |
| 160-1 | 走到石砌炉台旁边，蹲下看炉膛里的灰烬有没有烧剩的纸片 | 4 | 55,015（16,512）/ 1,272 | 通过 |
| 160-2 | 走到楼梯阴影里，把奈斯拦腰抱起，扛到炉边的烛光下 | 6 | 144,592（93,312）/ 3,541 | 通过 |
| 160-3 | 走到书记官瓦罗身边，压低声音问"第一份遗嘱是谁起草的？" | 6 | 98,265（22,400）/ 7,170 | 通过 |

### 160-1

选择 worldInteraction、observe，没有 completeObject（本房间不提供）。填写 directSuccess，一个 worldInteraction 步骤，`approach: nextTo feature:wake:hearth`；行动者的视觉证据写了灰里没有纸片、灰面有拨乱的痕迹，莉安、奈斯、瓦罗各有一条看见他走过去翻灰的记录。没有修订。行动者从 (-420,60) 走到 (360,60)，在炉台旁。旁白一次通过审核。

### 160-2

选择 worldInteraction，并加载莉安、瓦罗的视图。填写两轮修订后通过：

1. 第一份填写把检定决定的步骤放在 steps 里，`check.worldInteraction` 为空（`filling:check-step-required`）。
2. 整稿重填为力量（运动）检定 DC 11；`approach` 写成坐标点 `{kind:"point", x:270, y:210}`，x、y 是 JSON 数字而不是字符串（`approach:shape-invalid`）。
3. 补丁把 x、y 改成字符串，通过。

掷出 20，成功。行动者经 (120,60) 走到 (270,210)，在奈斯 (270,270) 旁边。旁白一次通过审核。

### 160-3

选择 worldInteraction、social。填写一次通过：一个 worldInteraction 步骤 `approach: nextTo npc:black-oak-will:varo`，一个 social 步骤问话。瓦罗本人作答：先要对方报姓名和身份，说备案文书上的起草人署名不是他；回答审核通过。行动者经 (-180,60) 走到 (0,240)，在瓦罗 (60,240) 旁边。旁白一次通过审核。

## 看到的

- **三个用例 KP 都写了 `approach`**，目标是人（瓦罗）、地图物件（炉台）和坐标点（奈斯身前）。没有因为"不在手边"判做不到。
- **completeObject 不再出现。** 160-1 的选择没有它，填写没有补全步骤，炉台的样子只写在感官证据里。
- **坐标点的 x、y 写成了数字**，多花了一轮修订（160-2）。表单要求字符串；可以考虑让 Rules 接受整数并规范成字符串，这次没有改。
- **对抗动作写成了普通检定。** 160-2 的风险说明写了奈斯会扭身挣开，按 [ADR 0086](../../adr/0086-contested-checks-and-grapples-outside-combat.md) 应该用对抗检定（contest），KP 写的是 DC 11 的运动检定。探针没有断言这一点。
- **扛人只体现在文字上。** 160-2 成功后旁白写"你把他扛到炉边的烛光下"，权威状态里奈斯仍在楼梯旁 (270,270)。搬动别的生物按用户裁定不做（ADR 0087 决定 5），但 KP 的成功结果和旁白仍会写出来，世界状态与旁白不一致。
- **交谈先于走动记入事件。** 160-3 的事件顺序是：交谈的 `WorldInteractionResolved`，然后 `CharacterRepositioned`，然后走动那一步。这是 ADR 0087 决定 1 的设计（交谈的 NPC 视图冻结时不允许行动者先变化），旁白仍按玩家的顺序写"你走到账台边，压低声音问"。
- 160-3 的回答审核输出 5,227 个 token（多为 privateReason），是这一批输出最多的一次调用。

## 没有覆盖的

- 走到坐标点后再做与目标无关的事；目标在高处或需要改变高度（Rules 拒绝，未测）。
- 遭遇中带 `approach`（Rules 拒绝，未测）。
- 有可补全场景对象的房间里，completeObject 仍照常提供（只有单元测试）。
