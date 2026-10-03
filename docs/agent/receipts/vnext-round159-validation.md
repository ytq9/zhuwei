# round159：行动者先走过去（ADR 0087）

2026-10-04（北京时间）。`tools/run-story-room-probe.mjs --live`，每个用例一个新房间，真实 HTTP 路径，DeepSeek `deepseek-flash`。用户同意三个用例、每个房间 16 次、合计最多 48 次，首个失败即停，不重采样，不部署、不 push。第一个用例失败，批次停止，后两个用例（`contested-carry`、`approach-whisper`）没有运行。实际 3 次调用。运行在 2026-10-03 18:02 UTC（北京时间 10 月 4 日 02:02，国庆假期），按空闲价（缓存命中 0.02、其余输入 1、输出 4，单位 ¥/百万 token）约 ¥0.04，按高峰价约 ¥0.08。

在 `relaxed-saha-bd59ee` 工作树运行，源码等于 cloudflare `184dc865` 加探针提交 `09a3fe41`（三个用例的走动判定；探针房间改用新房间得到的模组版本 `social-resolution-v2`）。运行前后源码清单一致，每个用例先做 `--preflight`（0 次调用），确认开场站位是 v2：行动者 (-420,60)、莉安 (360,0)、奈斯 (270,270)、瓦罗 (60,240)。没有远端 migration、Secrets 修改或部署。

## 这批验证什么

- [ADR 0087](../../adr/0087-the-actor-may-first-walk-within-the-scene.md)：玩家说"走到某处再做某事"时，KP 在步骤上写 `approach`，Rules 先把行动者走到目标旁边。判定：这一步有且只有一个行动者的 `CharacterRepositioned`，行动者最后的位置等于路径终点，并且在玩家说的那个人或地图物件旁边（水平 5 尺内）。
- 用例：`approach-hearth`（走到炉台旁看灰烬）、`contested-carry`（走到楼梯阴影里抱起奈斯，另判不判做不到）、`approach-whisper`（走到瓦罗身边低声问话）。

## 结果

| 批 | 用例 | 调用 | 输入（缓存命中）/ 输出 token | 结果 |
| --- | --- | --- | --- | --- |
| 159-1 | 走到石砌炉台旁边，蹲下看炉膛里的灰烬有没有烧剩的纸片 | 3 | 73,181（39,936）/ 1,190 | **失败**：`PROPOSAL_REPAIR_EXHAUSTED`，行动未提交 |

### 159-1 逐次调用

| 次 | 调用 | 输入（缓存命中）/ 输出 | 内容 |
| --- | --- | --- | --- |
| 1 | 选择 | 20,736（512）/ 88 | 选 observe、completeObject |
| 2 | 填写 | 25,573（14,848）/ 963 | directSuccess。observe 一步，`approach: {kind:"nextTo", ref:"feature:wake:hearth"}`，看到灰里没有纸片，两条感官证据；另写一步 completeObject，`definitionRef` 填地图物件 id `feature:wake:hearth`，补全"炉火已熄、只剩冷灰" |
| 3 | 修订第 1 轮 | 26,872（24,576）/ 139 | 诊断：completeObject 的引用不可用，可补全的对象列表为空（`refs: []`）。KP 把引用改成自造的 `definition:scene-feature:feature:wake:hearth`，仍不可用，修订终止 |

## 看到的

- **KP 写对了走动。** 第一次填写就在 observe 步骤上写了 `approach: nextTo feature:wake:hearth`，选的是地图物件，没有因为"不在手边"拒绝。
- **走动这部分本地重放可以提交。** 把 KP 这次的填写去掉 completeObject 一步，换成测试房间的角色 id，在本地房间用脚本模型返回（0 次真实调用）：提交成功，事件依次有 `CharacterRepositioned`、两条 `SensoryEvidenceAcquired`、`WorldInteractionResolved`；行动者从 (-420,60) 走到 (360,60)，在炉台旁。重放用的临时测试没有提交。
- **失败原因与走动无关：新房间没有可以补全的场景对象。** 新房间的 `campaignRuntime.definitions` 只有 4 个 NPC 定义，没有任何 sceneFeature 定义；炉台、楼梯、账台只是地图物件。completeObject 只接受本场景里可见的 sceneFeature 定义，所以在开场房间里这一步不可能通过。表单字段说明写了"不要用地图物件 id"，选择阶段仍会提供并选中 completeObject。round147-2 出现过同一个诊断（`object-completion:visible-existing-scene-object-required`）。
- 诊断给出空的候选列表时，KP 没有删掉这一步，而是自造了一个引用。

## 没有覆盖的

- `contested-carry`、`approach-whisper` 没有运行：对抗动作前先走过去、交谈前先走过去（交谈与走动的执行顺序）都没有真实调用验证。
- 走到坐标点（`point`）。
