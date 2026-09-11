# docs/agent 目录结构

本目录原为 307 个平铺文件，研究、提案与验收回执混在一层。现按用途分开：

| 目录 | 内容 | 数量 |
| --- | --- | --- |
| `proposals/` | 合同提案、方案与裁定依据（`*-proposal.md`、`*-plan.md`、`*-decision.md`、`*-redesign.md`） | 17 |
| `receipts/` | 验收回执，一次性证据（`*-validation.md`） | 137 |
| `fixtures/` | 集成夹具与真实响应样本（`*.json`） | 133 |
| `releases/` | 发布与推送记录 | 6 |
| `research/` | 外部调研笔记（`*-research-YYYYMMDD.md`） | 3 |
| 根目录 | 指导文档与当前工作项：剧本写作指导、handoff、repo-map、production-todo 等 | 11 |

回执与夹具是历史证据，读完即可归档，不作为当前产品行为依据；产品合同在 `docs/specs/`，技术决策在 `docs/adr/`。

`node tools/check-doc-links.mjs` 检查本仓库 Markdown 的相对链接是否可解析。
