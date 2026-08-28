import { assertAllModules } from "../app/_runtime/lib/module/index.ts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function source(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function sourceFiles(path) {
  const absolute = join(repoRoot, path);
  return readdirSync(absolute).flatMap((entry) => {
    const child = join(absolute, entry);
    if (statSync(child).isDirectory()) return sourceFiles(relative(repoRoot, child));
    return [".ts", ".tsx", ".mjs"].includes(extname(child)) ? [relative(repoRoot, child)] : [];
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(`module:check 失败：${message}`);
}

function assertRulesPublicSurface() {
  const entry = source("app/_runtime/lib/rules/index.ts");
  const valueExports = [...entry.matchAll(/export\s+(?!type\b)\{([^}]*)\}\s+from/g)]
    .flatMap((match) => match[1].split(",").map((name) => name.trim()).filter(Boolean))
    .sort();
  assert(
    JSON.stringify(valueExports) === JSON.stringify(["project", "replay", "step"]),
    `Rules 公开值必须且只能是 project/replay/step，实际为 ${valueExports.join(", ") || "空"}`,
  );

  const productionFiles = sourceFiles("app").filter((path) =>
    !path.startsWith("app/_runtime/lib/rules/")
    && !path.startsWith("app/_runtime/lib/rules\\"));
  const privateImports = productionFiles.flatMap((path) => {
    const matches = [...source(path).matchAll(/from\s+["']([^"']+)["']/g)];
    return matches
      .filter(([, specifier]) => /(?:^|\/)rules\/(?:v2(?:\/|$)|v2-runtime(?:$|\/))/.test(specifier))
      .map(([, specifier]) => `${path} -> ${specifier}`);
  });
  assert(
    privateImports.length === 0,
    `Rules 私有实现被外层导入：${privateImports.join("；")}`,
  );

  const productionRoots = ["app", "worker", "db", "cloudflare", "tools"];
  const productionSources = [...new Set(
    productionRoots.flatMap((root) => sourceFiles(root)),
  )];
  const targetsLegacyEngine = (importer, specifier) => {
    if (specifier.startsWith(".")) {
      const resolved = join(dirname(importer), specifier).replace(/\.[cm]?[jt]s$/, "");
      return resolved === "app/_runtime/lib/rules/engine";
    }
    return /(?:^|\/)rules\/engine(?:\.[cm]?[jt]s)?$/.test(specifier);
  };
  const directLegacyEngineImports = productionSources.flatMap((path) => {
    const file = source(path);
    const specifiers = [
      ...file.matchAll(/\bfrom\s+["']([^"']+)["']/g),
      ...file.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
      ...file.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1]);
    return specifiers
      .filter((specifier) => targetsLegacyEngine(path, specifier))
      .filter(() => path !== "app/_runtime/lib/rules/legacy-adapter.ts")
      .map((specifier) => `${path} -> ${specifier}`);
  });
  assert(
    directLegacyEngineImports.length === 0,
    `生产代码必须通过显式 Legacy facade，禁止直接导入 rules/engine：${directLegacyEngineImports.join("；")}`,
  );
}

