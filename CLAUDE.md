# CLAUDE.md

本仓库的代理合同是 [AGENTS.md](AGENTS.md)，下面把它整篇导入。**不要在本文件里复制它的内容**——两份副本迟早分岔，而分岔时读者信的是先读到的那一份。要改规则就改 `AGENTS.md`。

@AGENTS.md

## 最常用的三条

规格工作流的完整说明在 `AGENTS.md` 的「规格工作流」一节。日常只需要记住：

- **SPEC 说规则现在是什么，就地改写；ADR 说为什么、何时、取代了什么，写完不追加；回执说当时验到了什么，不再修改。**
- 改了某条 SPEC 条款，就改它 `gates` 里的测试。规则真变了不要盖 `gates_verified_on`。
- 修 Bug 时在测试或代码里写上 `SPEC NNNN §x.y`，否则这条规则等于没有实现证据。

改完跑：

```bash
npm run spec:check
```

```bash
node tools/check-doc-links.mjs
```

```bash
npm run gate
```

当前待办任务书在 [docs/agent/README.md](docs/agent/README.md)。
