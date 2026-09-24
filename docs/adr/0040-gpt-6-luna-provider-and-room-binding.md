# ADR 0040：为 GPT‑6 Luna 注册独立调用与房间绑定

- 状态：已接受
- 日期：2026-09-23
- 依据：用户要求接入 GPT‑6 Luna，并明确确认修订单模型限制。
- 当前规则：[SPEC 0011 §§3–4](../specs/0011-reliability-correction-observability-and-evaluation.md)
- 窄取代：[ADR 0031](./0031-public-model-catalog-flash-only.md) 的单模型目录限制；Pro 及已退役 Profile 的处置不变。

## 背景与决定

原调用和恢复校验都绑定 DeepSeek。新增目录项必须同时提供独立的 Provider 传输、vNext Profile、workflow 与房间持久化绑定，否则恢复阶段会按另一种请求重建调用。

采用 OpenAI 官方 Chat Completions endpoint，不增加 SDK 依赖。按照 [GPT‑6 Luna 模型文档](https://developers.openai.com/api/docs/models/gpt-6-luna)，工具调用固定使用 `reasoning_effort: none`。仅在传输层将内部 schema 的 `$def`/`$ref` 转成标准 `$defs`，保持闭合 strict schema、领域字段和现有 KP/Rules 责任链。统一请求序列化供预算、调用账本、网络发送与恢复校验使用，避免同一调用出现两种请求身份。

保留既有 DeepSeek workflow 的内容与哈希；Luna 注册独立 workflow。D1 继续保存完整 Profile/workflow，DO 使用已有 `authority_json_blobs` 保存模型标识，无需新增 SQL 表或迁移。过去没有模型标识的房间按其原本唯一的 DeepSeek 绑定解释，显式未知值拒绝。

归档 envelope 的可选 `kpModelId` 纳入原 contentHash；新模型显式保存，恢复与历史分支继承它。现有 DeepSeek 归档保持原格式。模型绑定只保存公开标识，不包含凭据。

继续使用现有保守的调用与 token 预算，成本数字只是准入估算，不冒充 OpenAI 账单。30 天密钥有效期不硬编码到模型目录或房间；更换凭据不改变已冻结的模型身份。
