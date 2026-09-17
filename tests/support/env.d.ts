declare module "cloudflare:workers" {
  // Cloudflare Vitest 通过空接口合并把生产 Env 提供给测试 Worker。
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}
