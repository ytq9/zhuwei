# Round83：承诺填全了、修订第一次真实触发，骰子掷了个 3

2026-09-08 中午，源码 `09d558b`（parser v47：承诺 `authorityRefs` 有了描述，重发提示词提到括号配对）。场景与 round82 相同（一小时内抄副本 / 等一个多小时 / 看账台）。正常注册建卡，初态核对通过。只发了第一句。

## 结果

首句 **5 次调用，committed 且 published**。模型把请求裁成魅力检定 DC 13（`duration: "10min"`）；真实 d20 掷出 **3**，走失败分支：瓦罗按镇法要求来客先说清从哪来、为谁办事，拒绝当场誊抄。`consequences: []`，没有承诺，没有计划。时钟 0 → 600000000。费用 ¥0.190383（无未知 usage）。

第二句「等一个多小时看副本」的前提不成立，按纪律记 `legalRefusal` 停止，不重采。

## 两个第一次

**承诺填全了。** 被接受的成功分支里：

```
{ "kind": "promise",
  "content": "一小时内把这份文书的副本抄好，送到账台上放着，供旅行守卫取走。",
  "condition": "旅行守卫把原件文书留给他誊写。",
  "authorityRefs": ["npc:black-oak-will:varo"],
  "due": "1h",
  "trace": "账台上放着一份墨迹尚新的文书副本，与瓦罗掌心的原稿字迹一致。" }
```

round82 缺的 `authorityRefs` 这次填对了（描述起了作用）。`due`、`trace` 连续两批填对。如果骰子过了，这一束会在同一根里派生瓦罗的定时计划——那条链在本地测试里通了，真实批次差一个 13 以上的点数。

**真实窄修订第一次触发。** 填写的 tool arguments 结尾又多了一个括号（这次是 `}`）。与 round82 不同，这次服务器的完整根语法证据判定可修（`json:object-delimiter-expected`，`complete-root-members-frozen`），第 3 次调用是真实的 `correct_kp_proposal_bundle`，模型回 `confirm: "server-plan"`、零条摘要，束随即被接受。round73 起交接里一直写着「窄修订机制齐了，模型从未触发过」，这一条现在有证据了。

round82 与 round83 结尾都多一个括号：长草稿（双分支 check、每分支带 motive 与 basis，1000+ token）的收尾是这个模型的稳定弱点。round82 多的是 `]`（根成员损坏，不可证）、round83 多的是 `}`（根成员完整，可证），两者命运不同只差一个字符。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`，端口无监听。replay `exactState=true`，stateVersion 9，9 条事件。323 项源码起止 `allEqual=true`。

[机器证据](vnext-round83-live-evidence.json)。私有证据在 `/tmp/zhuwei-round83-npc-preparation/evidence`。

## 未覆盖

第 2 层派生、第 3 层执行、第三句旁白仍然没有真实证据；这批是骰子，不是缺陷。同一场景再跑一批的成功率取决于模型是否再裁成检定以及 d20。
