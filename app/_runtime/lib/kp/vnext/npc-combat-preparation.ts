import type { AuthoritativeModuleProfile } from "../../module/authoritative";
import type { AuthoritativeWorldState, RuntimeProfileManifest } from "../../rules";
import { authorityRevisionOrHash, combatStartIssues } from "../../rules/authority-read";
import { COMBAT_START_SOURCE_SCHEMA, isCombatStart, isNpcSpatialShell, type CombatStart } from "../../rules/shapes";
import { extractSingleToolCall } from "../authoritative-helpers";
import { canonicalHash, isPlainRecord, parseJsonWithUniqueMembers } from "./canonical-json";
import { parseSubmitKpProposalBundleCandidateResponse } from "./proposal-provider";
import { requiredContextViewerRefs } from "./required-context-runtime";
import type { VNextRequiredContext } from "./required-context";
import { SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, type VNextProposalBundle } from "./proposal-schema";

/** SPEC 0006 §7: a separate hosting call supplies missing target mechanics
 * after the NPC has made its own decision. The NPC never reads this frame. */
export const NPC_COMBAT_PREPARATION_TOOL = "prepare_npc_combat_statistics";
const instruction = "你是主持KP，只补齐列出NPC尚未具备的可执行战斗定义。发起者已经按本人知识决定开战，本请求不重新判断其意图，不增删参战者、不改敌对、台词、位置或结果。服从每名NPC既有属性、装备与模组机械锚点；仅补空白，不按玩家等级平衡。只返回missingNpcRefs各一条combatStatistics，不为其他对象填写。armorClass、speedFeet服从既有loadout，HP服从已知最大值；攻击/豁免/伤害采用SRD 5.1可执行形式，damage包含调整值。无攻击能力可以attacks=[]，不能凭空给原来不会战斗的人添加法术。";
const tool = { type: "function", function: { name: NPC_COMBAT_PREPARATION_TOOL, strict: true,
  description: "Supply exactly the missing NPC combat definitions; no world action or other character decision.",
  parameters: { type: "object", additionalProperties: false, properties: {
    combatStatistics: COMBAT_START_SOURCE_SCHEMA.properties!.combatStatistics,
  }, required: ["combatStatistics"] } } };
export const NPC_COMBAT_PREPARATION_BINDING_HASH = canonicalHash({ version: "npc-combat-preparation/v1", instruction, tool });
export type NpcCombatPreparation = Readonly<{
  npcId: string; rootActionId: string; npcBundleHash: string; contextHash: string;
  start: CombatStart; missingNpcRefs: readonly string[]; targets: readonly Record<string, unknown>[];
  moduleRef: AuthoritativeModuleProfile["moduleRef"];
}>;
export type PreparedNpcCombatStatistics = Readonly<{ npcBundleHash: string; npcId: string; statistics: CombatStart["combatStatistics"] }>;

function startOf(bundle: VNextProposalBundle): CombatStart | undefined {
  if (bundle.mode !== "terminal" || bundle.terminal.kind !== "startCombat") return undefined;
  const { kind: _kind, ...start } = bundle.terminal;
  return isCombatStart(start) ? start : undefined;
}

