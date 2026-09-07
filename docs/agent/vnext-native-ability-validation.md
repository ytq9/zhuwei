# 已注册能力入口开发回执

> 当前进度：[round69](vnext-round69-validation.md) 初始化误判和 [round71](vnext-round71-validation.md) 资源同步已修复；[round72](vnext-round72-validation.md) 首施法及幂等检查完整通过，第二句因重复填写服务器 intent 被拒、第三句未发送。下文 v35 集成验证为历史检查点，当前填写协议为 v37；完整能力链与稳定性尚未通过。

2026-09-07，cloudflare / 258caee404e0814405eb497653ee9f00d647b773。28 文件按逐文件基线及新 SHA 串行集成，0 冲突；原有未提交工作及 root 新增真实目录测试保留。精确清单见[集成记录](vnext-native-ability-integration.json)。没有 commit、push、部署或远端修改。

能力合同：KP 从冻结的本人能力目录选择已注册能力、实际目标及 normal/ritual，或选择本人持续施法 Activity 的继续/取消；服务器生成固定裁决外壳与依赖，既有 Rules 执行费用、骰子和效果。模型不重复填写 DC、法术位覆盖、时间或成败后果，原稿、冻结上下文、完整重验及一次安全窄修订保留。parser v35 延续首轮选择、次轮填表；真正已选执行家族才能用第三次已证明的修订，小表单不能借闲置能力增加预算。

代表性矩阵与直接消费者：原生即时/长施法/仪式、目标类别与明确继续/取消走同一 source schema→validator→lowerer→原子 native executor；缺目标和覆盖成本拒绝，根外壳修复保持原目标并只确认一次。Room 保存骰后驱逐恢复与重复请求不新增调用、骰面或资源。正常 compileSheet→Room 初始化与两种后续角色加入路径共用 planPlayerAbilityCatalog，初态登记原源定义 hash；受控两人 Room 中 cure→healing-word 各一骰、一槽，随后入座/建角、驱逐和 replay 通过。

本次直接修复：正常建卡原先放入 raw 能力，现使用同一注册编译结果；非战斗施法不残留虚构战斗 turn；未有执行器的描述性/空效果与混入的 grants 拒绝，free 治疗执行真实效果，ActionSurge 仅保留真实战斗中的既有单行动 grant。单步原子随机链复用既有 AtomicWorldInteractionStepsResolved 清理器，避免已施法却阻断后续成员操作；同驱动器的物品使用也覆盖清理、消耗、治疗及 replay。

主树最终定向验证：Node 89/89、原子消费者 2/2、Worker 60/60、typecheck 均 exit0；日志及精确命令见集成记录和本次 refactor-log。真实目录 guidance、silence 普通/仪式、guiding-bolt 的不完整执行均拒绝，cure 正常一槽一骰并 replay。受控 fixture 的长施法成功不能算正常建卡真实目录成功；本地检查不代表模型稳定性提高。该检查点之后的正常 Cookie HTTP 结果见顶部 round69/71，原本地结果不覆盖后续真实失败。

已知 Goal 阻断：三张完整角色卡在同房会触发 SQLITE_TOOBIG。原失败及量化保留于 /tmp/zhuwei-kp-ability-three-player-repro.test.ts 和 /tmp/zhuwei-kp-ability-three-player-size.json；第三张候选 8,435,752 字节，其中 correctionRuntime 8,168,984，注册能力定义仅 75,621。来源是逐事件整集合更正快照重复增长，未改 correction/store 或删除历史。两个独立两人 Room 只证明两种角色入口，不证明三人容量。

未覆盖：正常真实长施法/仪式目录、全部目标合法性及视觉条件、完整战斗/多人连续链和实际模型稳定性。旧 ActionSurge 回归文件的 shove 与第二次 shatter 两个失败在未应用本补丁基线上同位重现，未算通过，也未扩大本包修复范围。完整 Goal 保持 active。

2026-09-07 补充：[能力身份误判骰式修复](vnext-ability-identity-validation.md) 已完成定向验证。round69 正常锁卡后初始化真实失败源于编译器扫描全部字符串，把 UUID 派生能力 ID 当超限骰式；现仅检查实际 formula，保持机械上限、Profile 和 hash 算法。主树 Node22/Room5、原输入离线四组合4/4及 diff-check 均通过，未改类型故未重复 typecheck。原 round69 仍是0模型调用的初始化失败；初始化原因汇总链未改，不称完整诊断已解决。round71 正常初始化恢复、首施法填写/提交通过但资源同步失败；详见顶部真实回执，未把施法提交当作验收通过。
