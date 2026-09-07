# Round73：首句施法通过，第二句选错能力并误用知识引用后停批

2026-09-07，默认 deepseek-v4-flash，经正常注册 Cookie → createRoom → lockCharacter → startGame 创建三级知识领域牧师，setup 于 2026-09-07T02:47:31.615Z 完成；没有受伤、能力或资源 fixture。三句原定连续行动只发送前两句：首句提交，第二句引用失败后停批，第三句未发送。

首句原话：`我握住圣徽，对自己施放一次一环的治愈伤口。`。选择、填写、Rules/Room 提交及旁白发布完成，共4次真实模型调用，没有窄修订。真实骰为 d8=5，1d8+3=8；角色原本满血24/24，实际 applied=0，生命值没有增加。一环资源 core.slot1、公开 slot1、combat spellSlot:1 从4同步变为3，上限均为4，未出现 core/公开 spellSlot:1 别名；二环余额保持2。首句9个事件、1个 Receipt，oneDie/oneSlot、随机 journal finalized 与无未完成 continuation 检查通过。原 submission duplicate 新增0次模型调用，权威状态、事件、随机、Receipt、结果及 delivery 不变，随后 ACK 成功。

实际公开旁白为：“你握住圣徽，对自己施放治愈伤口。法术完成，但你的伤势并未因此好转，生命值仍是24；你的可用施法资源也因此减少，剩余3次。”原 gate1 在阅读这段新旁白后，将满血状态下的“伤势”表述和笼统的“可用施法资源剩余3次”记录为表达不够精确；3对应一环池，二环仍有2。原复核未认定具体机械矛盾，也没有实际治疗量被虚构的证据。本回执保留这个判断及文字质量缺口，不改判为全面叙事通过。

第二句原话：`我对自己念出治愈真言，使用一环法术位。`。第5次调用仅选择 abilityOperation，第6次返回的 JSON 语法合法，但 operation.abilityRef 再次选择上一句的 cure，未选择本句要求的 healing-word；target.kind=creatures 的 refs[0] 却填入自身开场知识记录 `character:e1b69b34-3d78-493c-ae70-9739ad344e12:module-opening:wake`。该引用存在于获授权 knowledge 和 viewerEvidenceRefs，属于知识记录而非 entity；“在上下文中可引用”不能证明它可作生物目标。实际返回 PROPOSAL_REFERENCE_INVALID / notCommitted / notApplicable，没有第二次机械效果。

原始遥测只记录 `REFERENCE_UNAVAILABLE / unrecognized`，不能冒充已经准确指向模型字段。机器证据另外保留原 arguments、实际字段位置及冻结上下文核对结论；第二句原 arguments SHA256 为 `e027b4411410429ee27150871e61be846a4f73f20dbbfb681ef3aaf869f3b493`。选错法术是对草稿和原意的独立观察，不伪装成当时校验器已经报告的另一项诊断，也不改写旧错误或补造 constraint/修复权限。

gate2 于 2026-09-07T02:52:47.982Z 原样记录 formatFailure / stop；第二句后 state、events、randomnessBatches 与首句后完全相等，一环仍3、二环仍2、生命24/24，没有新增骰、扣资源、事件或旁白。未替换法术或目标后重试，第三句未发送。本批两份提案都没有冗余 intent echo，四条提案 journal 的 repair_ticket_json 均为空；没有窄修订调用，不能据首句成功声称 echo 修复已由真实模型验证。

两次行动各自的选择/填写请求与响应均与 Room journal 精确相等，同一行动的冻结 contextHash 相同且 user 正文逐字相同。共6次真实模型调用，实际输入102,451 tokens（缓存命中12,160、未命中90,291），输出734 tokens；按本日已保存并核验哈希的官方峰价分别计算，费用为 **¥0.2786950**。逐调用为 ¥0.0757588、¥0.0772912、¥0.0041396、¥0.0078904、¥0.0560188、¥0.0575962；计入全部 completion tokens。这是依据 usage 与已核价计算，并非供应商账单。保守 meter 不计缓存优惠为 ¥0.313959，均在 ¥5 上限内。

本批按原 gate 计格式失败1，其中引用失败1；JSON语法失败0、提案机械规则拒绝0、明确机械不一致0、已认定叙事矛盾0、窄修订0、Viewer恢复0。引用失败与格式失败不重复相加；选错能力未执行，不能算成实际施放错法术。首句措辞限制单独保留，零已认定矛盾不代表任意叙事可靠性。

收尾 replay 的 pinnedProfilesMatch=true、exactState=true，stateVersion=9、事件9。321项源码起止 allEqual=true，分支和 HEAD 未变，初始 manifest 内的 manifestSha256 为 `9b47fc0d366dbd080c0af8d6655b164ab1ab7f982b3701bfc3ef659d25f7b93e`，清单文件字节哈希另列机器证据。本批 game/capture 在 2026-09-07T02:52:48Z 停止，关闭记录确认当时进程和4320/4321端口消失；detached退出码不可取得，不记为 exit 0。该证据仅代表本批收尾时刻，不代表后来批次或当前端口状态。

[机器证据](vnext-round73-live-evidence.json)。原始 capture、冻结上下文、journal 与状态在 `/tmp/zhuwei-round73-ability-preparation/evidence` 私有保存；公开文件不包含 Cookie、密码、私有上下文正文或模型推理。第二法术成功、第三句追问、连续三步稳定性、受伤目标治疗及真实 echo 修订均未覆盖，不声称成功率提高。本次只新增这两份文档；没有修改源码、其他文档/脚本或 round74 准备包，没有追加API、运行代码测试、部署或push。
