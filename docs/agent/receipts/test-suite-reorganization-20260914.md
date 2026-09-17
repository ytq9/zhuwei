# 测试按功能重组回执

日期：2026-09-14。分支：`cloudflare`。起点：`ff78223102950adb4605d8fee9b8c837a34d55fa` 加当时已有的工作树差量。本轮用户批准按功能重组测试、保留有效行为断言后删除旧文件，并同步运行入口。原有 AGENTS、CLAUDE、README、发布流程及 handoff 删除等用户差量保留；没有部署、push、远端迁移或真实模型调用。

## 结果与保全

- 原 275 个文件中的 274 个迁入 `tests/kp`、`tests/product`、`tests/platform`。其中旁白 1→7、库存操作 1→6、故事准备 1→6，共用辅助代码进入 `tests/support/fixtures`。
- 加入 1 个运行器行为测试文件后，当前为 291 个测试/评测文件，33 个功能目录：unit 212、structure 10、Worker 65、HTTP 3、live 1。不是 291 个已通过功能。
- 对原 274 个文件逐个比较 AST：路径引用规范化、忽略注释后，**1,972 个 test/it 调用的断言主体全部找到且相同**，没有遗漏或额外替换。参数化声明数不等于执行用例数。
- 新运行器的 6 项测试验证递归收集、环境隔离、错误选择拒绝、独立配置派发、真实模型拒绝进入普通测试，以及实际成功/失败的退出码传递。
- [逐文件迁移映射](test-suite-paths-20260914.csv)记录唯一的旧位置→新位置对应；不保留第二套旧测试目录。历史回执的原始命令不改写，按该映射定位当前文件。

`tests/upstream-parity.test.mjs` 的两个断言只比较旧源码哈希，其中还引用已退役的 `kp/combat.ts`、`kp/where.ts`。它不包含功能行为断言，且上游快照不是当前已裁定产品的源码冻结要求，故删除；现役产品布局、Profile、规则和行为测试保留。基线只删除这两个已退役检查名，原 84→82，其余失败名逐字保留，各模块基线不变；不记为两个产品 Bug 被修复。

## 运行入口与直接消费者

运行方式见 [tests/README](../../../tests/README.md)。Node、Worker、HTTP、结构与真实模型评测分别选择；默认本地测试不构建。CI 的 Node 棘轮递归收集原 Node 范围，包括两个页面 HTTP 文件，构建由 CI 显式执行。原本独立配置的 HTTP `.mts` 和 live 入口不会被遗漏或混入普通测试。

测试配置和测试 Worker 位于 `tests/config`、`tests/support`；根 `vitest.config.ts` 只转发现役 Worker 配置。主程序 tsconfig 排除测试，测试 tsconfig 自己包含 `.ts/.mts`。同步了 SPEC 的原验收门路径与分拆后的完整门集合、A–O 登记、工具中的文件清单、README、实现导航和功能清单；没有修改产品条款、协议 ID、模型参数或业务源码。

## 实际验证

| 验证 | 命令 / 范围 | 结果 |
| --- | --- | --- |
| 运行器、NPC、旁白原集合、真实探针自身 | `test:function --suite unit`，精确四文件；旁白随后拆分 | 61/61。包含运行器 6、NPC 8、旁白 38、探针自身 9；全为确定性材料，不是真实模型调用 |
| 拆分后的物品及故事准备 | `test:function --suite unit --file …`，items 的 acquire-release/equipment/transfer/use/lifecycle/projection 及 stories 的 creation/preparation-review/preparation-context/prepared-content/preparation-transport/preparation-recovery，共 12 文件 | 41/41，exit 0 |
| 旁白与直接消费者 | `npm run test:unit -- --feature kp/narration`，16 个 Node 文件 | 118 过、1 失败，exit 1；拆分出的旁白 7 文件原 38 项均通过 |
| 结构与 A–O 登记 | `npm run test:structure -- --feature platform/architecture` | 6/6，exit 0 |
| 本地 Room/SQLite | `npm run test:worker -- --file tests/kp/stories/story-creation-store.room.test.ts --name 'persists real new-NPC|marks only successful SQL|refuses missing context'` | 3 过、27 跳过，exit 0；成功保存/恢复、SQL 幂等与拒绝路径 |
| 实际身份与游戏 HTTP 路由 | `npm run test:http -- --file tests/product/history/story-history-http.http.test.mts --name 'actual game handler'` | 1 过、1 跳过，exit 0；注册、Cookie、同源、成员权限与历史起点绑定；隔离的本地 D1/DO |

上述组有重叠且源码阶段不同，不累计成一个总通过率。

迁移中定位并修复两个运行边界错误：子进程继承 `NODE_TEST_CONTEXT` 会跳过真实测试；搬移后的 SQL glob 仍使用旧相对位置会让空库未建表，注册返回 500。前者由实际失败子进程回归证明，后者在独立本地 HTTP 路径复验通过，并增加“必须发现迁移文件”的前置断言；其余同类 SQL glob 和类型引用一并修正。

静态检查确认测试和工具的相对导入全部可解析、语法可解析、迁移映射与递归收集一致、SPEC 引用检查无错误。只做本次影响的定向验证，没有运行全量测试、全项目 Lint、production build 或真实模型质量批次。

## 保留的失败与未覆盖范围

- `Activity lifecycle projection keeps future outcomes and interruption causes private` 仍失败：实际投影多出 `kind` 和 `progressFictionMicros`，旧精确断言没有这两个字段。名称已在原基线，迁移前后断言主体相同，未修改为绿色。本轮没有裁定这是旧夹具失配还是产品合同问题。
- 全仓文档链接检查还有 6 条超出基线的 `handoff.md` 链接，来自任务开始前已有的文件删除；涉及 repo map、两份历史文档和生产 TODO。本轮没有恢复该文件或修改这次删除。迁移后的测试链接另做目标检查。
- 其余既有失败、完整建卡/开局、全部 103 项功能矩阵和真实 KP 质量未逐项执行。测试目录重组不等于这些功能已完成。
