# Round72：首句资源同步通过，第二句因额外字段拒绝

2026-09-07，parser v36，默认 deepseek-v4-flash，通过正常注册 Cookie → createRoom → lockCharacter → startGame 创建三级知识领域牧师，无受伤、能力或资源 fixture。原定三句连续行动只发送了前两句：首句完整通过，第二句发生填表错误后停批，第三句未发送。不能据此宣称连续三步稳定。

首句原话“我握住圣徽，对自己施放一次一环的治愈伤口。”完成选择、填写、Rules/Room 提交及旁白发布，共4次真实模型调用，无窄修订。decision1 的机械与公开结果验收通过：一环资源 core.slot1、公开 controlledCharacter.slot1、combat spellSlot:1 均从4变为3，上限均保持4，core/公开没有再产生 spellSlot:1 别名。二环资源保持2。真实骰为 d8=4，1d8+3=7；角色原本满血24/24，实际 applied=0，生命值没有增加。

实际公开旁白为：“你握住圣徽，对自己施放了一环治愈伤口。施法完成后，你的生命值仍为24，并未发生变化；该法术的资源剩余数量为3。”原 submission 重复验证新增0次模型调用，Receipt、delivery、完整权威状态、事件与 randomness journal 均不变；随后 ACK 成功。首句共9个事件、1个 Receipt，随机批次已 finalized，无未完成的内部 continuation。

第二句原话“我对自己念出治愈真言，使用一环法术位。”只用了选择和填写2次调用。模型返回的 JSON 语法合法，operation 指向原治愈真言、自身目标和 normal 施法；但在 decision 下额外填了 intent，重复 submissionRef、actorRef、text。该次实际 schema 只允许 kind、operation，返回 PROPOSAL_FORM_INVALID，当前实现未准入窄修订。该操作未提交，没有新骰、扣费、事件或旁白；第二句后权威状态、事件和 randomness journal 与首句后完全相等，一环余额仍为3。

保留原始诊断：服务端遥测为 `VALUE_INVALID / terminal.intent`；模型实际填写位置是 `decision.intent`。前者是解码后路径，位置映射另案修复。本回执不把旧诊断改成新诊断，也不补造未记录的 constraint、修复权限或具体原因。原 arguments SHA256 为 `f817a8f03a237b0a78febcf3b9a2f3df56a2449f5bead13e8e68059138c14729`，机器证据保留原 draft。能否证明安全地省略该冗余字段须另行处理；本批没有删字段重试，也没有改判第二句结果。

共6次真实模型调用，实际输入101,506 tokens（缓存命中8,064、未命中93,442），输出885 tokens。按本日已核验官方高峰价、分别计算缓存命中/未命中/输出，费用为 **¥0.2890974**；这是依据 usage 的计价计算，并非供应商账单。保守 meter 不扣缓存优惠时为 ¥0.312483，两者均在本批 ¥5 上限内。具体逐调用金额见机器证据。

本批计格式失败1、JSON语法失败0、机械规则拒绝0、明确机械不一致0、已观察叙事矛盾0、窄修订0、Viewer恢复0。零机械不一致只覆盖首句已验收和第二句未产生效果的实际结果；第三句状态追问、第二法术成功及连续三步稳定性仍未覆盖。

停批后精确Room提取与冻结源码下 replay 通过：9个事件、stateVersion=9、exactState=true；321项源码起止 allEqual=true，初始 manifest SHA256 `ef2c660d9d8ab2cd43cf941150a99bbc12184515e3bc8babcc4bc2371737bbd9`。本批 game/capture 均已停止，关闭记录确认端口4320/4321当时消失；detached进程退出码不可取得。该关闭结论属于本批收尾时刻，不代表后续串行批次当前的端口状态。

[机器证据](vnext-round72-live-evidence.json)。私有原始 capture、冻结上下文、Room journal 和状态快照位于 `/tmp/zhuwei-round72-ability-preparation/evidence`；公开文件仅提取本角色行动、公开旁白及必要诊断，不包含 Cookie、账号密码、其他角色秘密或模型推理正文。原批次结果保持不变；本次文档收尾没有修改源码/脚本、追加API、运行代码测试、部署或push。
