# 烛帷

D&D 第 5 版、3 级、2–5 人 + AI KP 的多人跑团。

房主开房，朋友用房间码入座，完整 5e 建卡。KP 负责叙事、裁决、对抗；环位、引导神力、战争祭司、短休/长休由库存记账，掷出才扣。

当前模组：《黑橡居酒屋的第三份遗嘱》。

## 本地运行

需要 Node.js 20+。

```bash
npm install
npm run dev
```

浏览器打开终端里提示的地址。登录后进酒馆，开一桌或输入房间码。

生产构建：

```bash
npm run build
npm run preview
```

## 目录

- `src/components/` 桌面、建卡、登录
- `src/lib/dnd/` 5e 规则、库存、掷骰加成
- `src/lib/kp/` AI KP
- `src/lib/table/` 房间、结算、战斗
- `src/lib/module/` 模组
- `migrations/` 数据库