function assertAuthoritativeOuterBoundaries() {
  const outerAuthorityFiles = [
    "app/api/game/route.ts",
    "app/table/[code]/table-client.tsx",
    "app/_runtime/components/play-table.tsx",
    "app/_runtime/lib/kp/authoritative.ts",
    "app/_runtime/lib/kp/authoritative-helpers.ts",
    "app/_runtime/lib/kp/authoritative-policy.ts",
    "app/_runtime/lib/kp/authoritative-types.ts",
    "app/_runtime/lib/room/action.ts",
    "app/_runtime/lib/room/archive.ts",
    "app/_runtime/lib/room/proposal-adapter.ts",
    "app/_runtime/lib/room/server.ts",
    "app/_runtime/lib/table/authoritative.ts",
    "app/_runtime/lib/table/authoritative-client.ts",
    "app/_runtime/lib/table/client.ts",
    "worker/index.ts",
  ];
  const forbiddenRandomness = /Math\.random\s*\(|crypto\.getRandomValues\s*\(|\broll(?:Die|Dice|D20|DiceExpr)\s*\(/;
  const randomOwners = outerAuthorityFiles.filter((path) => forbiddenRandomness.test(source(path)));
  assert(
    randomOwners.length === 0,
    `Room DO 之外的 authoritative-v2 外层代码不得掷骰：${randomOwners.join("、")}`,
  );

  const legacyActiveTables = /\b(?:FROM|INTO|UPDATE|DELETE\s+FROM)\s+(?:game_states|messages|session_logs)\b/i;
  const secondStateOwners = outerAuthorityFiles.filter((path) => legacyActiveTables.test(source(path)));
  assert(
    secondStateOwners.length === 0,
    `authoritative-v2 外层不得读取或写入旧活跃状态/旁白表：${secondStateOwners.join("、")}`,
  );
}

function exportedSection(file, name, nextName) {
  const start = file.indexOf(`export const ${name} =`);
  const end = file.indexOf(`export const ${nextName} =`, start + 1);
  assert(start !== -1, `${name} Table 服务入口缺失`);
  assert(end !== -1, `${nextName} Table 服务边界缺失`);
  return file.slice(start, end);
}

function assertExactTableRulesetRouting() {
  const table = source("app/_runtime/lib/table/server.ts");
  const cases = [
    ["fetchTable", "setRoomModel", "info.ruleset_version !== RULESET_VERSION", "const messages ="],
    ["setRoomModel", "lockCharacter", "current.ruleset_version !== RULESET_VERSION", "update rooms set kp_model"],
    ["startGame", "sendAction", "info.ruleset_version !== RULESET_VERSION", "const where:"],
    ["sendAction", "acknowledgeDelivery", "info.ruleset_version !== RULESET_VERSION", "let sheet = ensureGear"],
    ["resolveRoll", "joinCombat", "roomInfo?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["joinCombat", "extraAttack", "rules?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["extraAttack", "endTurn", "rules?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["endTurn", "leaveFight", "rules?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["leaveFight", "resolveReact", "rules?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["resolveReact", "restNow", "rules?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["restNow", "cancelRest", "rules?.ruleset_version !== RULESET_VERSION", "const pc = ("],
    ["cancelRest", "castSpell", "rules?.ruleset_version !== RULESET_VERSION", "const pc = ("],
    ["castSpell", "useFeature", "rules?.ruleset_version !== RULESET_VERSION", "const row = ("],
    ["useFeature", "useHitDie", "rules?.ruleset_version !== RULESET_VERSION", "const row = ("],
    ["useHitDie", "kickMember", "rules?.ruleset_version !== RULESET_VERSION", "const row = ("],
  ];

  for (const [name, nextName, gateText, legacyBoundaryText] of cases) {
    const section = exportedSection(table, name, nextName);
    const authoritative = section.indexOf("AUTHORITATIVE_RULESET_VERSION");
    const gate = section.indexOf(gateText, authoritative);
    const legacyBoundary = section.indexOf(legacyBoundaryText, authoritative);
    assert(authoritative !== -1, `${name} 缺少 authoritative-v2 路由`);
    assert(legacyBoundary !== -1, `${name} 缺少可审计的 Legacy 边界`);
    assert(
      gate > authoritative && gate < legacyBoundary,
      `${name} 未在 Legacy 逻辑前按精确 ruleset_version fail closed`,
    );
    assert(
      /return\s*\{\s*ok:\s*false as const/.test(section.slice(gate, legacyBoundary)),
      `${name} 的未知 ruleset_version 未明确拒绝`,
    );
  }
}

function assertTypedRoomProposalBoundary() {
  const room = source("app/_runtime/lib/room/durable-object.ts");
  const adapter = source("app/_runtime/lib/room/proposal-adapter.ts");
  const legacyProposalKinds = [
    "resolveImprovisedAction",
    "resolveContest",
    "startEncounter",
    "requestClarification",
    "invitePartyMember",
    "cancelPartyInvitation",
    "leavePartyGroup",
    "transferPartyLeadership",
    "proposePartyMove",
    "moveIndividually",
    "resolveFreeAction",
    "startRest",
    "resolveDynamicDanger",
    "materializeDynamicDanger",
    "resolveNpcInteraction",
    "shareKnowledge",
    "resolveNpcAction",
    "resolveMeaningfulFailure",
    "rejectRepeatedAttempt",
    "raiseEndingCandidate",
    "concludeStory",
    "recordEpilogueChoice",
  ];
  const reachableLegacyBranches = legacyProposalKinds.filter((kind) =>
    room.includes(`proposal.kind === "${kind}"`)
    || room.includes(`proposal.kind !== "${kind}"`));
  assert(
    reachableLegacyBranches.length === 0,
    `authoritative-v2 Room 不得保留 compact proposal 分支：${reachableLegacyBranches.join("、")}`,
  );
  assert(
    adapter.includes("validateProposal(draftValue)"),
    "Room proposal adapter 必须复用 production KpProposalDraft 严格校验器",
  );
  assert(
    room.includes("isCanonicalAuthorityRecoveryInput(recovery.rulesInput)"),
    "随机续接恢复必须重新限制为版本化 ActionPlan/待决回答",
  );
}

function assertSingleViewerProjector() {
  const room = source("app/_runtime/lib/room/durable-object.ts");
  assert(
    !room.includes("projectionHash: canonicalSha256"),
    "Room 不得在 Rules project 之外手工生成 Viewer projectionHash",
  );
  assert(
    !room.includes("const lifecycleBase"),
    "继任角色生命周期观察必须复用 Rules project",
  );
}

const count = assertAllModules();
assertRulesPublicSurface();
assertAuthoritativeOuterBoundaries();
assertExactTableRulesetRouting();
assertTypedRoomProposalBoundary();
assertSingleViewerProjector();
console.log(`module:check 通过（${count} 个模组；Rules/Room 权威边界已验证）`);
