import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, projectRoot), "utf8");
}

test("host can manage a hall table from one menu", async () => {
  const [hall, client, server, route] = await Promise.all([
    source("app/hall/hall-client.tsx"),
    source("app/_runtime/lib/table/client.ts"),
    source("app/_runtime/lib/table/server.ts"),
    source("app/api/game/route.ts"),
  ]);

  assert.match(hall, /管理桌子/);
  assert.match(hall, /选择 AI 模型/);
  assert.match(hall, /历史人物卡/);
  assert.match(hall, /删除桌子/);
  assert.match(client, /deleteRoom/);
  assert.match(client, /getRoomManagement/);
  assert.match(server, /export const deleteRoom = createServerFn/);
  assert.match(server, /export const getRoomManagement = createServerFn/);
  assert.match(route, /deleteRoom,/);
  assert.match(route, /getRoomManagement,/);
});

test("expanded action copy wraps without being clipped", async () => {
  const [playTable, catalog] = await Promise.all([
    source("app/_runtime/components/play-table.tsx"),
    source("app/_runtime/lib/dnd/catalog.ts"),
  ]);
  const featureStart = playTable.indexOf("function FeatureLine");
  const featureEnd = playTable.indexOf("function SpellLine", featureStart);
  const featureLine = playTable.slice(featureStart, featureEnd);

  assert.match(
    catalog,
    /吐息武器：动作，3 级 2d6（对应龙种伤害）。15 尺锥或 30 尺线，豁免 DC＝8＋熟练＋体质。短休后可用/,
  );
  assert.match(playTable, /<Fold title="动作"/);
  assert.match(featureLine, /whitespace-pre-wrap/);
  assert.match(featureLine, /break-words/);
  assert.match(featureLine, /\[overflow-wrap:anywhere\]/);
  assert.match(featureLine, /createPortal\(/);
  assert.match(featureLine, /role="dialog"/);
  assert.match(featureLine, /max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto/);
});
