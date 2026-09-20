import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  resolve: { alias: { "@": fileURLToPath(new URL("../../app/_runtime", import.meta.url)) } },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: fileURLToPath(new URL("./worker.wrangler.jsonc", import.meta.url)) },
    }),
  ],
  test: {
    include: ["tests/**/*.room.test.ts"],
    fileParallelism: false,
    // These drive a real Durable Object: storage, alarms, eviction and replay.
    // vitest's 5s default was never chosen for that, and the tests without an
    // explicit timeout already take 2-4s here, so they had between 1.25x and
    // 2.3x of headroom. Nothing noticed until the gate workflow ran for the
    // first time on 2026-09-20 and 12 of them crossed the line on a 2-core
    // runner. 60s matches the most generous per-test value already in the
    // suite; it is a harness limit, not a behaviour assertion, and a genuine
    // hang still ends in a minute because files run one at a time.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
