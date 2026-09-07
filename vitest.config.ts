import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./app/_runtime", import.meta.url)) } },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
    }),
  ],
  test: {
    include: ["tests/*.test.ts"],
    fileParallelism: false,
  },
});
