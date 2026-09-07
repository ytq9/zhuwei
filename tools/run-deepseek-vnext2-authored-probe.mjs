import { randomInt } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createDeepSeekStrictToolBinding, assertDeepSeekStrictToolModelInput } from "../app/_runtime/lib/kp/deepseek.ts";
import { DEEPSEEK_V4_FLASH_VNEXT2_STRICT_TOOL_CANDIDATE } from "../app/_runtime/lib/kp/model-registry.ts";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import { authorityDefinitionComposite } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { createSubmitKpProposalBundleModelInput, SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { invokeSubmitKpProposalBundleWithOneCorrection, VNEXT_PROPOSAL_BUNDLE_PARSER_HASH } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { selectPlanReadSet } from "../app/_runtime/lib/kp/vnext/proposals.ts";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR, PROBE_SCENE, PROBE_SOURCE, PROBE_ZONE, PROBE_TARGET } from "./lib/vnext-authored-probe-fixture.mjs";

const COMMON = `你是KP。只调用submit_kp_proposal_bundle一次，用完整closed schema填写。以下是隔离本地验证场景，冻结依据来自同次提供的requiredContext。
人物${PROBE_ACTOR}和${PROBE_TARGET}在${PROBE_SCENE}。可见阀门是${PROBE_SOURCE}，固定喷流区域是${PROBE_ZONE}，目标${PROBE_TARGET}在区域内。
用decision.kind=directSuccess，完整填写risk/successOutcome/steps。操作能实施，但机械Ability内部攻击/豁免/伤害仍由Rules掷骰。每一步basisRefs至少包含${PROBE_SOURCE}；不填terminal、consumes、produces或outcomeBinding。
新定义和实例只填写prospective handle；消费者在类型化引用中复用句柄，服务器生成依赖。只使用这些冻结引用或本束新句柄。
只有materializeItem产生新的itemEntry句柄；inventoryOperation不命名新handle，acquire/transfer/use复用原始实例。部分堆叠拆分的真实实例ID由Rules管理。
不要输出authority ID、revision、compiler数据、骰面、modifier、事件、DAG。所有未使用的对象填{kind:'none'}、数组填[]。文本短而明确。`;
export const AUTHORED_PROBE_CASES = Object.freeze([
  { caseId: "hazard", prompt: `${COMMON}
本次需要你创作并触发一个机械完整的危险：扰动阀门引发蒸汽喷射，对喷流区域中的人物作敏捷DC13豁免，失败受2d6火焰伤害，成功伤害减半；失败还目盲10秒。请定义迹象与关闭阀门的解除办法，环境后果是冷凝水。
提交三项：先materializeDefinition能力，再materializeDefinition hazard引用该能力，再worldInteraction触发已作者化hazard。Ability activation=nonCombatHazard，target用creature/count=1/rangeInches=120/requiresSight=false；伤害与grantEffect持续时间由通用Ability字段表达。危险mechanicsRef引用该Ability，trigger用disturbFeature/ref=${PROBE_SOURCE}。危险definition visibilityPolicyRef=hidden-until-evidence完整枚举值；触发不泄露完整定义。
worldInteraction针对可见阀门，abilityRef=none，无工具，otherTargetRefs=[]；result.effects引用新hazard、sourceDefinitionRef=${PROBE_SOURCE}、zoneRef=${PROBE_ZONE}；不填写失败分支，不加额外效果。` },
  { caseId: "item", prompt: `${COMMON}
本次需要创作一批可喝的治疗药剂并使用一个：演员${PROBE_ACTOR}当前10/20HP，物品应恢复2d4+2HP。
提交五项：materializeDefinition治疗Ability；materializeDefinition ItemDefinition引用它；materializeItem从定义在${PROBE_SCENE}生成2瓶；inventoryOperation acquire拿起2瓶；inventoryOperation use对${PROBE_ACTOR}使用1瓶。
Ability activation=useObject/actionGrant=normalAction，target=creature/count=1/rangeInches=0/requiresSight=false，healing formula=2d4+2，attack/save/effect/temporaryHitPoints=none，其他机械列表为空。
ItemDefinition category=consumable，stackable=true，无equipment或charges/durability counters；use=useObject，quantityCost=1，chargeCost=durabilityCost=0。新实例ownership=unowned，ownerRef=none。物品definition与entry的visibilityPolicyRef均visibility:public。物品定义和实例是分开的producer，实际使用必须走inventoryOperation。` },
]);

