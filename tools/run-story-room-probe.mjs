import { createHash, randomBytes } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDeepSeekAuthoritativeBinding, createDeepSeekStrictToolBinding,
  assertDeepSeekStrictToolModelInput, deepSeekRequestBody } from "../app/_runtime/lib/kp/deepseek.ts";
import { AUTHORITATIVE_KP_PROFILE, kpRequestDeclaresStrictTool } from "../app/_runtime/lib/kp/authoritative-policy.ts";
import { VNEXT_KP_PROFILE } from "../app/_runtime/lib/kp/vnext/runtime-policy.ts";
import { conservativeInputTokens } from "../app/_runtime/lib/kp/vnext/invocation/budget.ts";
import { ROOM_STORY_TRANSPORT } from "../app/_runtime/lib/room/story-runtime-policy.ts";
import { STORY_ROOM_PROBE_CASES, STORY_ROOM_PROBE_LIMITS } from "../tests/fixtures/story-live-room-cases.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FORMAT = "zhuwei.story-room-live-probe/v1";
const ARTIFACT_NAMES = new Set(["initial", "first-action", "first-table", "first-authority",
  "retry-action", "retry-table", "retry-authority", "acceptance", "failure"]);
const HARNESS_SOURCES = ["tools/run-story-room-probe.mjs", "tests/story-live-room.test.mts", "tests/story-room-probe.test.mjs",
  "tests/fixtures/story-history-http.ts", "tests/fixtures/story-live-room-cases.mjs",
  "tests/fixtures/story-live-room.config.mjs", "tests/fixtures/story-live-room.wrangler.jsonc", "tests/room-worker.ts"];
const SOURCE_ROOTS = ["app", "db", "drizzle", "worker", "cloudflare", "package.json", "package-lock.json", "tsconfig.json",
  "wrangler.jsonc", "wrangler.test.jsonc", "worker-configuration.d.ts", ...HARNESS_SOURCES];
const positive = value => Number.isSafeInteger(value) && value > 0;
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
class ProbeFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
const problem = code => new ProbeFailure(code);

export function parseStoryProbeOptions(args) {
  const options = { live: false, preflight: false, caseId: "short-local-conflict", ...STORY_ROOM_PROBE_LIMITS };
  const names = { "--case": "caseId", "--action": "actionText", "--max-calls": "maxCalls", "--max-input-tokens": "maxInputTokens",
    "--max-output-tokens": "maxOutputTokens", "--call-timeout-ms": "callTimeoutMs" };
  let explicitMode;
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (seen.has(arg)) throw problem("PROBE_OPTION_DUPLICATE");
    seen.add(arg);
    if (arg === "--live" || arg === "--dry-run" || arg === "--preflight") {
      if (explicitMode !== undefined) throw problem("PROBE_MODE_CONFLICT");
      explicitMode = arg; options.live = arg === "--live"; options.preflight = arg === "--preflight";
    } else if (Object.hasOwn(names, arg) && args[index + 1] !== undefined) {
      const value = args[++index];
      options[names[arg]] = arg === "--case" || arg === "--action" ? value : /^\d+$/u.test(value) ? Number(value) : NaN;
    } else throw problem("PROBE_OPTION_INVALID");
  }
  for (const [name, ceiling] of Object.entries(STORY_ROOM_PROBE_LIMITS)) {
    if (!positive(options[name]) || options[name] > ceiling) throw problem("PROBE_BUDGET_INVALID");
  }
  const selected = STORY_ROOM_PROBE_CASES.find(item => item.caseId === options.caseId);
  if (!selected) throw problem("PROBE_CASE_UNKNOWN");
  if ((options.live || options.preflight) && !selected.implemented) throw problem("PROBE_CASE_NOT_IMPLEMENTED");
  if (options.actionText !== undefined && (options.actionText.trim().length === 0 || options.actionText.length > 1200)) throw problem("PROBE_ACTION_INVALID");
  return { ...options, selected: { ...selected, ...(options.actionText === undefined ? {} : { text: options.actionText }) } };
}

