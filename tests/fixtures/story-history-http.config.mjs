import { fileURLToPath } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// A separate local binding keeps HTTP/D1 archive side effects out of the
// shared Room unit-test environment. The header adapter is Vinext's real shim.
export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  resolve: { alias: {
    '@': fileURLToPath(new URL('../../app/_runtime', import.meta.url)),
    'next/headers': fileURLToPath(new URL('../../node_modules/vinext/dist/shims/headers.js', import.meta.url)),
  } },
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.test.jsonc' },
    miniflare: { d1Databases: { DB: 'story-history-http-local' },
      // This suite exercises history and deterministic actions. Do not inherit
      // a developer's Provider credential from the root .dev.vars file.
      bindings: { DEEPSEEK_API_KEY: '' } },
  })],
  test: { include: ['tests/story-history-http.test.mts'], fileParallelism: false },
});
