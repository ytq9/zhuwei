# 本地预览创建房间 500 修复与迁移审计

日期：2026-09-14。对象：`cloudflare` 工作树的 `http://localhost:3000` 与默认 `.wrangler/state` 本地 D1。用户要求启动本地预览，随后报告点击“我来做房主”返回 500。

## 根因与处理

独立本地诊断账号通过正常注册、登录与 Cookie 会话调用游戏 API。迁移前连续两次复现：`listMyRooms` 返回 200、空列表；`createRoom` 返回 500 和用户报告的脱敏错误。数据库只登记 `0000`–`0006`；查询创建房间所需列得到 `no such column: kp_model_profile`，同时缺少 `kp_workflow_manifest`、`kp_context_planner_profile`。这是本地启动前遗漏迁移检查，无须改变产品行为或隐藏错误。

1. 用 SQLite backup API 保存一致性备份至 `.wrangler/backups/preview-migration-20260914/before-migrations.sqlite`，权限为 `0600`。私有数据库备份留在 Git 忽略目录。
2. 逐条阅读已有 `0007`–`0013`，确认退役的四张表均为空；运行 `npx wrangler d1 migrations apply DB --local`，7 项迁移完成，退出码 0。未生成或编辑 migration。
3. 迁移后数据检查发现：`0012` 重建 `rooms` 时，外键级联删除了原有的成员、人物卡、genesis 归档和投影审计归档，各 2 行。该脚本的 `PRAGMA foreign_keys=OFF` 在本次 D1 执行中未阻止这一结果。
4. 从迁移前备份，在启用外键校验的本地事务中仅插入上述缺失记录，保留迁移后的表结构和新写入数据；随后按原有全部列逐行比对。没有将旧房转换为当前产品版本。

## 验证与清理

同一 HTTP 复现脚本迁移后得到 `createRoom` 200、`ok: true`；新房出现在 `listMyRooms`，`fetchTable` 和 `getRoomManagement` 均返回 200、`ok: true`。匿名 `createRoom` 返回 401。没有开始游戏或调用真实模型、语音服务。

清理本次唯一诊断账号、其会话和筹备态测试房间后，备份中的原有记录逐行保留：3 个账号、3 个原会话、2 个房间、2 个成员、2 张人物卡、2 条 genesis 归档和 2 条投影审计归档。`PRAGMA foreign_key_check` 无违规。诊断脚本与凭据文件已删除，脱敏核对结果保存在同一备份目录的 `verification.json`。

## 边界与遗留

只修复本地预览环境，服务继续监听 3000。未修改业务代码、SPEC 或现有 migration；未执行全量测试、构建、远端迁移、部署或 push。用户原有工作区差量保留。

已有 `0012` 的关联数据丢失风险需单独修复迁移执行方案；本次通过备份恢复闭合当前本地数据保全，不证明其他环境可直接安全执行该 migration。未重测已退役房间的游戏运行，也未验证真实 KP 叙事。
