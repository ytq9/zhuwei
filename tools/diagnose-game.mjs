import { execFileSync, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { diagnosticReference } from "../app/_runtime/lib/platform/diagnostic-reference.ts";
import { diagnosticReport, diagnosticTimeframe, parseDocuments, referenceHash, relatedTimeline, telemetryIn } from "./diagnostics/telemetry.mjs";

const WORKER = "zhuwei";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const WRANGLER = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
const SERVICE_FILTER = { key: "$metadata.service", operation: "eq", type: "string", value: WORKER };
const HELP = `烛帷故障排查（只读，不触发游戏或模型调用）
  npm run diagnose -- --reference ZW-...               查询该请求前后 10 分钟历史日志
  npm run diagnose -- --at 2026-09-16T12:01:03+08:00    按旧截图时间查询
  npm run diagnose -- --tail --seconds 60 --out /tmp/zhuwei-diagnostic.json
  npm run diagnose -- --file /tmp/zhuwei-diagnostic.json --reference ZW-...
选项：--minutes 1–60（前后窗口），--out 文件，--account 账号 ID。
历史查询需要 Workers Observability Write 权限；自动读取本机 .wrangler/diagnostics.env，
显式环境变量优先，未配置时复用 Wrangler 登录。凭证不会进入命令参数或输出。
默认最多两组查询、每组 3 页，每页 200 条；达到上限明确标记 partial。
实时采集默认 60 秒、最多 300 秒；只保存白名单日志，不保存原始响应。`;

async function loadHistoryEnvironment() {
  let local;
  try { local = parseEnv(await readFile(new URL("../.wrangler/diagnostics.env", import.meta.url), "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return;
    throw new Error("无法读取本机 .wrangler/diagnostics.env，请检查文件权限和格式。");
  }
  // The history token deliberately has no tail/deploy permissions. Load only
  // these settings, and only for history queries, leaving other commands alone.
  for (const key of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "HTTPS_PROXY"]) {
    if (process.env[key] === undefined && local[key] !== undefined) process.env[key] = local[key];
  }
}

function wranglerJson(args) {
  try {
    return JSON.parse(execFileSync(WRANGLER, [...args, "--json"], {
      cwd: ROOT, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    }));
  } catch { throw new Error("无法读取 Wrangler 登录状态；请先运行 npx wrangler whoami 检查登录。"); }
}

function credentials(account) {
  let accountId = account ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    const user = wranglerJson(["whoami"]);
    accountId = user.accounts?.length === 1 ? user.accounts[0].id : undefined;
  }
  if (!accountId || !/^[a-f0-9]{32}$/.test(accountId)) throw new Error("无法唯一确定 Cloudflare 账号；请用 --account 指定。");
  const auth = wranglerJson(["auth", "token"]);
  if (!["oauth", "api_token"].includes(auth.type) || typeof auth.token !== "string") {
    throw new Error("请使用 Wrangler OAuth 登录或 CLOUDFLARE_API_TOKEN。");
  }
  return { accountId, token: auth.token };
}

// curl receives the token through stdin, never argv, disk, stdout or stderr.
// It also respects the existing HTTPS_PROXY configuration on this machine.
function queryApi(auth, body) {
  const config = [
    `url = ${JSON.stringify(`https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/workers/observability/telemetry/query`)}`,
    'request = "POST"', `header = ${JSON.stringify(`Authorization: Bearer ${auth.token}`)}`,
    'header = "Content-Type: application/json"', `data = ${JSON.stringify(JSON.stringify(body))}`,
    'write-out = "\\n%{http_code}"',
  ].join("\n");
  let response;
  try {
    response = execFileSync("curl", ["--silent", "--show-error", "--max-time", "25", "--config", "-"], {
      input: config, encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
    });
  } catch { throw new Error("历史日志查询连接失败或超时；请检查网络及 HTTPS_PROXY。"); }
  const split = response.lastIndexOf("\n"), status = Number(response.slice(split + 1));
  if (status === 401 || status === 403) throw new Error("历史日志查询被拒绝（HTTP " + status
    + "）。当前凭证缺少 Workers Observability Write 权限或已失效；这不代表没有故障日志。可使用具有该权限的 CLOUDFLARE_API_TOKEN，或先用 --tail 采集。详情见 docs/agent/diagnostics.md。");
  if (status < 200 || status >= 300) throw new Error(`历史日志查询失败（HTTP ${status}）；未将失败当作空结果。`);
  let parsed;
  try { parsed = JSON.parse(response.slice(0, split)); } catch { throw new Error("历史日志接口返回了无法解析的响应。"); }
  if (parsed.success !== true || parsed.result?.run?.status !== "COMPLETED"
    || !Array.isArray(parsed.result?.events?.events)) throw new Error("历史日志查询未完成或响应结构无效；不能判定没有记录。");
  return parsed.result.events;
}

export async function queryHistory({ timeframe, reference, query }) {
  async function pages(parameters) {
    const rows = []; let offset;
    for (let page = 0; page < 3; page++) {
      const data = await query({ queryId: "zhuwei-diagnostic-query", view: "events", dry: true, limit: 200,
        timeframe, parameters, ...(offset ? { offset, offsetDirection: "next" } : {}) });
      rows.push(...data.events);
      if (data.events.length < 200) return { rows, truncated: false };
      const next = data.events.at(-1)?.$metadata?.id;
      if (typeof next !== "string" || next === offset) return { rows, truncated: true };
      offset = next;
    }
    return { rows, truncated: true };
  }
  const initial = await pages({ filters: [SERVICE_FILTER], ...(reference ? { needle: { value: referenceHash(reference), matchCase: true } } : {}) });
  if (!reference || !initial.rows.length) return { ...initial, timeline: relatedTimeline(initial.rows) };
  // SPEC 0011 §5: structured console JSON is indexed under its own field
  // names. Its requestId overrides metadata.requestId, and metadata.message
  // need not exist. The platform request identity remains in $workers.
  const requestIds = [...new Set(initial.rows.map(row => row.$workers?.requestId ?? row.$metadata?.requestId)
    .filter(id => typeof id === "string" && /^[\w-]{1,120}$/.test(id)))];
  const correlations = initial.rows.flatMap(row => telemetryIn(row)).flatMap(row =>
    ["submissionHash", "rootActionHash", "receiptHash"].filter(key => row[key])
      .map(key => ({ key, operation: "eq", type: "string", value: row[key] })));
  const hashes = [...new Set(correlations.map(filter => filter.value))];
  // Retain message matching for older string logs. Every selector comes from
  // the first lookup; Worker/time bounds still apply, never room or principal.
  const filters = [...new Map([
    ...requestIds.map(value => ({ key: "$workers.requestId", operation: "eq", type: "string", value })),
    ...correlations,
    ...hashes.map(value => ({ key: "$metadata.message", operation: "includes", type: "string", value })),
  ].map(filter => [JSON.stringify(filter), filter])).values()];
  if (!filters.length) return { ...initial, timeline: relatedTimeline(initial.rows) };
  const related = await pages({ filters: [SERVICE_FILTER, { kind: "group", filterCombination: "or", filters: filters.slice(0, 20) }], filterCombination: "and" });
  return { timeline: relatedTimeline([...initial.rows, ...related.rows]), truncated: initial.truncated || related.truncated || filters.length > 20 };
}

export async function captureTail(seconds) {
  // Wrangler's JSON mode suppresses connection readiness. Pretty mode gives
  // that signal and still emits our structured console messages as JSON.
  const proc = spawn(WRANGLER, ["tail", WORKER, "--format", "pretty"], {
    cwd: ROOT, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  const documents = []; let buffer = "", truncated = false, stopped = false, connected = false, forceKill;
  proc.stdout.setEncoding("utf8"); proc.stderr.setEncoding("utf8");
  proc.stdout.on("data", chunk => {
    if (/Connected to .*waiting for logs/i.test(chunk)) connected = true;
    buffer += chunk;
    if (buffer.length > 2 * 1024 * 1024) { truncated = true; buffer = ""; }
    const decoded = parseDocuments(buffer); buffer = decoded.remainder;
    for (const value of decoded.values) {
      const logs = telemetryIn(value);
      if (value && typeof value === "object" && Array.isArray(value.logs)) connected = true;
      if (logs.length) documents.push({ logs: logs.map(row => ({ ...row, schemaVersion: "zhuwei.room-telemetry/v1" })) });
    }
    if (documents.length > 2000) { truncated = true; stop(); }
  });
  proc.stderr.on("data", chunk => { if (/Connected to .*waiting for logs/i.test(chunk)) connected = true; });
  function stop() {
    if (stopped) return;
    stopped = true; proc.kill("SIGTERM");
    forceKill = setTimeout(() => proc.kill("SIGKILL"), 5000);
    forceKill.unref();
  }
  const timer = setTimeout(stop, seconds * 1000);
  process.once("SIGINT", stop);
  try {
    await new Promise((resolve, reject) => {
      proc.once("error", () => reject(new Error("无法启动 Wrangler 实时日志采集。")));
      proc.once("close", code => code && !stopped
        ? reject(new Error("实时日志连接失败；请运行 npx wrangler whoami 检查登录及 workers_tail 权限。")) : resolve());
    });
  } finally { clearTimeout(timer); clearTimeout(forceKill); process.removeListener("SIGINT", stop); }
  // Stderr may contain account information. Never include it in the report.
  if (!connected) throw new Error("未确认实时日志连接成功；请检查网络、登录及 workers_tail 权限。这不是没有日志的证据。");
  return { documents, truncated };
}

export async function main(args = process.argv.slice(2)) {
  const { values: options } = parseArgs({ args, options: {
    reference: { type: "string" }, at: { type: "string" }, file: { type: "string" }, tail: { type: "boolean" },
    seconds: { type: "string" }, minutes: { type: "string" }, out: { type: "string" }, account: { type: "string" }, help: { type: "boolean" },
  } });
  if (options.help) { process.stdout.write(HELP + "\n"); return; }
  if (options.reference && !diagnosticReference(options.reference)) throw new Error("故障编号格式无效。");
  if (options.file && options.tail) throw new Error("--file 与 --tail 不能同时使用。");
  if (options.at && !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(options.at)) throw new Error("--at 必须包含日期、时间和时区，例如 2026-09-16T12:01:03+08:00。");
  const timeframe = options.reference || options.at ? diagnosticTimeframe({ reference: options.reference, at: options.at, minutes: Number(options.minutes ?? 10) }) : undefined;
  let timeline, truncated = false, source;
  if (options.file) {
    const text = await readFile(options.file, "utf8");
    if (text.length > 16 * 1024 * 1024) throw new Error("日志文件超过 16 MB，请缩小范围。");
    const parsed = parseDocuments(text);
    if (!parsed.values.length || parsed.remainder) throw new Error("日志文件不是完整 JSON/JSONL，未将读取失败当作空结果。");
    timeline = relatedTimeline(parsed.values, options.reference); source = "file";
    truncated = parsed.values.some(value => value.status === "partial");
  } else if (options.tail) {
    const seconds = Number(options.seconds ?? 60);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw new Error("--seconds 必须为 1–300。");
    process.stderr.write(`开始读取 ${WORKER} 实时日志，最多 ${seconds} 秒；不会触发游戏操作。\n`);
    const captured = await captureTail(seconds);
    timeline = relatedTimeline(captured.documents, options.reference); truncated = captured.truncated; source = "tail";
  } else {
    if (!timeframe) throw new Error("请提供 --reference 或 --at；用 --help 查看用法。");
    await loadHistoryEnvironment();
    const auth = credentials(options.account);
    ({ timeline, truncated } = await queryHistory({ timeframe, reference: options.reference, query: body => queryApi(auth, body) }));
    source = "history";
  }
  if (timeframe) timeline = timeline.filter(row => {
    const at = Date.parse(row.occurredAt); return Number.isFinite(at) && at >= timeframe.from && at <= timeframe.to;
  });
  const report = diagnosticReport(timeline, { reference: options.reference, timeframe, source, truncated });
  const json = JSON.stringify(report, null, 2) + "\n";
  if (options.out) await writeFile(options.out, json, { mode: 0o600 });
  process.stdout.write(json);
  if (truncated) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
