// SPEC 0011 §§1、5: a random request reference carries no player/world content
// and grants no authority. Every HTTP attempt gets its own reference; retries
// continue to use the original submission identity independently.
export const DIAGNOSTIC_HEADER = "x-zhuwei-diagnostic";
const REFERENCE = /\bZW-([0-9a-z]{8,10})-([0-9a-f]{32})\b/;

export function createDiagnosticReference(now = Date.now()): string {
  return `ZW-${now.toString(36)}-${crypto.randomUUID().replaceAll("-", "")}`;
}

export function diagnosticReference(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = REFERENCE.exec(value);
  return match?.[0] === value ? value : undefined;
}

export function diagnosticReferenceTime(value: string): number {
  if (!diagnosticReference(value)) throw new Error("故障编号格式无效。");
  return Number.parseInt(value.split("-")[1]!, 36);
}

export function diagnosticReferenceFromMessage(message: string): string | undefined {
  return REFERENCE.exec(message)?.[0];
}

export function diagnosticMessage(message: string, reference: string): string {
  return `${message}\n故障编号：${reference}`;
}

export function diagnosticCopyText(message: string): string | undefined {
  const reference = diagnosticReferenceFromMessage(message);
  if (!reference) return undefined;
  // Copy only the reference and time, never draft text, room IDs or response bodies.
  return `烛帷故障\n故障编号：${reference}\n请求时间：${new Date(diagnosticReferenceTime(reference)).toISOString()}`;
}
