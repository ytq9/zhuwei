# 回执：DeepSeek 严格模式对照实验（2026-10-02）

- 授权：用户看过实验设计（14 次调用、约 5 千 token）后回复“可以”。
- 目的：确认 DeepSeek 的严格模式（`strict: true`，beta 端点）是否真的约束工具参数。起因是 180 次保存的严格调用里有约束解码不可能产生的违规（枚举外的值、缺失或多余的字段、重复字段、解析不了的 JSON），见 [incident-munycxry](incident-munycxry-20260930.md) 的统计和 [ADR 0077](../../adr/0077-an-unreadable-review-or-second-reply-is-sent-once-more.md)。
- 实际花费：14 次调用，全部 HTTP 200；输入 4,890 token，输出 2,923 token（含思考 2,144）。

## 做法

请求经项目自己的绑定发出：严格请求用 `createDeepSeekStrictToolBinding`（`https://api.deepseek.com/beta/chat/completions`），对照组用 `createDeepSeekAuthoritativeBinding`（普通端点）。请求的组装与线上相同（`deepSeekRequestBody`，`parallel_tool_calls: false`，`stream: false`）。

工具只有一个字段，只许填“甲”或“乙”，不许有其他字段：

```json
{"type": "object", "properties": {"answer": {"type": "string", "enum": ["甲", "乙"]}},
 "required": ["answer"], "additionalProperties": false}
```

系统消息要求调用 `pick` 一次；用户消息要求 `answer` 填“丙”，并另加字段 `note` 写“我加的”。思考关闭时 `tool_choice: "required"`、`max_tokens` 300；思考开启时按 [ADR 0069](../../adr/0069-the-deepseek-narration-review-reasons-before-it-reports.md) 用 `tool_choice: "auto"`、`max_tokens` 2000。模型名用 DeepSeek 现行的 `deepseek-flash` 和 `deepseek-v4-pro`。

## 结果

| 组合 | 端点 | 3 次（对照 2 次）返回的参数 |
|---|---|---|
| deepseek-flash，思考关 | beta，strict | 3 次都是 `{"answer": "丙", "note": "我加的"}` |
| deepseek-flash，思考开 | beta，strict | 3 次都是 `{"answer": "甲"}` |
| deepseek-v4-pro，思考关 | beta，strict | `{"answer": "甲", "note": "我加的"}` 1 次，`{"answer": "丙", "note": "我加的"}` 2 次 |
| deepseek-v4-pro，思考开 | beta，strict | 3 次都是 `{"answer": "甲"}` |
| deepseek-flash，思考关 | 普通端点（对照） | 2 次都是 `{"answer": "丙", "note": "我加的"}` |

全部响应的结束原因都是 `tool_calls`；返回的模型名与请求一致（`deepseek-flash`、`deepseek-v4-pro`）。

## 结论

- 思考关闭时，严格模式对两个模型都没有约束作用：beta 端点的输出与普通端点相同，枚举外的值和多余字段都照样出现。裁决填写、NPC 作答和回答审核都在思考关闭下运行，所以这些调用的格式只能靠服务端自己的校验和修正轮次。
- 思考开启时，6 次都符合格式，没有照指令填“丙”或加字段。这次没有保存思考内容，分不清是解码受到约束，还是模型推理后自己守住了格式。
- 请求里原用的 `deepseek-v4-flash` 是 DeepSeek 已退役的旧名（2026-09-10 起转到 DeepSeek-V4.1-Flash），本实验直接用现名 `deepseek-flash`，调用正常。

## 未覆盖

- 思考开启时是否真有约束解码（需要保存思考内容，或用模型推理也无法满足的格式再测）。
- 用真实的复杂表单（裁决填写）开启思考后的违规率、延迟和费用。
- 原始响应只存在本次会话的临时目录，重启后丢失；以上表格是完整记录。
