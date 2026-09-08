# vNext 旁白精确度修复（2026-09-08）

本地开发修复已完成。2026-09-08 新增真实检查：正常 HTTP 主链在提案格式层失败；随后一次隔离的真实旁白生成/审核对照通过，不能将两者合称主链通过。未部署。行为依据为 SPEC 0001 §§9、12、16、19、SPEC 0015 §§7–8 与 ADR 0015 的冻结 Claims/逐 Viewer 叙述边界。

## 症状与原始证据

[round73 回执](vnext-round73-validation.md)的公开原稿保持原样：

> 你握住圣徽，对自己施放治愈伤口。法术完成，但你的伤势并未因此好转，生命值仍是24；你的可用施法资源也因此减少，剩余3次。

原行动 HP 24/24→24/24、实际治疗量 0，一环法术位 4→3、二环仍 2。原 gate 将其记录为措辞不精确，没有认定虚构治疗量；本修复不改写旧 gate 或历史正文。

已核对本地保存的第 3、4 次模型请求：生成和审核均只有“该资源的剩余数量为 3”“生命值由 24 变为 24”，能力名称为“该能力”，审核对全部机械组返回 complete。材料缺失是直接证据；这些缺失如何影响模型选择“伤势”一词属于因果推断，不能由一次原稿证明全部原因。

## 根因与修改

- `rules/v2/claims.ts` 的 ResourceSpent 分支没有读取消耗量，余额分支也没有使用现有资源名称解析。现在各资源分支一致保留名称，ResourceSpent 表达消耗量与余额；ResourceUsed/Reserved 的余额只从准确事件帧取得。没有名称的非目录资源仍不猜名字。
- HealingResolved 原材料不区分实际恢复量和理论治疗量，也没有上限信息。现在从已提交 before/after 表达实际增加量；上限及治疗前是否已满作为同事件的 `healingCapacity` 材料，仅按原角色控制者 grant 投影。未新增 Claims 字段或改变机械结算；不能由满 HP 推断伤势、中毒等独立状态消失。
- `profiles/ability-compiler.ts` 的已授权定义投影从现有法术目录取得中文名称；`observer-delta.ts` 名称收集补读 controlledCharacter.combat.definitions。名称仍须经过原 grant，未开放其他角色的私有能力目录。
- `kp/narration-vnext.ts` 的生成与现有一次审核共用精确度要求：保留资源池归属、区分施法与治疗、禁止从零恢复猜施法失败或从治疗意图猜已有伤势。提示词策略为 v11，schema/正文原样发布/两次调用上限不变。没有增加词语黑名单、自动改写或额外审核。

原例的期望表达（人工示例，并非新模型输出）：

> 你握住圣徽，对自己施放治愈伤口。你的生命值原本已达上限，仍为 24/24；本次消耗一个一环法术位，一环法术位还剩 3 个。

## 直接消费者与定向证据

- 公共 Rules `step/project/replay`：满血、受伤、触顶三种治疗与职业资源经过相同编译/执行/投影路径。中毒保持、二环未变、其他 Viewer 无上限及私有法术名；交错行动只把自身事件的实际恢复和上限归入原行动。
- Room `handleRoomAction`：真实目录建卡后“治愈伤口/治愈真言”的冻结材料有中文名称、一环余额和零治疗原因；保存随机后驱逐、恢复及重复提交只产生一次结算与一次旁白。此处模型绑定为受控替身，不计真实 Provider 成功。
- Narration Adapter：沿用已有测试验证同一冻结输入、准确 body/review 绑定、一次审核、失败不自动改写，以及恢复期限和调用上限。测试不证明模型能识别任意自然语言矛盾。

最终源码的实际命令：

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `node --import tsx --test tests/kp-vnext-ability-operation.test.mjs tests/kp-vnext-claims.test.mjs tests/kp-vnext-interleaved-projection.test.mjs tests/kp-vnext-narration.test.mjs` | 77/77，exit 0 | `/tmp/zhuwei-narration-precision-node-final.log` |
| `npx vitest run tests/kp-vnext-ability-operation-room.test.ts -t 'normal Room filling saves native randomness\|room ready for joined character registration'` | 2 通过、4 跳过，exit 0 | `/tmp/zhuwei-narration-precision-room-final.log` |
| `npm run typecheck` | exit 0 | `/tmp/zhuwei-narration-precision-typecheck-final.log` |

新增四个精确度用例在修复前均因“该资源”材料失败（exit 1），修复后通过。首次较宽 Node 组为 76/77，余项是既有 Activity 单测夹具缺少活动集合、在进入治疗分支前报错；仅补齐该夹具集合。首次 typecheck 暴露本次两个位置的记录类型收窄遗漏，已修正后通过。Room 日志的 interrupted:afterRandomnessCandidateCommit 是用例主动注入的故障，不是未解释失败。

## 2026-09-08 真实检查

[结构化回执](vnext-narration-precision-live-evidence.json)保存两项结果、用量、冻结源码和证据位置。基线为 `cloudflare / 5d4c1512488da9e134314589344c613a60aaf26a` 加当前未提交修改；将 324 个运行时/配置/工具文件按字节复制到独立本地目录，起止哈希一致。本任务四个运行时修复文件仍与副本相同；主目录并行任务随后修改的其他 Rules 文件没有进入正在执行的副本。

