import { ensureDb } from "../../../db";

/** D1 adapter for the parameterized SQL surface used by upstream zhuwei. */
export interface Sql {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
}

function valueForD1(value: unknown): string | number | null {
  if (value == null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number") return value;
  return JSON.stringify(value);
}

function postgresToD1(text: string) {
  return text
    .replace(/::(?:jsonb|int|integer|boolean|text)\b/gi, "")
    .replace(/\bnow\(\)/gi, "CURRENT_TIMESTAMP");
}

async function execute<T>(db: D1Database, text: string, values: unknown[]): Promise<T[]> {
  const result = await db
    .prepare(postgresToD1(text))
    .bind(...values.map(valueForD1))
    .all<T>();
  return result.results;
}

function makeSql(db: D1Database): Sql {
  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    let text = strings[0];
    for (let index = 0; index < values.length; index += 1) {
      text += `?${strings[index + 1]}`;
    }
    return execute<T>(db, text, values);
  }) as Sql;

  sql.query = <T = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ) => {
    const ordered: unknown[] = [];
    const translated = text.replace(/\$(\d+)/g, (_match, rawIndex: string) => {
      ordered.push(params[Number(rawIndex) - 1]);
      return "?";
    });
    return execute<T>(db, translated, ordered);
  };
  return sql;
}

export async function getSql(): Promise<Sql> {
  const db = await ensureDb();
  return makeSql(db);
}