class ProbeFailure extends Error {
  constructor(code, diagnostics) { super(code); this.code = code; this.diagnostics = diagnostics; }
}
function problem(code, diagnostics) { return new ProbeFailure(code, diagnostics); }
function sample(request) {
  const terms = Array.isArray(request.dice) ? request.dice
    : request.diceExpression === "1d20" ? [{ count: 1, sides: 20 }]
      : ["2d20kh1", "2d20kl1"].includes(request.diceExpression) ? [{ count: 2, sides: 20 }] : undefined;
  if (!terms) throw problem("PROBE_RANDOMNESS_TERMS_UNAVAILABLE");
  const rolls = [];
  for (const term of terms) {
    const count = Number(term.count), sides = Number(term.sides);
    if (!Number.isSafeInteger(count) || count < 1 || count + rolls.length > 128 || !Number.isSafeInteger(sides) || sides < 2 || sides > 1_000_000) throw problem("PROBE_RANDOMNESS_TERMS_INVALID");
    for (let i = 0; i < count; i += 1) rolls.push(randomInt(1, sides + 1));
  }
  return rolls;
}
function settle(fixture, rulesInput) {
  let result = fixture.runtime.step(fixture.profiles, fixture.state, rulesInput);
  const events = [...(result.events ?? [])];
  let randomWaves = 0;
  while (result.kind === "awaitingRandomness") {
    if (++randomWaves > 4) throw problem("PROBE_RANDOMNESS_WAVE_BUDGET_EXCEEDED");
    if (!result.continuation || !result.randomnessRequest) throw problem("PROBE_RANDOMNESS_CONTINUATION_UNSUPPORTED");
    result = fixture.runtime.step(result.profiles ?? fixture.profiles, result.state, { kind: "fulfillAuthoritativeRandomness", continuation: result.continuation, rolls: sample(result.randomnessRequest) });
    events.push(...(result.events ?? []));
  }
  if (result.kind !== "committed" && result.kind !== "concluded") throw problem(`RULES_${String(result.rejection?.code ?? result.kind)}`, { kind: result.kind, message: result.rejection?.message });
  const replay = fixture.runtime.replay(fixture.genesis, events);
  if (replay.kind !== "replayed" || canonicalSha256(replay.state) !== canonicalSha256(result.state)) throw problem("PROBE_REPLAY_MISMATCH");
  const projection = fixture.runtime.project(result.profiles ?? fixture.profiles, result.state, fixture.viewer);
  if (projection.kind !== "projected") throw problem("PROBE_PROJECTION_REJECTED");
  return { result, events, randomWaves, projection };
}
function assertCapability(caseId, bundle, settled) {
  const kinds = bundle.proposals.map(({ kind }) => kind);
  if (!kinds.includes("materializeDefinition")) throw problem("PROBE_AUTHORING_MISSING");
  if (caseId === "hazard") {
    if (!bundle.proposals.some((entry) => entry.kind === "materializeDefinition" && entry.source.kind === "hazard") || !kinds.includes("worldInteraction") || settled.randomWaves < 1) throw problem("PROBE_HAZARD_PATH_MISSING");
    if (settled.result.state.entities[PROBE_TARGET].hitPoints.current >= 20) throw problem("PROBE_HAZARD_DAMAGE_MISSING");
  } else {
    const entries = Object.values(settled.result.state.campaignRuntime.itemSystem.entries).filter((entry) => entry.holderRef === PROBE_ACTOR);
    if (!kinds.includes("materializeItem") || !kinds.includes("inventoryOperation") || !entries.some((entry) => entry.quantity === 1)) throw problem("PROBE_ITEM_LIFECYCLE_MISSING");
    if (settled.result.state.entities[PROBE_ACTOR].hitPoints.current <= 10) throw problem("PROBE_ITEM_HEALING_MISSING");
  }
}
function nextContextEvidence(fixture, caseId, settled) {
  const state = settled.result.state;
  const authored = settled.events.filter(({ eventType }) => eventType === "AuthoredMaterializationResolved").map(({ payload }) => payload);
  const focusRefs = caseId === "hazard" ? [PROBE_SOURCE]
    : authored.filter(({ kind }) => kind === "itemEntry").map(({ ref }) => ref);
  const frozen = freezeAuthoredProbeContext(fixture, state, { focusRefs });
  const known = new Map(frozen.context.entries.filter(({ kind }) => kind === "known").map((entry) => [entry.entryRef, entry]));
  const required = [];
  if (caseId === "hazard") {
    for (const marker of authored.filter(({ kind }) => kind === "hazardDefinition")) {
      const definition = state.campaignRuntime.definitions[marker.ref];
      const composite = authorityDefinitionComposite(state, marker.ref);
      const entry = known.get(marker.ref);
      if (!entry || canonicalSha256(entry.value) !== canonicalSha256(composite)
        || !known.has(definition.content.mechanicsRef)
        || !["trigger", "perceptibleSigns", "disableMethods", "environmentalConsequences"].every((key) => Object.hasOwn(entry.value.content, key))) {
        throw problem("PROBE_NEXT_HAZARD_CONTEXT_INCOMPLETE", { hazardRef: marker.ref, hazardLoaded: Boolean(entry),
          mechanicsLoaded: known.has(definition.content.mechanicsRef),
          metadataMatches: Boolean(entry) && canonicalSha256(entry.value) === canonicalSha256(composite) });
      }
      if (definition.visibilityPolicyRef === "visibility:hidden-until-evidence"
        && frozen.context.references.citations.viewerEvidenceRefs.includes(marker.ref)) throw problem("PROBE_NEXT_HAZARD_DISCLOSURE_INVALID");
      required.push(marker.ref, definition.content.mechanicsRef);
    }
  } else {
    for (const marker of authored.filter(({ kind }) => kind === "itemEntry")) {
      const entry = state.campaignRuntime.itemSystem.entries[marker.ref];
      const definition = state.campaignRuntime.itemSystem.definitions[entry.definitionRef];
      const abilityRefs = [...definition.content.equippedAbilityRefs, ...(definition.content.use === null ? [] : [definition.content.use.abilityRef])];
      required.push(marker.ref, entry.definitionRef, ...abilityRefs);
    }
  }
  const selected = selectPlanReadSet(frozen.context, required);
  if (required.length === 0 || selected.kind !== "accepted") throw problem("PROBE_NEXT_CONTEXT_DEPENDENCY_NOT_BOUND",
    selected.kind === "rejected" ? { code: selected.code, issues: selected.issues } : undefined);
  return { contextHash: frozen.context.binding.contextHash, requiredRefs: [...new Set(required)].sort(), readSetCount: selected.readSet.length,
    frontierExhausted: frozen.coverage.frontierExhausted };
}
/** Uses the public initial-plus-one-correction path. Transport and Rules failures never retry. */
export async function runAuthoredProviderProbe({ live = false, invoke, timeoutMs = 60_000, cases = AUTHORED_PROBE_CASES,
  maxCalls = cases.length * 2, onResponse, persistRepairTicket } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 || cases.length < 1 || cases.length > 2
    || !Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > cases.length * 2) throw problem("PROBE_BUDGET_INVALID");
  const report = { schema: "zhuwei.authored-provider-probe/v1", mode: live ? "live-provider" : "dry-run", modelId: DEEPSEEK_V4_FLASH_VNEXT2_STRICT_TOOL_CANDIDATE.modelId,
    schemaHash: canonicalSha256(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA), parserHash: VNEXT_PROPOSAL_BUNDLE_PARSER_HASH, maxProviderCalls: maxCalls, liveProviderCalls: 0, cases: [] };
  for (const probe of cases) {
    const fixture = createAuthoredProbeFixture(probe.caseId);
    const message = JSON.stringify({ instruction: probe.prompt, requiredContext: fixture.requiredContext });
    const modelInput = createSubmitKpProposalBundleModelInput(message);
    assertDeepSeekStrictToolModelInput(modelInput);
    const evidence = { caseId: probe.caseId, requestHash: canonicalSha256(modelInput), status: live ? "pending" : "dry-run-valid", invocations: [],
      stages: { schema: true, fixture: true, provider: false, parser: false, lowering: false, rules: false, replay: false, projection: false, nextContext: false } };
    if (live) {
      if (typeof invoke !== "function") throw problem("PROBE_INVOKER_REQUIRED");
      try {
        const parsed = await invokeSubmitKpProposalBundleWithOneCorrection({ modelId: report.modelId, message, requiredContext: fixture.requiredContext,
          binding: { async run(model, input) {
            if (report.liveProviderCalls >= maxCalls) throw problem("PROBE_PROVIDER_CALL_BUDGET_EXCEEDED");
            assertDeepSeekStrictToolModelInput(input);
            const receipt = { ordinal: evidence.invocations.length + 1, toolName: input.tools[0].function.name, requestHash: canonicalSha256(input), status: "pending" };
            evidence.invocations.push(receipt);
            report.liveProviderCalls += 1;
            const controller = new AbortController();
            let timer;
            try {
              const response = await Promise.race([invoke(model, input, { signal: controller.signal }), new Promise((_resolve, reject) => {
                timer = setTimeout(() => { controller.abort(); reject(problem("PROBE_PROVIDER_TIMEOUT")); }, timeoutMs);
              })]);
              receipt.status = "received";
              evidence.stages.provider = true;
              if (onResponse) await onResponse(probe.caseId, response, receipt);
              if (response?.usage) receipt.usage = Object.fromEntries(["prompt_tokens", "completion_tokens", "total_tokens"]
                .filter((key) => Number.isSafeInteger(response.usage[key])).map((key) => [key, response.usage[key]]));
              return response;
            } catch (error) { receipt.status = "failed"; throw error; }
            finally { if (timer) clearTimeout(timer); }
          } },
          async persistRepairTicket(ticket) {
            if (persistRepairTicket) await persistRepairTicket(probe.caseId, ticket);
            else {
              const directory = await mkdtemp(join(tmpdir(), "zhuwei-authored-probe-"));
              const path = join(directory, `${probe.caseId}-repair-ticket.json`);
              await writeFile(path, JSON.stringify(ticket), { mode: 0o600 });
              evidence.repairTicketPath = path;
            }
            evidence.repairTicketHash = ticket.ticketHash;
          },
        });
        evidence.repairUsed = parsed.repairUsed;
        evidence.invocationCount = parsed.invocationCount;
        if (parsed.kind !== "locallyAccepted") throw problem("PROBE_PARSER_REJECTED", { code: parsed.code, issues: parsed.issues });
        evidence.stages.parser = true;
        evidence.bundleHash = parsed.bundleHash;
        evidence.proposalKinds = parsed.bundle.proposals.map(({ kind }) => kind);
        const lowered = lowerVNext2ProposalBundle({ value: parsed.bundle, requiredContext: fixture.requiredContext, state: fixture.state, rootActionId: fixture.rootActionId, actorCharacterId: fixture.actorCharacterId });
        if (lowered.kind !== "accepted" || lowered.command.kind !== "rulesStep") throw problem("PROBE_LOWERING_REJECTED", { code: lowered.code, issues: lowered.issues });
        evidence.stages.lowering = true;
        const settled = settle(fixture, lowered.command.rulesInput);
        assertCapability(probe.caseId, parsed.bundle, settled);
        Object.assign(evidence.stages, { rules: true, replay: true, projection: true });
        evidence.nextContext = nextContextEvidence(fixture, probe.caseId, settled);
        evidence.stages.nextContext = true;
        evidence.eventTypes = [...new Set(settled.events.map(({ eventType }) => eventType))];
        evidence.randomWaves = settled.randomWaves;
        evidence.finalStateHash = canonicalSha256(settled.result.state);
        evidence.status = "passed";
      } catch (error) {
        evidence.status = "failed";
        evidence.failureCode = typeof error?.code === "string" ? error.code : error?.name === "AbortError" ? "PROBE_PROVIDER_TIMEOUT" : "PROBE_OUTPUT_INVALID";
        if (Number.isInteger(error?.status)) evidence.providerStatus = error.status;
        // Only locally constructed parser/lowering codes are retained. Never stringify provider errors or request headers.
        if (error instanceof ProbeFailure && error.diagnostics) evidence.diagnostics = error.diagnostics;
      }
    }
    report.cases.push(evidence);
  }
  report.status = report.cases.every(({ status }) => status === (live ? "passed" : "dry-run-valid")) ? (live ? "passed" : "dry-run-valid") : "failed";
  return report;
}
async function main() {
  const live = process.argv.includes("--live");
  const envIndex = process.argv.indexOf("--env-file");
  const caseIndex = process.argv.indexOf("--case");
  const budgetIndex = process.argv.indexOf("--max-calls");
  const selected = caseIndex === -1 ? AUTHORED_PROBE_CASES : AUTHORED_PROBE_CASES.filter(({ caseId }) => caseId === process.argv[caseIndex + 1]);
  if (selected.length === 0) throw problem("PROBE_CASE_UNKNOWN");
  let binding;
  if (live) {
    const fromFile = envIndex === -1 ? {} : parseEnv(await readFile(resolve(process.argv[envIndex + 1]), "utf8"));
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim() || fromFile.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) throw problem("PROBE_API_KEY_MISSING");
    binding = createDeepSeekStrictToolBinding({ apiKey });
  }
  const report = await runAuthoredProviderProbe({ live, cases: selected,
    ...(budgetIndex === -1 ? {} : { maxCalls: Number(process.argv[budgetIndex + 1]) }),
    invoke: binding ? (...args) => binding.run(...args) : undefined });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === "failed") process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { process.stdout.write(`${JSON.stringify({ schema: "zhuwei.authored-provider-probe/v1", status: "blocked", failureCode: typeof error?.code === "string" ? error.code : "PROBE_SETUP_FAILED", liveProviderCalls: 0 })}\n`); process.exitCode = 2; });
}