**正常 HTTP 链：未通过。** 独立本地数据库经本地 migration 准备，正常注册、createRoom、lockCharacter、startGame，实际建卡为 HP 24/24、一环 4、二环 2。发送原句“我握住圣徽，对自己施放一次一环的治愈伤口。”，真实 `deepseek-v4-flash` 正确选择能力家族及自身目标，但填写时额外提交 `decision.basisRefs`。原响应离线解析复现 `CONSTRAINT_CONFLICT / filling:ability-basis-owned`：该字段由服务器负责，预期不存在，原稿实际为长度 3 的数组，不能证明语义等价而自动移除。公开结果为 `PROPOSAL_FORM_INVALID / notCommitted`，不是旁白审核失败。

首个明确失败后停止第二句，没有重采样、改写原稿或追加修订。实际 2 次模型调用、0 事件、0 Receipt、0 新旁白；HP 仍 24/24、一环仍 4、二环仍 2。重复原 submission 为 0 新调用，状态/事件/随机账本/返回结果/投递均相同。空事件重放精确，仅证明未提交状态保持，不作为治疗执行证据。两个本批本地服务及端口均已关闭。

**隔离旁白对照：本例通过。** 为区分“提案未到达旁白”和“旁白修复无效”，保留失败原稿，另用刚才正常房间的初始状态、独立编写的合法能力操作和明确标注的固定 d8=2，经过当前公共 Rules `step/project/replay` 生成受控回执。该对照没有修改 Room 数据，也没有把模型原稿清洗成成功：9 条事件只存在于离线夹具，实际 Room 提交/公开发布均为 0。Rules 结算理论治疗 5、实际恢复 0、HP 24/24、一环 4→3、二环仍 2；按原 Viewer 授权生成 Claims，再由现役 Room 叙述上下文函数冻结材料。

使用现役 Adapter 与默认真实模型，执行一次生成及原有一次审核，原文为：

> 你握住圣徽对自己施放治愈伤口，法术顺利完成，但你的生命值本已在上限（24/24），因此没有实际恢复。这次施法消耗了1个一环法术位，剩余3个。

审核五项均为 pass，五个机械结果组均为 complete，issues 为空。人工核对：明确原本满 HP 和没有实际恢复；实际消耗与余额保留一环归属，“剩余3个”就近唯一指向一环法术位；没有从治疗意图虚构伤势、混淆理论治疗量或宣称状态解除。原响应正文与 Adapter 返回逐字一致；实际生成/审核请求分别等于从同一冻结材料和精确正文重建的生产请求，没有额外审核、提示改写或模板替换。

总计 **4 次物理调用、64,351 输入 / 720 输出 tokens**，全部有 usage。按当晚核验的 DeepSeek 官方空闲时段价格估算 **¥0.0930849**（HTTP 失败批 ¥0.0822624，隔离旁白 ¥0.0108225）；这不是账户账单实扣证明。初始预算最多 12 次 / ¥3，隔离对照另预设最多 2 次 / ¥0.5 并计入该总额，剩余额度未用于挑选成功。

实际验证命令（均退出 0，具体前缀为 `/tmp/zhuwei-narration-precision-live-20260908`）：`runner.mjs preflight/setup/action/duplicate` 完成测试器执行，但 action 的产品结果明确失败；`diagnose-form.mjs` 保留原格式错误；`replay.mjs` 核对真实未提交状态；`build-scoped-fixture.mjs` 完成当前 Rules 对照；`run-scoped-narration.mjs` 完成两次真实调用；`verify-scoped-result.mjs` 核对请求/原文/审核绑定；`verify-source.py` 核对冻结源码。夹具脚本首次错误地访问不存在的 `projection.readModel`，在外呼前改为公共投影本身后通过；这不是模型或产品失败，未改生产代码。

## 未覆盖范围

正常真实游玩链尚未穿过当前提案填写拒绝，第二种治疗未发送。受伤/触顶治疗、职业资源、其他 Viewer、交错事件和独立状态仍只有前述本地定向证据；真实审核能否拒绝旧病句尚未验证，不能由一条正确正文推断错误检出率。没有统计成功率、浏览器、完整回归、发布、push、远端 migration 或退役。任意动态资源的缺失名称没有被猜补；任意既有伤势的自然语言识别仍由收到合法材料的模型审核承担。

后续进展（2026-09-08）：按用户要求修正模型填写表单与说明后，新的正常注册/建卡房间中，原治愈伤口请求已通过真实模型、Rules/Room 提交和公开旁白；详情见[填写边界修复与真实验收](vnext-model-filling-surface-validation.md)。本页原批次的失败及隔离对照不改判。

尝试把 round73 旧快照直接交给当前完整投影时，严格返回 projectionIntegrity。逐事件对照显示首个 RandomnessRequested 后的更正审计 effects 比旧快照多一项；相关 events/correction 源码本任务未修改，未放宽旧哈希校验。原回执仅作为已存原稿和数值对照，不将此尝试称为旧 Profile 在当前版本下重放成功；当前版本的准确重放证据来自上述公共 Rules 与 Room 测试。
