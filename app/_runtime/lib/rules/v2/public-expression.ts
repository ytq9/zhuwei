/** Public performance cues only: no goals, knowledge, secrets or decisions. */
export type PublicExpression = { voice: string; attitude: string | null };
export function publicExpressionConform(value: unknown): value is PublicExpression {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const text = (v: unknown) => typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= 1200;
  return Object.keys(row).length === 2 && text(row.voice) && (row.attitude === null || text(row.attitude));
}
