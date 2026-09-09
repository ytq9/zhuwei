# Round96：关系变化引用了 NPC 看不到的隐藏事实，同一类裸代码缺口

2026-09-09 晚（空闲时段），源码 `7fdfd98`，场景同 round82–91，本地上限 10。**首句 3 次调用后 `PROPOSAL_REPAIR_EXHAUSTED / needsKp`，0 事件，¥0.313281（峰值计）；未发第二、三句。**

## 首句

| 调用 | 工具 | 估算输入 | 真实 prompt tokens | 输出 |
| --- | --- | --- | --- | --- |
| offer | offer_kp_proposal_bundle（选 social） | 32,289 | 27,821 | 46 |
| 填写 | submit_kp_proposal_bundle | 39,422 | 34,840 | 1,749 |
| 修订 | correct_kp_proposal_bundle（patch） | 42,644 | 35,874 | 169 |

填写稿本身成形：说服检定 DC 14，承诺主体是瓦罗、玩家、原件实例与场景（本次承诺主体枚举与说明生效），交付来源是原件实例。

## 为什么停

成功分支的关系变化写了 `basisFactRefs: ["fact:module:black-oak-will:first-will"]`。这是只有主 KP 能看到的隐藏事实，不在瓦罗的决策快照里；Rules 预检 `social:consequence-basis-unavailable` 拒绝，回给模型的仍是无路径裸代码，模型用唯一一次补丁改了承诺主体，行动以 needsKp 结束。与 round94 同一类缺口，只是换了一格：`basisFactRefs` 也是无枚举的自由引用。随后已补：`npcSourceChoices` 增加各 NPC 可见事实 `factRefs`，关系与债务的 `basisFactRefs` 改为该枚举，lowering 用 Rules 同一判定预检并带 `results/行/relationshipChanges/行/basisFactRefs/序号` 路径；承诺的 promiseeRef 与 authorityRefs 也一并预检。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`。replay `exactState=true`，0 事件。389 项源码起止 `allEqual=true`。[机器证据](vnext-round96-live-evidence.json)。私有证据在 `/tmp/zhuwei-round96-npc-preparation/evidence`。
