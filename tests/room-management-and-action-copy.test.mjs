import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, projectRoot), "utf8");
}

function sliceBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return text.slice(start, end);
}

test("host can manage a hall table from one menu", async () => {
  const [hall, client, server, route] = await Promise.all([
    source("app/hall/hall-client.tsx"),
    source("app/_runtime/lib/table/client.ts"),
    source("app/_runtime/lib/table/server.ts"),
    source("app/api/game/route.ts"),
  ]);

  assert.match(hall, /管理桌子/);
  assert.match(hall, /创建桌子前选择 KP 模型/);
  assert.match(hall, /创建时已固定/);
  assert.match(hall, /历史人物卡/);
  assert.match(hall, /删除桌子/);
  assert.match(client, /deleteRoom/);
  assert.match(client, /getRoomManagement/);
  assert.match(server, /export const deleteRoom = createServerFn/);
  assert.match(server, /export const getRoomManagement = createServerFn/);
  assert.match(route, /deleteRoom,/);
  assert.match(route, /getRoomManagement,/);
});

test("character sidebar omits redundant controls and wraps action copy", async () => {
  const [playTable, catalog] = await Promise.all([
    source("app/_runtime/components/play-table.tsx"),
    source("app/_runtime/lib/dnd/catalog.ts"),
  ]);
  const characterDetail = sliceBetween(
    playTable,
    "function CharacterDetail",
    "function ResourcePanel",
  );
  const fold = sliceBetween(
    playTable,
    "function Fold",
    "function CharacterDetail",
  );
  const resourcePanel = sliceBetween(
    playTable,
    "function ResourcePanel",
    "function stockForFeature",
  );
  const featureLine = sliceBetween(
    playTable,
    "function FeatureLine",
    "function SpellLine",
  );

  assert.match(
    catalog,
    /吐息武器：动作，3 级 2d6（对应龙种伤害）。15 尺锥或 30 尺线，豁免 DC＝8＋熟练＋体质。短休后可用/,
  );
  assert.match(playTable, /<Fold title="动作"/);
  assert.doesNotMatch(characterDetail, /所在 ·/);
  assert.doesNotMatch(playTable, /<p[^>]*>所在 ·/);
  assert.doesNotMatch(resourcePanel, /点火把/);
  assert.doesNotMatch(playTable, /点火把/);
  assert.doesNotMatch(playTable, /feat:\s*"torch"/);
  assert.match(
    playTable,
    /<aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-\[28px\]/,
  );
  assert.match(
    playTable,
    /className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 \[overflow-wrap:anywhere\]"/,
  );
  assert.match(fold, /min-w-0 max-w-full overflow-hidden/);
  assert.match(fold, /border-t border-border px-2\.5 py-2 min-w-0/);
  assert.match(featureLine, /min-w-0 max-w-full/);
  assert.match(featureLine, /flex-wrap/);
  assert.doesNotMatch(featureLine, /\btruncate\b/);
  assert.doesNotMatch(featureLine, /whitespace-nowrap/);
  assert.doesNotMatch(featureLine, /line-clamp-/);
  assert.match(
    featureLine,
    /className="min-w-0 flex-\[1_1_10rem\] whitespace-normal break-words text-subtle \[overflow-wrap:anywhere\]"/,
  );
  assert.match(featureLine, /whitespace-pre-wrap/);
  assert.match(featureLine, /break-words/);
  assert.match(featureLine, /\[overflow-wrap:anywhere\]/);
  assert.match(featureLine, /createPortal\(/);
  assert.match(featureLine, /role="dialog"/);
  assert.match(featureLine, /max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto/);
});