export function storyProbeDryRun(options = parseStoryProbeOptions([])) {
  return { format: FORMAT, status: "dry-run-valid", mode: "dry-run", caseId: options.caseId,
    runnable: options.selected.implemented, cases: STORY_ROOM_PROBE_CASES.map(({ caseId, implemented }) => ({ caseId, implemented })),
    limits: Object.fromEntries(Object.keys(STORY_ROOM_PROBE_LIMITS).map(key => [key, options[key]])),
    module: { id: "black-oak-will", version: "social-resolution-v1" },
    models: [...new Set([VNEXT_KP_PROFILE.modelId, AUTHORITATIVE_KP_PROFILE.modelId])],
    costRatePolicy: { source: "ROOM_STORY_TRANSPORT", inputMicrosPerMillion: ROOM_STORY_TRANSPORT.estimatedInputMicrosPerMillion,
      outputMicrosPerMillion: ROOM_STORY_TRANSPORT.estimatedOutputMicrosPerMillion,
      currency: "unspecified-by-runtime-policy", billingEvidence: false },
    path: ["authenticated POST /api/game sendAction", "handleRoomAction", "Room/StoryStore",
      "real draft and review", "Rules admission", "createJournaledNarrationAdapter", "same submission retry"],
    realProviderCalls: 0, workerRuns: 0,
    implementationNote: "Dry-run validates configuration only; it does not establish Worker, Provider or narrative acceptance.",
    preflightCommand: "node --import tsx tools/run-story-room-probe.mjs --preflight",
    liveCommand: "node --env-file=/absolute/path/to/existing.env --import tsx tools/run-story-room-probe.mjs --live --case short-local-conflict" };
}

/** Freeze both tracked runtime sources and this harness, including files that
 * have not yet been committed. No credential file or source content is saved. */
export async function freezeStoryProbeSources(root = ROOT) {
  const tracked = execFileSync("git", ["ls-files", "-z", "--", ...SOURCE_ROOTS],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean);
  const paths = [...new Set([...tracked, ...HARNESS_SOURCES])].sort();
  const files = [];
  for (let index = 0; index < paths.length; index += 64) {
    files.push(...await Promise.all(paths.slice(index, index + 64).map(async path => {
      const bytes = await readFile(join(root, path));
      return { path, sha: hash(bytes), bytes: bytes.length };
    })));
  }
  return { format: "zhuwei.story-probe-source-manifest/v1", files, manifestSha: hash(JSON.stringify(files)) };
}
export function compareStoryProbeSources(before, after) {
  const first = new Map(before.files.map(file => [file.path, file.sha]));
  const last = new Map(after.files.map(file => [file.path, file.sha]));
  return { unchanged: before.manifestSha === after.manifestSha,
    added: [...last.keys()].filter(path => !first.has(path)), removed: [...first.keys()].filter(path => !last.has(path)),
    changed: [...first.keys()].filter(path => last.has(path) && first.get(path) !== last.get(path)),
    initialSha: before.manifestSha, finalSha: after.manifestSha };
}

/** Match production's request-owned choice. There is no downgrade on error. */
export function validateStoryProbeRequest(value) {
  if (!record(value) || !record(value.input) || typeof value.model !== "string"
    || ![VNEXT_KP_PROFILE.modelId, AUTHORITATIVE_KP_PROFILE.modelId].includes(value.model)) throw problem("PROBE_REQUEST_INVALID");
  const expected = kpRequestDeclaresStrictTool(value.input) ? "strict" : "ordinary-json";
  if (value.transportKind !== expected) throw problem("PROBE_TRANSPORT_MISMATCH");
  if (expected === "strict") assertDeepSeekStrictToolModelInput(value.input);
  else if (value.input.tools !== undefined || !record(value.input.response_format)
    || value.input.response_format.type !== "json_object") throw problem("PROBE_ORDINARY_SURFACE_INVALID");
  const body = deepSeekRequestBody(value.model, value.input);
  if (!positive(body.max_tokens)) throw problem("PROBE_OUTPUT_RESERVATION_INVALID");
  return { ...value, body, serializedBody: JSON.stringify(body) };
}

