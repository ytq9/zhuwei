import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig(async ({ command }) => {
  if (command === "build" && process.env.ZHUWEI_VNEXT_LOCAL === "true") {
    throw new Error("The vNext local host is development-only; use the production release configuration for builds.");
  }
  const localVNext = command === "serve" && process.env.ZHUWEI_VNEXT_LOCAL === "true";
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        ...(localVNext ? {
          config: { vars: { ZHUWEI_VNEXT_LOCAL: "true",
            ...(process.env.ZHUWEI_VNEXT_LOCAL_CALL_LIMIT === undefined ? {} : {
              ZHUWEI_VNEXT_LOCAL_CALL_LIMIT: process.env.ZHUWEI_VNEXT_LOCAL_CALL_LIMIT,
            }),
            ...(process.env.ZHUWEI_VNEXT_LOCAL_CAPTURE_URL === undefined ? {} : {
              ZHUWEI_VNEXT_LOCAL_CAPTURE_URL: process.env.ZHUWEI_VNEXT_LOCAL_CAPTURE_URL,
            }),
          } },
          persistState: { path: ".wrangler/vnext/state" },
          remoteBindings: false,
          inspectorPort: false as const,
        } : {}),
      }),
    ],
  };
});
