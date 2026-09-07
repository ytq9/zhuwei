# vNext Ability 上下文修复验收

日期：2026-09-06。开发基线：`cloudflare / 258caee404e0814405eb497653ee9f00d647b773`，保留既有未提交工作树。本轮新增外部模型调用 **0**；以下是本地确定性证据，不能替代真实连续游戏验收。

## 目标与能力合同

行动者通过名称或精确物品引用表达使用工具/能力时，RequiredContext 必须从同一冻结状态发现相关候选，并闭包到已有可执行 Ability、精确成本和完整行动者资源。覆盖不同装备槽位、法术来源和职业资源来源；名称只帮助检索，不能编译新能力、授予权限或选定结果。Room/Rules 继续拥有状态、随机、资源与提交权威，缺失决定性记录或预算不足时阻止提交。

## 根因与修复

- 原 Room 枪械用例表现为 `PROPOSAL_PROVIDER_TIMEOUT`，实际是受控 Provider 内部的断言被包装；模型调用前即可证明权威目录已有武器 Ability，但冻结能力目录为空。
- 对照“枪”和“燧发手枪”：前者物品也未被召回，后者已有物品而仍缺 Ability。前一个缺口来自中文固定 2/3 字片段检索，后一个缺口来自 ItemEntry 只关联使用能力、未关联已装备武器能力。
- `context/extractors.ts` 对注册别名增加单汉字索引，以 `Intl.Segmenter` 的查询词边界补独立单字召回；普通描述不增加全量单字索引。保留范围、权限、候选上限、歧义和预算反馈。
- `item-authority-vnext.ts` 只从精确、可用、确实装备的实例及持有者已有 refs 读取相同来源的冻结 Ability。编译与读取共享 `equippedWeaponMechanicalKey`，现有标识值不变，不解析 opaque definitionId。实际扫描前预付预算，普通物品无需支付未发生的扫描。
- 法术名称复用 `dnd/catalog.ts`，职业资源名称与 canonical ID 提取到 `dnd/class-resources.ts`，供显示、编译映射及检索共同读取。`sourceSpellId` / `costs.resourceId` 通过已登记 `valueLabels` 生成候选词；词表独立冻结并参与 retrieval Profile hash，不改 Ability 正文或机械版本。
- 自然语言能力名称候选限定到行动者冻结的 `abilityRefs`，随后保留原权限过滤。装备、反应、目标和隐藏危害的类型化闭包仍独立执行，不受名称候选集合裁剪。职业资源继续由完整 actor composite 及其版本 hash 携带。

## 代表性矩阵与结果

| 变化维度 | 本地证据 |
| --- | --- |
| 独立简称与全称 | 枪/剑对应复合别名；报纸中的偶然单字不命中纸卷；隐藏和跨场景对象不进入角色候选 |
| 不同装备来源 | main 长剑与 off 短刀经过同一来源函数；同 key 未持有目录记录排除，取消装备后不再载入武器能力 |
| 决定性缺失 | 删除已持有武器的目录正文返回 `criticalUnavailable`；缺失记录来源无法辨认时保守拒绝，不声称它就是该武器 |
| 法术和职业 | 火焰箭、冷冻射线、动作如潮、回气，使用真实编译输出，冻结正文/hash 与权威一致；不读取无关 90 件库存正文 |
| 权属与多候选 | 同名目录记录不授予能力；移除自身 entitlement 后不召回；两项已有能力共用资源时保留两项候选 |
| 直接消费者 | 作者化危害、使用/装备物品、精确实例成本与下一 Context，保持隐藏因果与 Viewer evidence 边界 |
| Room 成功/失败 | 枪械成功：弹药 8→7、目标 HP 20→14、支撑结束；DC40 失败仍扣一次弹药，不改支撑或 HP；自然20/1遵守攻击规则 |
| 恢复与幂等 | 投影失败后复用已 journal 的随机，旁白恢复、响应丢失及 DO 驱逐后不再次掷骰/扣库存；同形 vNext-2 attack 可提交 |

定向命令及最终结果：

```sh
npx tsx --test tests/kp-vnext-context-discovery.test.mjs tests/kp-vnext-context-inventory-scope.test.mjs tests/kp-vnext-authored-context.test.mjs
# 23/23，exit 0；/tmp/zhuwei-vnext-ability-core-final.log
npx vitest run tests/kp-vnext-stage3-room.test.ts -t 'prepares the addressed equipped weapon|runs natural-language gun|non-natural DC 40|post-randomness Claims|attack natural-20|resolves a vnext-2 attack'
# 7 passed / 21 skipped，exit 0；/tmp/zhuwei-vnext-ability-room-final.log
npm run typecheck
# exit 0；/tmp/zhuwei-vnext-ability-typecheck-final.log
```

原最小失败、全称对照和词源缺失均先复现。修复后暴露的旧夹具问题已单独修正：按现有 hazard 合同预先提供 `1d20+2d20`（主检定及可能分支的专注预留骰），先例断言使用当前 scope-selected 形状；机械测试明确写出其固定提案所选择的工具。没有修改生产骰子来迎合夹具。临时 `DEBUG-ability-scope` 已清理。

## 未覆盖与后续

- 本次覆盖注册名称、别名及可分词的单字简称；不等于任意同义改写、指代或复合词都能自动检索。“举枪”等复合动作表述仍有召回缺口，应在通用意图/指代检索验收中处理，不能用动作词白名单补丁。相关机械 fixture 改用完整工具名，未将其冒充该表述已通过。
- NPC 自身的知识检索权限未扩大；角色自身持有 ref 不替代 Viewer grant。真实 NPC 语气、来源对话和多 Viewer 矩阵仍待。
- 尚未新增模型、连续 HTTP 或远端测试；法术/职业的本次证据是上下文选择与资源绑定，不等于其真实模型完整动作资源验收。
- 下一项先拆解并降低 round6 Proposal 的 28,367 输入 tokens，保留决定性上下文，再开展有界真实连续游戏验收。V01–V03 完整采用门和替代生产 V3 仍未完成。
- 未运行全量测试/Lint/build，未 commit/push、部署、迁移、切换生产或删除房间/归档。
