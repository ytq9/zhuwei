# Round82：模型第一次就填了承诺档位，草稿倒在结尾多出的一个「]」

2026-09-08 中午（北京时间高峰时段），源码 `9bbd007`（parser v46：承诺档位合同）。用户当日批准的几小时尺度三句：请瓦罗一小时内抄一份备案副本送到账台；在厅里等一个多小时；到账台看副本在不在。每 HTTP 上限按用户裁定升到 7。正常注册建卡，初态核对通过。只发了第一句。

## 结果

首句 **3 次调用后停批**：选择 `["social"]`；填写返回一个 `check`（魅力，DC 14，`duration: "5min"`）带成功/失败两条 social 分支，1208 个输出 token；tool arguments 在倒数第五个字节处多了一个 `]`（`"consequences": []}]}]}}`），无法解析。未解析重发（第 3 次调用）返回了**逐字节相同**的内容。`PROPOSAL_FORM_INVALID`，`modelPermanent`，未提交，stateVersion 0。费用 ¥0.197469（无未知 usage）。

## 合同的 KP 半边：第一次暴露就填对了档位

同一份被拒草稿的成功分支里：

```
"consequences": [{ "kind": "promise",
  "content": "瓦罗在半个时辰（约一小时档）内于厅内誊抄一份备案副本，送到账台供旅行守卫取走；原件始终在他自己手中核对不交出。",
  "condition": "旅行守卫留在厅内等候且不出席其他事项。",
  "authorityRefs": [],
  "due": "1h",
  "trace": "账台多出一张盖印的新抄备案纸，墨迹尚新，交到领收者手中。" }]
```

模型第一次见到 `due` 就选了 `1h`，`trace` 写的正是到期后账台上会出现的东西——这是「KP 会填、且填得对」这一半的第一份真实证据。瓦罗的台词也自洽：「我不出这厅子，半个时辰后你来账台取」。

同一份草稿里还有一个会在下一步被拒的错误：`authorityRefs: []`。校验器要求承诺至少引用一个授权来源（NPC 自己）。wire 上这个字段没有任何描述，模型不知道该填什么。

## 停批的真正原因

JSON 结尾括号不平衡。这是 round74 之后第二次撞上语法级失败（round74 是未转义的 ASCII 引号）。两次都是长草稿：本次 1208 token、双分支、每分支带 motive 与 basis。重发机制按设计只让模型重发一次，模型把同样的字节又发了一遍。服务器端没有可以证明语义等价的修法：损坏在 `decision` 内部，顶层没有完整成员可用。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`，端口无监听。replay `exactState=true`，0 事件。323 项源码起止 `allEqual=true`。

[机器证据](vnext-round82-live-evidence.json)。私有证据在 `/tmp/zhuwei-round82-npc-preparation/evidence`。

## 未覆盖

第 2 层派生、第 3 层执行、第三句旁白都没走到；`authorityRefs: []` 是否会成为下一个拒绝点也只是推断。下一批前该做的一件小事：给承诺的 `authorityRefs` 加描述（至少填该 NPC 自己的引用）。
