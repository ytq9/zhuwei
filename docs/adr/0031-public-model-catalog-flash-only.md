# ADR 0031：公开模型目录只保留 DeepSeek V4 Flash

- 状态：已接受
- 日期：2026-09-19
- 依据：用户于 2026-09-19 决定「现在就只保持 Flash」，并确认一并删除 Pro 的 V5 Profile。
- 当前规则：[SPEC 0011 §3 免费额度与成本预算](../specs/0011-reliability-correction-observability-and-evaluation.md)
- 取代范围：SPEC 0011 §3 2026-08-28 修订中公开 `deepseek-v4-pro` 的部分；[登记册 DEC-016](../specs/decision-register.md) 中「创建桌子时还可选择 `deepseek-v4-pro`」的表述从此只是历史。

## 背景

2026-08-28 起公开目录有 Flash 与 Pro 两个 DeepSeek 模型。`ce349be`（2026-09-08）让新房只绑定当前 vNext 工作流的模型：大厅只显示 Flash，API 对 Pro 返回「这个模型不支持新规则房间」，但 §3 没有跟着改。Pro 在代码里只剩一个 V5 私有 Form Profile，它只服务 [ADR 0028](./0028-abandon-persisted-v5-private-form-rooms.md) 已放弃的旧房间。

## 决定

1. 公开模型目录只有 `deepseek-v4-flash`。`deepseek-v4-pro` 从目录、大厅、API 校验和 V5 Profile 表中删除，不保留常量。
2. 目录与新房可选模型是同一份列表，不再单设「新房模型列表」。
3. 已持久化的 Pro 房间不再解析出模型 Profile；页面对其只显示通用兼容文案，与既有退役模型相同。

## 后果

- 再公开第二个模型时，须为它绑定 vNext 工作流并修订 §3，而不是恢复本次删除的代码。
- SPEC 0011 §3 的门补上 `tests/product/characters/interaction-contract.structure.test.mjs` 与 `tests/product/identity/rendered-html.http.test.mjs`。
