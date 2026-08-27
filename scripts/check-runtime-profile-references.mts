import { PRODUCTION_RUNTIME_PROFILE_REGISTRY } from "../app/_runtime/lib/rules/profiles/registry";
import {
  evaluateRuntimeProfileReferenceGate,
  runtimeProfileReferenceRowsFromD1,
} from "../app/_runtime/lib/rules/profiles/deployment-gate";

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

try {
  const input = await readStandardInput();
  if (input.trim().length === 0) throw new TypeError("Profile reference gate requires D1 JSON on stdin.");
  const rows = runtimeProfileReferenceRowsFromD1(JSON.parse(input));
  const result = evaluateRuntimeProfileReferenceGate(
    rows,
    PRODUCTION_RUNTIME_PROFILE_REGISTRY.registrations.map(({ manifest }) => manifest),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
} catch {
  process.stdout.write(`${JSON.stringify({ ok: false, code: "invalidGateInput" })}\n`);
  process.exitCode = 1;
}
