# AGENTS.md 项目级工作流审查回执

- 日期：2026-09-13。
- 范围：按用户要求及 [spec-workflow](../../../.claude/skills/spec-workflow/SKILL.md)、`writing-for-agents` 审查代理文档的职责与直接引用，仅调整文档。
- 验收对象：[AGENTS.md](../../../AGENTS.md) 只保留任务范围、权威读取、开发与修复闭环、验证、文档维护、授权和交付流程。具体功能、实现和专项决定通过按需入口读取。

## 内容归属核对

| 原内容类别 | 承接来源与处置 |
| --- | --- |
| 产品版本、协议与历史数据兼容 | [SPEC 0013](../../specs/0013-versioned-runtime-profiles.md)、[ADR 0013](../../adr/0013-v3-product-generation-and-repository-boundary.md)、[README](../../../README.md) 已有对应内容；去除 AGENTS 重述 |
| 专项退役授权、真实 API 调用与预算 | [生产替换 TODO](../vnext-production-todo.md) 保留原有适用范围；[指导索引](../README.md) 提供按需入口 |
| 产品权力、状态、秘密、多人行动与时间行为 | 主 PRD 及直接补充 SPEC 已承载；AGENTS 保留规格读取和变更流程 |
| 当前平台、模块与公共接口 | README、[repo map](../repo-map.md) 与相关 ADR 已有来源；具体接口名称退出 AGENTS |
| 模块求值、认证与 OAuth 条件 | 唯一细节移入 README 的架构、身份与密钥章节；已有密码、会话摘要及 cookie 描述复用原文 |
| 具体内容编写指导 | 从指导索引按任务读取写作指导与专项补充 |
| 检查工具、规格维护与基线步骤 | 统一由 spec-workflow 提供；AGENTS 保留触发条件与开发期范围限制 |

直接消费者核对：CLAUDE 的导入继续指向 AGENTS，产品规则不再被指向代理文件；发布指导分别指向项目流程与主 PRD；技能引用的「产品需求与规格权威」「Bug 修复闭环」及任务书引用的「规格工作流」标题保留。AGENTS 的发布入口修正为实际存在的 `docs/agent/releases/release.md`。

## 实际检查

- 主体及直接消费者的 33 条相对链接全部可解析；`git diff --check` 退出 0。
- AGENTS 从 170 行、10,173 字符变为 107 行、5,501 字符；逐段核对内容归属与最终 diff。
- 全仓链接基线检查退出 1：报告 6 条指向 `handoff.md` 的基线外断链。修改前的 JSON 检查已有完全相同的 7 条断链（另 1 条在既有基线内）；本次未新增断链，也未修改基线。
- 未修改 SPEC、ADR、代码、技能或测试；未运行代码测试、构建、外部 API、部署和 push。

本回执证明文档归属、入口和差量；没有模拟新 agent 会话，不能据此声称实际技能触发率或工作流遵循率已测量。