/** Estimates gate input; actual provider usage remains separately labelled.
 * Missing/uncertain telemetry keeps its reservation and stops further calls. */
export function createStoryProbeBudget(limits = STORY_ROOM_PROBE_LIMITS) {
  for (const [key, ceiling] of Object.entries(STORY_ROOM_PROBE_LIMITS)) {
    if (!positive(limits[key]) || limits[key] > ceiling) throw problem("PROBE_BUDGET_INVALID");
  }
  const calls = [];
  let stopCode = null, retryPhase = false;
  const totals = () => calls.reduce((sum, call) => ({
    realProviderCalls: sum.realProviderCalls + (call.dispatched ? 1 : 0),
    measuredInputTokens: sum.measuredInputTokens + (call.usage?.inputTokens ?? 0),
    measuredOutputTokens: sum.measuredOutputTokens + (call.usage?.outputTokens ?? 0),
    heldInputTokens: sum.heldInputTokens + (call.usage?.inputTokens === undefined ? call.estimatedInputTokens : 0),
    heldOutputTokens: sum.heldOutputTokens + (call.usage?.outputTokens === undefined ? call.reservedOutputTokens : 0),
    incompleteUsageCalls: sum.incompleteUsageCalls + (call.dispatched && (!call.usage || Object.keys(call.usage).length !== 2) ? 1 : 0),
  }), { realProviderCalls: 0, measuredInputTokens: 0, measuredOutputTokens: 0,
    heldInputTokens: 0, heldOutputTokens: 0, incompleteUsageCalls: 0 });
  const stop = code => { stopCode ??= code; };
  return {
    stop,
    reserve(serializedBody, outputTokens, transportKind) {
      if (retryPhase) { stop("PROBE_RETRY_ATTEMPTED_PROVIDER_CALL"); throw problem(stopCode); }
      if (stopCode) throw problem(stopCode);
      const current = totals(), estimatedInputTokens = conservativeInputTokens(serializedBody);
      if (!positive(outputTokens) || calls.length >= limits.maxCalls
        || current.measuredInputTokens + current.heldInputTokens + estimatedInputTokens > limits.maxInputTokens
        || current.measuredOutputTokens + current.heldOutputTokens + outputTokens > limits.maxOutputTokens) {
        stop("PROBE_BUDGET_EXHAUSTED"); throw problem(stopCode);
      }
      const call = { ordinal: calls.length + 1, transportKind, requestSha: hash(serializedBody),
        estimatedInputTokens, reservedOutputTokens: outputTokens, dispatched: false, status: "reserved" };
      calls.push(call); return call;
    },
    dispatched(call) {
      if (!calls.includes(call) || call.dispatched || stopCode) throw problem(stopCode ?? "PROBE_DISPATCH_INVALID");
      call.dispatched = true; call.status = "started";
    },
    settle(call, response) {
      const usage = record(response) && record(response.usage) ? response.usage : {};
      const valid = value => Number.isSafeInteger(value) && value >= 0;
      call.usage = { ...(valid(usage.prompt_tokens) ? { inputTokens: usage.prompt_tokens } : {}),
        ...(valid(usage.completion_tokens) ? { outputTokens: usage.completion_tokens } : {}) };
      call.status = "completed";
      if (Object.keys(call.usage).length !== 2) stop("PROBE_PROVIDER_USAGE_UNKNOWN");
      else if (call.usage.inputTokens > call.estimatedInputTokens || call.usage.outputTokens > call.reservedOutputTokens) {
        stop("PROBE_PROVIDER_RESERVATION_EXCEEDED");
      }
      if (stopCode) throw problem(stopCode);
    },
    failed(call, code) { call.status = "unknown"; call.failureCode = code; stop(code); },
    sealRetry() { if (stopCode) throw problem(stopCode); retryPhase = true; return totals(); },
    snapshot: () => ({ limits, ...totals(), usageComplete: calls.every(call => call.dispatched && Object.keys(call.usage ?? {}).length === 2),
      stopCode, retryPhase, calls: structuredClone(calls) }),
  };
}

export async function createStoryProbeEvidenceDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "zhuwei-story-room-probe-"));
  await chmod(directory, 0o700); return directory;
}
async function save(directory, name, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  const path = join(directory, name);
  await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
  return { file: name, sha: hash(bytes), bytes: bytes.length };
}
function safeFailure(error) {
  return error instanceof ProbeFailure ? error.code
    : error?.name === "AbortError" || error?.name === "TimeoutError" ? "PROBE_PROVIDER_TIMEOUT"
      : error?.code === "strict_tool_configuration_invalid" ? "PROBE_STRICT_CONFIGURATION_INVALID"
        : Number.isSafeInteger(error?.status) ? `PROBE_PROVIDER_HTTP_${error.status}` : "PROBE_TRANSPORT_FAILED";
}
async function requestJson(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw problem("PROBE_BRIDGE_BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function startBridge({ apiKey, directory, limits, preflight }) {
  const token = randomBytes(32).toString("hex"), budget = createStoryProbeBudget(limits), artifacts = [];
  let acceptance = null;
  const server = createServer(async (request, response) => {
    let activeCall, providerFailure;
    const send = (status, body) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body)); };
    if (request.headers.authorization !== `Bearer ${token}`) { send(401, { code: "PROBE_BRIDGE_UNAUTHORIZED" }); return; }
    try {
      if (request.method === "GET" && request.url === "/status") { send(200, budget.snapshot()); return; }
      if (request.method !== "POST") throw problem("PROBE_BRIDGE_ROUTE_INVALID");
      if (request.url === "/seal-retry") { send(200, budget.sealRetry()); return; }
      const input = await requestJson(request);
      if (request.url === "/evidence") {
        if (!record(input) || !ARTIFACT_NAMES.has(input.name)) throw problem("PROBE_ARTIFACT_NAME_INVALID");
        artifacts.push(await save(directory, `${input.name}.json`, input.value));
        if (input.name === "acceptance") acceptance = input.value;
        send(200, { saved: true }); return;
      }
      if (request.url === "/stop") { budget.stop("PROBE_HTTP_ACCEPTANCE_FAILED"); send(200, { stopped: true }); return; }
      if (request.url !== "/invoke") throw problem("PROBE_BRIDGE_ROUTE_INVALID");
      if (preflight) throw problem("PROBE_PREFLIGHT_PROVIDER_FORBIDDEN");
      const requestBody = validateStoryProbeRequest(input);
      const call = budget.reserve(requestBody.serializedBody, requestBody.body.max_tokens, requestBody.transportKind);
      activeCall = call;
      const prefix = String(call.ordinal).padStart(2, "0");
      call.inputArtifact = await save(directory, `${prefix}.model-input.json`, input);
      call.requestArtifact = await save(directory, `${prefix}.provider-request.json`, requestBody.serializedBody);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), limits.callTimeoutMs);
      const startedAt = performance.now();
      let responseBytes, result;
      const disconnect = () => { if (!response.writableEnded) controller.abort(); };
      response.on("close", disconnect);
      try {
        const bindingOptions = { apiKey, fetcher: async (url, init) => {
          const expected = requestBody.transportKind === "strict"
            ? "https://api.deepseek.com/beta/chat/completions" : "https://api.deepseek.com/chat/completions";
          if (url !== expected || init?.method !== "POST" || init.body !== requestBody.serializedBody) throw problem("PROBE_ACTUAL_TRANSPORT_MISMATCH");
          budget.dispatched(call); call.endpoint = expected; call.startedAt = new Date().toISOString();
          const received = await fetch(url, init);
          call.providerStatus = received.status;
          responseBytes = Buffer.from(await received.arrayBuffer());
          call.responseArtifact = await save(directory, `${prefix}.response.raw.json`, responseBytes);
          call.responseSha = call.responseArtifact.sha;
          // Preserve raw provider JSON. Only transport headers needed by the
          // production adapter are carried back; Authorization is never saved.
          return new Response(responseBytes, { status: received.status, headers: {
            "content-type": received.headers.get("content-type") ?? "application/json",
            ...(received.headers.has("retry-after") ? { "retry-after": received.headers.get("retry-after") } : {}),
          } });
        } };
        const binding = requestBody.transportKind === "strict" ? createDeepSeekStrictToolBinding(bindingOptions)
          : createDeepSeekAuthoritativeBinding(bindingOptions);
        result = await binding.run(requestBody.model, requestBody.input, { signal: controller.signal });
        budget.settle(call, result);
      } catch (error) {
        const code = controller.signal.aborted ? "PROBE_PROVIDER_TIMEOUT" : safeFailure(error);
        providerFailure = { name: controller.signal.aborted ? "AbortError" : "Error",
          ...(Number.isSafeInteger(error?.status) ? { status: error.status } : {}),
          ...(["quota_exhausted", "rate_limit", "provider_unavailable", "request_rejected"].includes(error?.code) ? { code: error.code } : {}),
          ...(Number.isFinite(error?.retryAfter) ? { retryAfter: error.retryAfter } : {}) };
        budget.failed(call, code);
        // Known HTTP error bodies can still contain measured usage. The raw
        // bytes remain evidence even when the authoritative adapter rejects.
        if (responseBytes && !call.usage) {
          try { budget.settle(call, JSON.parse(responseBytes.toString("utf8"))); } catch { /* gate remains closed */ }
          call.status = "unknown";
        }
        throw problem(code);
      } finally {
        clearTimeout(timeout); response.off("close", disconnect);
        call.elapsedMs = Math.ceil(performance.now() - startedAt);
        await save(directory, `${prefix}.invocation.json`, call);
      }
      send(200, { response: result });
    } catch (error) {
      const code = safeFailure(error); budget.stop(code);
      if (!response.writableEnded) send(503, { ...providerFailure,
        code: activeCall?.dispatched ? providerFailure?.code ?? "probe_transport_failed" : "localProbeBudgetExhausted",
        probeCode: code });
    }
  });
  server.requestTimeout = 60_000;
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}`, token, budget,
    report: () => ({ ...budget.snapshot(), artifacts, acceptance }),
    close: async () => { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); } };
}

async function runWorker(bridge, options, directory) {
  const stdout = await open(join(directory, "worker.stdout.log"), "wx", 0o600);
  const stderr = await open(join(directory, "worker.stderr.log"), "wx", 0o600);
  // Node's --env-file has already loaded the key into this parent only.
  // Never inherit it, NODE_OPTIONS or unrelated credentials into workerd.
  const childEnv = Object.fromEntries(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SYSTEMROOT", "WINDIR"]
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  try {
    const child = spawn(process.execPath, [join(ROOT, "node_modules/vitest/vitest.mjs"), "run", "--config",
      "tests/fixtures/story-live-room.config.mjs", "tests/story-live-room.test.mts", "--bail", "1"], {
      cwd: ROOT, env: { ...childEnv, CI: "1", NO_COLOR: "1", ZHUWEI_STORY_PROBE_ENABLED: "1",
        ZHUWEI_STORY_PROBE_MODE: options.preflight ? "preflight" : "live",
        ZHUWEI_STORY_PROBE_BRIDGE_URL: bridge.url, ZHUWEI_STORY_PROBE_BRIDGE_TOKEN: bridge.token,
        ZHUWEI_STORY_PROBE_CASE: options.caseId, ZHUWEI_STORY_PROBE_ACTION: options.selected.text }, stdio: ["ignore", stdout.fd, stderr.fd],
    });
    const timeout = setTimeout(() => { bridge.budget.stop("PROBE_WORKER_TIMEOUT"); child.kill("SIGTERM"); },
      options.maxCalls * options.callTimeoutMs + 90_000);
    const terminate = () => { bridge.budget.stop("PROBE_INTERRUPTED"); child.kill("SIGTERM"); };
    process.once("SIGINT", terminate); process.once("SIGTERM", terminate);
    try {
      return await new Promise((resolveExit, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolveExit({ exitCode: code, signal })); });
    } finally { clearTimeout(timeout); process.off("SIGINT", terminate); process.off("SIGTERM", terminate); }
  } finally { await stdout.close(); await stderr.close(); }
}

async function main() {
  const options = parseStoryProbeOptions(process.argv.slice(2));
  if (!options.live && !options.preflight) { process.stdout.write(`${JSON.stringify(storyProbeDryRun(options), null, 2)}\n`); return; }
  const apiKey = options.live ? process.env.DEEPSEEK_API_KEY?.trim() : "";
  if (options.live && !apiKey) throw problem("PROBE_API_KEY_MISSING");
  const directory = await createStoryProbeEvidenceDirectory();
  const git = args => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const limits = Object.fromEntries(Object.keys(STORY_ROOM_PROBE_LIMITS).map(key => [key, options[key]]));
  const sources = await freezeStoryProbeSources();
  await save(directory, "source-initial.json", sources);
  const mode = options.preflight ? "preflight" : "live-provider";
  await save(directory, "run.json", { ...storyProbeDryRun(options), status: "pending", mode,
    source: { head: git(["rev-parse", "HEAD"]), status: git(["status", "--porcelain=v1"]), manifestSha: sources.manifestSha },
    startedAt: new Date().toISOString(), case: options.selected,
    rule: "One action, one exact retry; preserve production bounded correction/revision; stop at the first final failure." });
  process.stdout.write(`${JSON.stringify({ format: FORMAT, status: "running", mode, caseId: options.caseId, evidenceDirectory: directory })}\n`);
  const bridge = await startBridge({ apiKey, directory, limits, preflight: options.preflight });
  let worker = { exitCode: null, signal: null }, sourceConsistency;
  try { worker = await runWorker(bridge, options, directory); }
  catch (error) { bridge.budget.stop(safeFailure(error)); }
  finally { await bridge.close(); }
  try {
    const finalSources = await freezeStoryProbeSources();
    await save(directory, "source-final.json", finalSources);
    sourceConsistency = compareStoryProbeSources(sources, finalSources);
    if (!sourceConsistency.unchanged) bridge.budget.stop("PROBE_SOURCE_DRIFT");
  } catch { bridge.budget.stop("PROBE_SOURCE_AUDIT_FAILED"); sourceConsistency = { unchanged: false }; }
  const report = bridge.report();
  const verified = worker.exitCode === 0 && ["passed", "needs-review"].includes(report.acceptance?.status) && report.stopCode === null
    && (options.preflight ? report.realProviderCalls === 0 : report.realProviderCalls > 0 && report.usageComplete);
  const estimateMicros = (input, output) => Math.ceil((input * ROOM_STORY_TRANSPORT.estimatedInputMicrosPerMillion
    + output * ROOM_STORY_TRANSPORT.estimatedOutputMicrosPerMillion) / 1_000_000);
  const result = { format: FORMAT, status: verified ? options.preflight ? "preflight-passed" : report.acceptance.status : "failed", mode,
    caseId: options.caseId, evidenceDirectory: directory, worker, sourceConsistency, ...report,
    costEstimate: { measuredUsageEstimateMicros: estimateMicros(report.measuredInputTokens, report.measuredOutputTokens),
      unknownUsageReservationEstimateMicros: estimateMicros(report.heldInputTokens, report.heldOutputTokens),
      ...storyProbeDryRun(options).costRatePolicy } };
  await save(directory, "report.json", result);
  process.stdout.write(`${JSON.stringify({ format: FORMAT, status: result.status, caseId: options.caseId,
    realProviderCalls: report.realProviderCalls, measuredInputTokens: report.measuredInputTokens,
    measuredOutputTokens: report.measuredOutputTokens, usageComplete: report.usageComplete,
    failureCode: report.stopCode ?? (verified ? null : "PROBE_HTTP_ACCEPTANCE_FAILED"), evidenceDirectory: directory }, null, 2)}\n`);
  if (!verified) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stdout.write(`${JSON.stringify({ format: FORMAT, status: "blocked", failureCode: safeFailure(error) })}\n`);
    process.exitCode = 2;
  });
}
