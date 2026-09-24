# 按功能运行测试

测试、夹具和测试配置统一位于本目录，主程序仍在 `app/`、`worker/`。功能验收要求与缺口见[功能验收清单](../docs/agent/functional-acceptance.md)；历史文件的新位置及本次验证见[迁移回执](../docs/agent/receipts/test-suite-reorganization-20260914.md)。

## 目录

| 目录 | 功能 |
| --- | --- |
| `kp/npc/` | NPC 生成、交谈、有限知识、关系、计划与承诺 |
| [kp/stories](kp/stories/README.md) | 动态支线准备、评审、接入、恢复与结局 |
| [kp/items](kp/items/README.md) | 物品生成、拾取、装备、使用、转交、制作与毁坏 |
| [kp/narration](kp/narration/README.md) | 旁白生成、审核、来源、连续性、表现与恢复 |
| `kp/adjudication/`、`kp/combat/` | 行动可行性、检定与规则结算 |
| `kp/knowledge/`、`kp/world/` | 观察、知识、环境、地点与危险 |
| `kp/time/`、`kp/campaign/` | 耗时活动、休息、成长、章节与继任 |
| `kp/context/`、`kp/protocol/`、`kp/provider/` | 上下文、填写协议与模型传输 |
| `product/` | 身份、开局、人物卡、房间、多人、背包、知识、地图、语音与历史 |
| `platform/` | 权威边界、归档恢复、版本、诊断与测试工具自身 |
| `support/` | 共用夹具、测试 Worker 和辅助代码，不注册测试 |
| `config/` | 测试发现规则、Worker/HTTP/真实模型独立环境 |

同一功能内按验证对象命名文件；协议版本仍保留在实际 fixture 和断言中。一个功能的生成、执行和恢复可以共用夹具，结果分别报告。跨功能的原子事务和完整游玩路径保留整体测试，不拆散其因果链。

## 运行入口

先列出文件，不执行测试、不导入 fixture，也不调用模型：

```bash
npm run test:list
npm run test:function -- --feature kp/npc --suite all --list
```

定向执行：

```bash
npm run test:unit -- --feature kp/npc
npm run test:unit -- --file tests/kp/items/use.test.mjs
npm run test:worker -- --file tests/kp/stories/story-creation-store.room.test.ts --name 'persists real new-NPC'
npm run test:http -- --file tests/product/history/story-history-http.http.test.mts
```

`--file` 可以重复；`--feature` 使用精确目录名；`--name` 传给 Node/Vitest 的原生标题筛选。未知功能、未知文件、环境不匹配或空文件选择均报错，不能被记作通过。原生标题过滤产生的跳过数仍须在结果中保留。

| 命令 / 文件后缀 | 验证范围 | 外部模型与构建 |
| --- | --- | --- |
| `test:unit` / `.test.mjs` | 确定性领域、编排和组件测试；受控模型替身 | 不自动构建；文件内混合的结构断言不能当真实行为证据 |
| `test:structure` / `.structure.test.mjs` | 源码结构、登记与布局检查 | 单列报告，不证明游戏体验 |
| `test:worker` / `.room.test.ts` | 本地 Worker、Room、SQLite | 独立测试配置；模型通常为替身 |
| `test:http` / `.http.test.mjs`、`.http.test.mts` | 身份、真实路由、持久化与响应 | 两个 `.mjs` 页面测试依赖当前 `dist/server`；需在相应验证阶段显式 build；历史 HTTP 的 `.mts` 使用独立本地配置 |
| `test:eval` / `.eval.mts` | 故事、日常行动与旁白恢复的真实模型探针 | 默认仅 dry-run；使用原探针的显式 live/preflight 参数与预算限制 |
| `test:eval:offline` | 既有 120 条冻结语料的离线结构评测 | 不是自然度或真实模型质量验收 |

`npm test` 收集 unit、structure、Worker，不隐式 build、运行 HTTP 或付费评测。完整执行仍按项目的验证阶段选择。常规 `npx vitest run <目标文件>` 可用，根目录 `vitest.config.ts` 只转发本目录中的 Worker 配置；独立 HTTP 使用上述 `test:http` 入口。

`rendered-html.http.test.mjs` 也可用 `ZHUWEI_HTTP_TEST_ORIGIN=http://127.0.0.1:<端口>` 验证已启动的本地源码服务，避免把旧 `dist` 当成本次变更的证据。该模式只接受 loopback 地址；调用方先准备隔离的本地 D1/DO 数据目录并应用本地迁移，结束后关闭服务。默认仍验证显式构建的 Worker。

CI 的 Node 棘轮使用相同的递归发现逻辑，保留原先包含的 HTTP 文件，构建在 CI 中显式执行。Worker 和真实模型评测不会被冒充为该 Node 棘轮的覆盖范围。现有失败继续按用例名报告，不因搬目录变成通过。

旁白恢复的有界运行（需要已有真实调用授权和本地密钥）：

```bash
npm run test:eval -- --case narration-recovery
npm run test:eval -- --preflight --case narration-recovery
node --env-file=.dev.vars --import tsx tools/run-story-room-probe.mjs --live --case narration-recovery --max-calls 8 --max-input-tokens 920000 --max-output-tokens 47616
```

`narration-recovery` 在独立本地房间中注入一次空正文截断故障，真实恢复生成与审核，并核对原冻结输入、世界状态不变、原提交重复零调用。初次故障是合成材料，恢复正文是实际模型输出；两者必须分开记账。它不要求生成新支线，普通 NPC 回答也能验证恢复边界。真实模型别名、原稿、费用和表达质量分别留证，见[本次回执](../docs/agent/receipts/narration-strict-generation-20260914.md)。

日常样例复用同一探针，可用 `--case daily-investigation`、`daily-items`、`daily-spell`、`daily-combat`、`daily-multiplayer` 选择。先以 `--preflight` 核对初始房间；它不调用模型，也不证明行动能完成。样例和特殊初态登记在 [case catalog](support/fixtures/story-live-room-cases.mjs)，共用验收操作在 [daily-gameplay](support/fixtures/daily-gameplay.ts)。真实运行仍需显式授权和有界预算。

验收经过注册、会话、正常游戏路由、Room、真实模型、Rules 和实际投递；房间及人物初态使用明确登记的夹具，不覆盖建房/建卡界面。脚本只确认本人待掷骰，不代答澄清或他人决定；检查未登录拒绝、伪造加值拒绝、状态回放和原提交重复。功能断言通过后仍须独立审阅旁白。当前通过项、失败及测试脚本修正详见[日常功能验收回执](../docs/agent/receipts/daily-gameplay-acceptance-20260914.md)，不能把支持运行的样例清单当作已通过清单。

## 测试结果与质量评价

功能编号沿用验收清单的 `KP-*` / `APP-*`。报告至少写清源码状态、具体命令、正常/变化/反例、通过/失败/跳过、模型是否为替身及未覆盖范围。

中文自然度、NPC 声口、裁决合理性和支线可玩性需要真实材料的独立阅读评价。`test:eval` 当前并未实现所有功能的真实样例；未触发创作、未实现的样例和审核格式错误都不能记作该功能通过。原始正文、状态和各评价维度分别留证，按[质量评价方法](../docs/agent/functional-acceptance.md)执行。