export function prepareNpcCombatStatisticsRequest(input: Readonly<{
  response: unknown; npcId: string; rootActionId: string; context: VNextRequiredContext;
  state: AuthoritativeWorldState; profiles: RuntimeProfileManifest; moduleProfile: AuthoritativeModuleProfile;
}>): NpcCombatPreparation | undefined {
  if (extractSingleToolCall(input.response).name !== SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) return undefined;
  const candidate = parseSubmitKpProposalBundleCandidateResponse(input.response);
  if (candidate.kind !== "accepted") return undefined; // A decline or plan decision follows its existing decoder.
  const start = startOf(candidate.bundle);
  if (!start) return undefined;
  if (start.combatStatistics.some(stats => stats.npcRef !== input.npcId)) throw new TypeError("NPC_CANNOT_AUTHOR_TARGET_STATISTICS");
  const visible = requiredContextViewerRefs(input.context);
  const missing = start.participants.map(entry => entry.creatureRef).filter(ref => ref !== input.npcId
    && input.state.entities[ref]?.kind === "npc" && isNpcSpatialShell(input.state.combatRuntime.entities[ref]));
  if (!missing.length) return undefined;
  if (missing.some(ref => !visible.has(ref))) throw new TypeError("NPC_COMBAT_TARGET_UNSEEN");
  const issues = combatStartIssues(input.profiles, input.state, input.npcId, start);
  if (issues.some(issue => issue.constraint !== "combat-start:combat-statistics-required")
    || issues.some(issue => Array.isArray(issue.expected.refs) && issue.expected.refs.some(ref => !missing.includes(String(ref))))) {
    throw new TypeError("NPC_COMBAT_DECISION_INVALID_BEFORE_PREPARATION");
  }
  return { npcId: input.npcId, rootActionId: input.rootActionId, npcBundleHash: canonicalHash(candidate.bundle),
    contextHash: input.context.binding.contextHash, start, missingNpcRefs: [...missing].sort(), moduleRef: input.moduleProfile.moduleRef,
    targets: [...missing].sort().map(npcRef => {
      const entity = input.state.entities[npcRef];
      const anchor = input.moduleProfile.storyBible.importantNpcs.find(npc => npc.entityId === npcRef);
      return { npcRef, revisionOrHash: authorityRevisionOrHash(input.state, npcRef), name: entity.name,
        abilityScores: entity.abilityScores ?? entity.socialMechanics?.abilityScores ?? null,
        proficiencyBonus: entity.proficiencyBonus ?? entity.socialMechanics?.proficiencyBonus ?? null,
        loadout: entity.loadout ? { armorClass: entity.loadout.armorClass, speedFeet: entity.loadout.speedFeet, equipped: entity.loadout.equipped } : null,
        hitPoints: entity.hitPoints ?? null,
        mechanicalAnchor: anchor?.mechanicalAnchor ?? null };
    }) };
}

export function npcCombatStatisticsModelInput(request: NpcCombatPreparation): Record<string, unknown> {
  return { messages: [{ role: "system", content: instruction }, { role: "user", content: JSON.stringify({
    moduleRef: request.moduleRef, missingNpcRefs: request.missingNpcRefs, targets: request.targets,
  }) }], tools: [tool], tool_choice: { type: "function", function: { name: NPC_COMBAT_PREPARATION_TOOL } },
  max_tokens: 4_000, temperature: 0.2 };
}

export function readNpcCombatStatistics(response: unknown, request: NpcCombatPreparation,
  state: AuthoritativeWorldState, profiles: RuntimeProfileManifest): PreparedNpcCombatStatistics {
  const call = extractSingleToolCall(response);
  const value = typeof call.arguments === "string" ? parseJsonWithUniqueMembers(call.arguments) : null;
  if (call.name !== NPC_COMBAT_PREPARATION_TOOL || !isPlainRecord(value) || Object.keys(value).join() !== "combatStatistics"
    || !Array.isArray(value.combatStatistics)) throw new TypeError("NPC_COMBAT_PREPARATION_INVALID");
  const start = { ...request.start, combatStatistics: [...request.start.combatStatistics, ...value.combatStatistics] };
  const issues = isCombatStart(start) ? combatStartIssues(profiles, state, request.npcId, start) : [];
  if (!isCombatStart(start) || value.combatStatistics.length !== request.missingNpcRefs.length
    || value.combatStatistics.some(row => !isPlainRecord(row) || !request.missingNpcRefs.includes(String(row.npcRef)))
    || request.targets.some(target => authorityRevisionOrHash(state, String(target.npcRef)) !== target.revisionOrHash)
    || issues.length > 0) throw Object.assign(new TypeError("NPC_COMBAT_PREPARATION_INVALID"), { issues });
  return { npcId: request.npcId, npcBundleHash: request.npcBundleHash, statistics: value.combatStatistics as CombatStart["combatStatistics"] };
}

/** Only Room supplies this extra argument from the saved hosting call. A raw
 * NPC response cannot author someone else's statistics or overwrite its own. */
export function withPreparedNpcCombatStatistics(bundle: VNextProposalBundle, npcId: string,
  prepared?: PreparedNpcCombatStatistics): VNextProposalBundle {
  const start = startOf(bundle);
  if (!start) {
    if (prepared) throw new TypeError("NPC_COMBAT_PREPARATION_UNEXPECTED");
    return bundle;
  }
  if (start.combatStatistics.some(stats => stats.npcRef !== npcId)) throw new TypeError("NPC_CANNOT_AUTHOR_TARGET_STATISTICS");
  if (!prepared) return bundle;
  if (prepared.npcId !== npcId || prepared.npcBundleHash !== canonicalHash(bundle)) throw new TypeError("NPC_COMBAT_PREPARATION_STALE");
  return { ...bundle, terminal: { kind: "startCombat", ...start,
    combatStatistics: [...start.combatStatistics, ...prepared.statistics] } } as VNextProposalBundle;
}
