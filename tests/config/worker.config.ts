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
  },
});
