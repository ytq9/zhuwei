import { env } from "cloudflare:workers";

export function getD1(): D1Database {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) {
    throw new Error("D1 数据库尚未绑定。");
  }
  return binding;
}

export async function ensureDb(): Promise<D1Database> {
  // Schema changes are applied through versioned `drizzle/` D1 migrations.
  // Keeping initialization out of module-global state avoids cross-request I/O
  // caches and makes a missing migration fail honestly at the query boundary.
  return getD1();
}

export async function all<T>(
  sql: string,
  ...values: Array<string | number | null>
): Promise<T[]> {
  const db = await ensureDb();
  const result = await db.prepare(sql).bind(...values).all<T>();
  return result.results;
}

export async function first<T>(
  sql: string,
  ...values: Array<string | number | null>
): Promise<T | null> {
  const db = await ensureDb();
  return db.prepare(sql).bind(...values).first<T>();
}

export async function run(
  sql: string,
  ...values: Array<string | number | null>
): Promise<D1Result<unknown>> {
  const db = await ensureDb();
  return db.prepare(sql).bind(...values).run();
}
