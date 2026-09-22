import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    ".next/**",
    ".vinext/**",
    ".vercel/**",
    // Local runtime state and the per-machine agent worktrees, both gitignored.
    // Without these, `eslint .` reports tens of thousands of problems from
    // Miniflare's stored state and from whole copies of this repo, which buries
    // the few hundred that are actually source.
    ".wrangler/**",
    ".claude/**",
    "dist/**",
    "drizzle/**",
    "app/_runtime/**",
    "next-env.d.ts",
    "worker-configuration.d.ts",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  next.configs["core-web-vitals"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: { version: "detect" },
    },
  },
]);
