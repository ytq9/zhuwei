import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { STORY_ROOM_PROBE_CASES } from "./story-live-room-cases.mjs";

const bridgeUrl = process.env.ZHUWEI_STORY_PROBE_BRIDGE_URL;
const token = process.env.ZHUWEI_STORY_PROBE_BRIDGE_TOKEN;
const caseId = process.env.ZHUWEI_STORY_PROBE_CASE;
const actionText = process.env.ZHUWEI_STORY_PROBE_ACTION;
const mode = process.env.ZHUWEI_STORY_PROBE_MODE;
if (process.env.ZHUWEI_STORY_PROBE_ENABLED !== "1" || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(bridgeUrl ?? "")
  || !/^[a-f0-9]{64}$/u.test(token ?? "") || !STORY_ROOM_PROBE_CASES.some(value => value.caseId === caseId && value.implemented)
  || typeof actionText !== "string" || !actionText.trim() || actionText.length > 1200 || !["live", "preflight"].includes(mode)) {
  throw new Error("Use the explicit --preflight or --live CLI; this test must not discover credentials or enable live calls itself.");
}
export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  resolve: { alias: {
    "@": fileURLToPath(new URL("../../app/_runtime", import.meta.url)),
    "next/headers": fileURLToPath(new URL("../../node_modules/vinext/dist/shims/headers.js", import.meta.url)),
  } },
  plugins: [cloudflareTest({
    // This fixture has no local .dev.vars. The real key stays in the Node CLI.
    wrangler: { configPath: "tests/fixtures/story-live-room.wrangler.jsonc" },
    miniflare: { d1Databases: { DB: "story-live-room-local" },
      bindings: { DEEPSEEK_API_KEY: "local-loopback-transport-only", ZHUWEI_VNEXT_LOCAL_CALL_LIMIT: "10" } },
  })],
  test: { include: ["tests/story-live-room.test.mts"], fileParallelism: false, retry: 0, bail: 1,
    provide: { storyRoomProbe: { bridgeUrl, token, caseId, actionText, mode } }, testTimeout: 540_000 },
});
