import { extractSingleToolCall } from "../authoritative-helpers";
import { CHINESE_WRITING_GUIDANCE } from "../chinese-expression";
import { canonicalHash, deepFreeze, isPlainRecord, parseJsonWithUniqueMembers, sameCanonical } from "./canonical-json";
import { npcOwnModelView, proposalItemEntryRefs, proposalObservationSubjectRefs } from "./proposal-context";
import { proposalDiagnostic, diagnosticActual, diagnosticsFromIssues, type ProposalDiagnostic, type ProposalDiagnosticPath } from "./proposal-diagnostics";
import { derivedStepConsumes, isCheckStep, mergeSocialConsequences, npcReplyDiagnosticTarget, npcReplyPending, rulingDiagnosticOfMerged,
  socialConsequenceAuthor, NPC_REPLY_PENDING_MOTIVE, ProposalFillingError } from "./proposal-filling-interface";
import { createNpcReplySchema, decodeNpcReplyWire, type VNextProposalBundle } from "./proposal-schema";
import { validateVNextProposalBundle } from "./proposal-validator";
import type { VNextRequiredContext } from "./required-context";

// SPEC 0001 §14, SPEC 0006 §7, SPEC 0016 §7.3 (ADR 0073): what an NPC says in a
// conversation is written by a call that reads only that NPC's own view. The
// ruling decides who is addressed, what the listeners hear and see, whether
// the actor's words take effect, and what the actor undertakes; it writes no
// reply. The reply is merged into the decoded plan before lowering, so Rules,
// events and narration read the plan they always did.

import { npcReplyMotive, type NpcIntroduction } from "./npc-introductions";
import { isNpcCombatStance, NPC_REPLY_STANCES_FIGHTING, NPC_REPLY_STANCES_NOT_FIGHTING } from "../../rules/shapes";

type RecordValue = Record<string, unknown>;

export const NPC_REPLY_TOOL_NAME = "reply_as_npc";
export const NPC_REPLY_HEARING_SCHEMA = "zhuwei.npc-reply-hearing/vnext-1";
export const NPC_REPLY_TICKET_SCHEMA = "zhuwei.npc-reply-ticket/vnext-1";
/** The first call of a prepared action that asks an NPC for its reply. The
 * ruling's own calls use the ordinals below it. */
export const NPC_REPLY_FIRST_ORDINAL = 11;
/** Each thing heard takes a reply, at most one second request and one resend
 * of it, in each of up to four ruling versions: 128 calls cover ten
 * conversation steps even when every call is needed. A plan that would need
 * more ends as exhausted. */
export const NPC_REPLY_LAST_ORDINAL = NPC_REPLY_FIRST_ORDINAL + 127;
export type NpcReplyOutcomeName = "success" | "failure" | "result";

/** What the NPC hears and sees in one outcome the ruling froze. `swayed` says
 * only whether the words took effect on this NPC; the actor's purpose, method
 * and skill stay with the ruling. */
export type NpcReplyOutcome = Readonly<{ swayed: "yes" | "no" | "notAsked"; perceived: readonly string[] }>;
export type NpcReplyHearing = Readonly<{
  schema: typeof NPC_REPLY_HEARING_SCHEMA;
  contextHash: string;
  npcRef: string;
  speakerRef: string;
  speech: string;
  audience: string;
  /** Facts this same plan gives this NPC to know, by the handle that names them. */
  newKnowledge: readonly Readonly<{ handle: string; description: string }>[];
  /** Keyed by the name the reply uses: success and failure when the check
   * decides this step, result otherwise. */
  outcomes: Readonly<Partial<Record<NpcReplyOutcomeName, NpcReplyOutcome>>>;
  /** SPEC 0006 §7 (ADR 0117): present only when the NPC and the speaker take
   * part in the same running encounter: whether the NPC is fighting the
   * speaker, and the stances each reply chooses from. */
  combat?: Readonly<{ fightingSpeaker: boolean; stances: readonly string[] }>;
}>;

/** SPEC 0006 §7 (ADR 0117): the stances a reply may take in a fight, read
 * from the frozen records of the NPC and the speaker (the encounter each is
 * in and whom the NPC fights). A context frozen without that record offers
 * none. */
function npcReplyCombat(context: VNextRequiredContext, npcRef: string, speakerRef: string): NpcReplyHearing["combat"] {
  const marker = (ref: string): RecordValue | undefined => {
    const entry = (Array.isArray(context.entries) ? context.entries : []).find(candidate => candidate.kind === "known" && candidate.entryRef === ref);
    const value = entry?.kind === "known" && isPlainRecord(entry.value) ? entry.value.encounter : undefined;
    return isPlainRecord(value) && value.status !== "concluded" ? value : undefined;
  };
  const npc = marker(npcRef), speaker = marker(speakerRef);
  if (npc === undefined || speaker === undefined || npc.encounterId !== speaker.encounterId || !Array.isArray(npc.fighting)) return undefined;
  const fightingSpeaker = npc.fighting.includes(speakerRef);
  return { fightingSpeaker, stances: fightingSpeaker ? [...NPC_REPLY_STANCES_FIGHTING] : [...NPC_REPLY_STANCES_NOT_FIGHTING] };
}

/** The outcomes a reply writes, in the order its form lists them. The order
 * is fixed here and never read from a record's own member order, so a hearing
 * restored from a store that sorts members builds the same request. */
export function npcReplyOutcomeNames(hearing: NpcReplyHearing): readonly NpcReplyOutcomeName[] {
  return (["result", "success", "failure"] as const).filter(name => Object.hasOwn(hearing.outcomes, name));
}

/** One conversation step of a decoded plan. */
export type NpcReplyStep = Readonly<{
  /** [] for the root plan, or the path of a clarification continuation. */
  frame: ProposalDiagnosticPath;
  proposal: number;
  hearing: NpcReplyHearing;
  hearingHash: string;
}>;

type Frame = Readonly<{ path: ProposalDiagnosticPath; adjudication: RecordValue; proposals: readonly unknown[] }>;

function frames(bundle: unknown): Frame[] {
  if (!isPlainRecord(bundle)) return [];
  const found: Frame[] = [];
  if (isPlainRecord(bundle.adjudication) && Array.isArray(bundle.proposals)) found.push({ path: [], adjudication: bundle.adjudication, proposals: bundle.proposals });
  const terminal = bundle.terminal;
  if (isPlainRecord(terminal) && terminal.kind === "clarification" && Array.isArray(terminal.choices)) terminal.choices.forEach((choice, index) => {
    const continuation = isPlainRecord(choice) ? choice.continuation : undefined;
    if (isPlainRecord(continuation) && isPlainRecord(continuation.adjudication) && Array.isArray(continuation.proposals))
      found.push({ path: ["terminal", "choices", index, "continuation"], adjudication: continuation.adjudication, proposals: continuation.proposals });
  });
  return found;
}

/** The written branches of a conversation step and the name each takes in
 * the reply. */
function outcomeNames(entry: RecordValue): readonly (readonly ["success" | "failure", NpcReplyOutcomeName])[] {
  return isCheckStep(entry) ? [["success", "success"], ["failure", "failure"]] : [["success", "result"]];
}

/** Every conversation step of a plan with what its NPC hears, in plan order.
 * The reply's own words are no part of what was heard, so a plan reads the
 * same before and after its replies are merged. */
export function npcReplySteps(bundle: unknown, context: VNextRequiredContext): readonly NpcReplyStep[] {
  return frames(bundle).flatMap(frame => frame.proposals.flatMap((entry, proposal): NpcReplyStep[] => {
    if (!isPlainRecord(entry) || entry.kind !== "social" || !isPlainRecord(entry.branches) || typeof entry.npcRef !== "string"
      || typeof entry.actorSpeech !== "string") return [];
    const npcRef = entry.npcRef, branches = entry.branches, decided = isCheckStep(entry);
    const concealment = isPlainRecord(frame.adjudication.concealment) ? frame.adjudication.concealment : undefined;
    // SPEC 0005 §6.2: the primary observer's reply after a failed hidden act
    // answers what that observer noticed.
    const noticed = entry.outcomeBinding === "onFailure" && concealment?.primaryObserverRef === npcRef
      && typeof concealment.evidence === "string" ? [concealment.evidence] : [];
    const outcomes = Object.fromEntries(outcomeNames(entry).flatMap(([branch, name]) => {
      const written = branches[branch];
      if (!isPlainRecord(written)) return [];
      return [[name, { swayed: !decided ? "notAsked" as const : branch === "success" ? "yes" as const : "no" as const,
        perceived: [...noticed, ...(typeof written.npcPerceives === "string" ? [written.npcPerceives] : [])] }]];
    }));
    if (Object.keys(outcomes).length === 0) return [];
    const newKnowledge = frame.proposals.flatMap(other => {
      if (!isPlainRecord(other) || other.kind !== "materializeObject" || other.semanticKind !== "worldFact" || other.outcomeBinding !== "always"
        || !isPlainRecord(other.definition) || !isPlainRecord(other.definition.worldFact) || !Array.isArray(other.definition.worldFact.initialKnowledge)
        || !other.definition.worldFact.initialKnowledge.some(holder => isPlainRecord(holder) && holder.holderRef === npcRef)) return [];
      const handle = Array.isArray(other.produces) && isPlainRecord(other.produces[0]) ? other.produces[0].handle : undefined;
      return typeof handle === "string" && typeof other.definition.description === "string" ? [{ handle, description: other.definition.description }] : [];
    });
    const combat = npcReplyCombat(context, npcRef, context.intent.actorRef);
    const hearing: NpcReplyHearing = deepFreeze({ schema: NPC_REPLY_HEARING_SCHEMA, contextHash: context.binding.contextHash,
      npcRef, speakerRef: context.intent.actorRef, speech: entry.actorSpeech, audience: String(entry.audience), newKnowledge, outcomes,
      ...(combat === undefined ? {} : { combat }) });
    return [{ frame: frame.path, proposal, hearing, hearingHash: canonicalHash(hearing) }];
  }));
}

const instruction = `你只扮演npcRef这一个人。hearing.speaker刚对你说了hearing.speech，你现在回答。
view是你本人知道的全部：entries里是你的身份、目标、行为边界和声口，你的记忆、关系、承诺和债务；present是你在场看得到的人和物。hearing.newKnowledge是你此刻已经知道的事。明确不知道的事仍不知道；资料未加载不等于留白。可以提出符合本人身份、围绕已有对象的生活习惯或往事候选，逐条填introducedContent的id、label、content、occurrence、attitude和source；source说明何时如何知道或为何这样声称。相同过去跨分支共用id且内容一致，不随情形改写。新人物、地点和物件尚不开放，不借候选补主线秘密或玩家经历。候选须经主持人审核才生效；没新增就填[]，不能漏报台词里的新增内容。自己的感受、态度和日常寒暄照常回答。听到对方的说法不等于这个说法是真的。你可以按自己的目标和顾虑如实回答、隐瞒、夸张、误信或说谎。
hearing.outcomes列出要分别写好的情形，每种写一份完整的回答，互不引用。swayed=yes表示这番话对你起了作用，你被说动、相信了或被镇住了；no表示没有起作用；notAsked表示这只是平常交谈。perceived是这种情形下你亲眼看到、亲耳听到对方做的事。
每种情形填kind、text、motive、basis和四张表。text只写你这一次说出口的话，先用日常口语写通顺，主语、指代与比较关系明确，不用生僻词营造声口；不写动作、神态和旁白；沉默用kind=silence、text=""。不替对方回答，不假定对方说过hearing.speech以外的话；需要对方先报姓名、说明来意或表态时，把问题问出来就结束这句话。motive写你为什么这样回答，包括打算瞒什么、信错了什么，对方听不到。basis选这次回答依据的本人记录和记忆，用其完整ref字符串；只凭刚听到的话回答时选"playerExpression"；依据hearing.newKnowledge里的事时选{worldFactRef:该事的handle}。
四张表都必须出现，没有就填[]：relationshipChanges记你对对方态度的变化，newPromises记你的新承诺，promiseChanges记你对自己已有承诺的变更，newDebts记新债务。你在text里答应将来做事或持续遵守约束时，newPromises必须有对应记录，完整登记原话、期限与terms；答应马上动身去别处（上楼、出门、去叫人）也要登记。正式称作承诺不是前提，按这句话在当时的实际意思判断。明确拒绝、尚未答应、预测或转述不记新承诺。口头答应不等于已经做了，text不说已经制作、递交或完成；只登记这次话语实际表达的义务和条件，不追加没谈到的费用。
newPromises的content写text里的许诺，promiseeRef选实际听到许诺的人，authorityRefs只填你自己。due是约定期限，与条件、计划及工期分开。terms内五个字段填全：kind=result/attempt/ongoing，subjectRefs绑定主体和对象；答应制作、复制或交付物品时填terms.delivery，未来物品尚未存在用itemRef=none，没有复制原件用sourceRef=none，仍填写数量和实际交付的人或地点；只有非物品义务才把整个delivery填none；terms.parts列需独立跟踪的额外部分，无则[]；terms.activation写真实生效条件，无则none。承诺依赖对方尚未给出的回答或尚未发生的事时，条件必须写进terms.activation，不能只写在condition里。答应采取行动时nextStep写你紧接着要做的事；没有执行动作的持续约束用none。
promiseChanges绑定原promiseRef和revision，只登记text里真实说出口的变更，这时disclose=true；心里改了主意而没有说出口不登记。
调用${NPC_REPLY_TOOL_NAME}一次。`;
const reask = `上一次回答没有通过校验，diagnostics列出了原因，path是上一次回答里的位置。按diagnostics修正，仍只依据同一份view和hearing，重新完整回答每一种情形。调用${NPC_REPLY_TOOL_NAME}一次。`;
const task = `按view和hearing回答，调用${NPC_REPLY_TOOL_NAME}一次。`;
const transport = Object.freeze({ tool_choice: "required" as const, parallel_tool_calls: false as const, max_completion_tokens: 3_000 });

export const NPC_REPLY_POLICY = deepFreeze({ version: "zhuwei.npc-reply/v3", instruction, reask, task, writing: CHINESE_WRITING_GUIDANCE,
  tool: NPC_REPLY_TOOL_NAME, hearing: NPC_REPLY_HEARING_SCHEMA, ticket: NPC_REPLY_TICKET_SCHEMA, view: "npc-own-model-view/v1",
  calls: { replies: 1, secondRequests: 1, unreadableSecondRequestResends: 1 }, transport,
  introductions: { maximumPerOutcome: 8, maximumTextCharacters: 2000, maximumLabelCharacters: 500, maximumPrivateOriginCharacters: 4000 },
  // The form every request derives its own from, pinned by one instance of it.
  form: createNpcReplySchema(["success", "failure"], "npc", { npcRef: "npc", refs: [], factRefs: [] }, { observationSubjectRefs: [], itemEntryRefs: [] }) });
/** Pins the prompt, the form's derivation and the transport. It is part of
 * the workflow, so a reply made under another version is asked again with
 * the ruling it answered (SPEC 0016 §9.2). */
export const NPC_REPLY_BINDING_HASH = canonicalHash(NPC_REPLY_POLICY);

/** A diagnostic of a reply, at its path in the reply's own arguments. */
export type NpcReplyDiagnostic = ProposalDiagnostic;
/** What a second request adds: the reply as it was saved and what was wrong
 * with it. */
export type NpcReplyRetry = Readonly<{ reply: string; diagnostics: readonly NpcReplyDiagnostic[] }>;
/** What Room saves with a reply's call. `resend` marks the one call that sends
 * a second request again, unchanged, because its reply could not be read
 * (SPEC 0016 §7.2, ADR 0077); it is not another second request. */
export type NpcReplyTicket = Readonly<{
  schema: typeof NPC_REPLY_TICKET_SCHEMA;
  hearing: NpcReplyHearing;
  hearingHash: string;
  attempt: 1 | 2;
  retry: NpcReplyRetry | null;
  resend?: true;
}>;

export function npcReplyTicket(hearing: NpcReplyHearing, retry?: NpcReplyRetry): NpcReplyTicket {
  return deepFreeze({ schema: NPC_REPLY_TICKET_SCHEMA, hearing, hearingHash: canonicalHash(hearing),
    attempt: retry === undefined ? 1 : 2, retry: retry ?? null }) as NpcReplyTicket;
}

export function isNpcReplyTicket(value: unknown): value is NpcReplyTicket {
  const keys = Object.keys(isPlainRecord(value) ? value : {}).sort().join(",");
  if (!isPlainRecord(value) || value.schema !== NPC_REPLY_TICKET_SCHEMA
    || (keys !== "attempt,hearing,hearingHash,retry,schema" && keys !== "attempt,hearing,hearingHash,resend,retry,schema")
    || !isPlainRecord(value.hearing) || value.hearing.schema !== NPC_REPLY_HEARING_SCHEMA || typeof value.hearing.npcRef !== "string"
    || typeof value.hearing.contextHash !== "string" || !isPlainRecord(value.hearing.outcomes) || !Array.isArray(value.hearing.newKnowledge)
    || value.hearingHash !== canonicalHash(value.hearing)) return false;
  if (Object.hasOwn(value, "resend") && (value.resend !== true || value.attempt !== 2)) return false;
  if (value.attempt === 1) return value.retry === null;
  return value.attempt === 2 && isPlainRecord(value.retry) && typeof value.retry.reply === "string" && Array.isArray(value.retry.diagnostics)
    && value.retry.diagnostics.length > 0 && value.retry.diagnostics.every(detail => isPlainRecord(detail) && typeof detail.constraint === "string");
}

/** The calls of one thing heard in the order they were made: the reply, its
 * second request, then that request sent again. */
const replyCallOrder = (ticket: NpcReplyTicket) => ticket.attempt * 2 + (ticket.resend === true ? 1 : 0);
export function latestReplyCall<T extends Readonly<{ ticket: NpcReplyTicket }>>(saved: readonly T[], hearingHash: string): T | undefined {
  return saved.filter(call => call.ticket.hearingHash === hearingHash).sort((left, right) => replyCallOrder(left.ticket) - replyCallOrder(right.ticket)).at(-1);
}

/** The request of one NPC's own reply. Its system message holds the rules,
 * the NPC's view and what it heard; a second request repeats those bytes and
 * adds its turn. */
export function npcReplyModelInput(context: VNextRequiredContext, hearing: NpcReplyHearing, retry?: NpcReplyRetry | null): Record<string, unknown> {
  const view = npcOwnModelView(context, hearing.npcRef);
  if (view === undefined || hearing.contextHash !== context.binding.contextHash) throw new TypeError("NPC_REPLY_CONTEXT_UNAVAILABLE");
  const parameters = createNpcReplySchema(npcReplyOutcomeNames(hearing), hearing.npcRef, { npcRef: hearing.npcRef, ...view.sources },
    { observationSubjectRefs: proposalObservationSubjectRefs(context), itemEntryRefs: proposalItemEntryRefs(context) },
    hearing.newKnowledge.map(fact => fact.handle), hearing.combat?.stances ?? []);
  const speaker = { ref: hearing.speakerRef, name: view.present.find(subject => subject.ref === hearing.speakerRef)?.name ?? hearing.speakerRef };
  const body = JSON.stringify({ npcRef: hearing.npcRef, view: { entries: view.entries, present: view.present },
    hearing: { speaker, speech: hearing.speech, audience: hearing.audience, newKnowledge: hearing.newKnowledge,
      outcomes: Object.fromEntries(npcReplyOutcomeNames(hearing).map(name => [name, hearing.outcomes[name]])),
      ...(hearing.combat === undefined ? {} : { inFightWithSpeaker: { fightingSpeaker: hearing.combat.fightingSpeaker } }) } });
  return { messages: [
    { role: "system", content: `${instruction}\n${CHINESE_WRITING_GUIDANCE}\n${body}` },
    { role: "user", content: task },
    ...(retry === undefined || retry === null ? [] : [
      { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: NPC_REPLY_TOOL_NAME, arguments: retry.reply } }] },
      { role: "tool", tool_call_id: "call_1", content: `${reask}\n${JSON.stringify({ diagnostics: retry.diagnostics.map(modelDiagnostic) })}` }]),
  ], tools: [{ type: "function", function: { name: NPC_REPLY_TOOL_NAME, strict: true,
    description: "你对刚听到的话的回答，hearing.outcomes列出的每种情形各一份。", parameters } }],
  ...transport };
}

/** What a request of a reply told its NPC: the view and what it heard, as
 * the system message carries them after the rules. Undefined for any other
 * request. Diagnostic tools and scripted models read a request by it. */
export function npcReplyRequestBody(request: unknown): Readonly<{ npcRef: string; view: RecordValue; hearing: RecordValue }> | undefined {
  if (!isPlainRecord(request) || !Array.isArray(request.tools) || !Array.isArray(request.messages)) return undefined;
  const tool = request.tools[0], system = request.messages[0];
  if (!isPlainRecord(tool) || !isPlainRecord(tool.function) || tool.function.name !== NPC_REPLY_TOOL_NAME
    || !isPlainRecord(system) || typeof system.content !== "string") return undefined;
  try {
    const body: unknown = JSON.parse(system.content.slice(system.content.lastIndexOf("\n") + 1));
    return isPlainRecord(body) && typeof body.npcRef === "string" && isPlainRecord(body.view) && isPlainRecord(body.hearing)
      ? { npcRef: body.npcRef, view: body.view, hearing: body.hearing } : undefined;
  } catch { return undefined; }
}

/** What the NPC is told of a diagnostic: where, what was expected and what
 * was found. The server's private provenance is not part of it. */
function modelDiagnostic(diagnostic: NpcReplyDiagnostic): RecordValue {
  const { authorityPath: _authority, pathBase: _base, repair: _repair, location: _location, ...detail } = diagnostic;
  return detail;
}

export type NpcReplyBranch = Readonly<{ response: RecordValue; consequences: readonly RecordValue[]; introducedContent: readonly NpcIntroduction[];
  /** ADR 0117: the stance this reply took in a fight with the speaker. */
  combatStance?: string }>;
export type NpcReply = Readonly<Partial<Record<NpcReplyOutcomeName, NpcReplyBranch>>>;
export type NpcReplyReading =
  | Readonly<{ kind: "read"; reply: NpcReply; arguments: string }>
  | Readonly<{ kind: "unreadable"; arguments: string; diagnostics: readonly NpcReplyDiagnostic[] }>;

const REASK = Object.freeze({ allowed: true, reason: "a-reply-may-be-asked-once-more" });

/** The arguments of a saved reply as the provider returned them. */
export function npcReplyArguments(response: unknown): string {
  try {
    const call = extractSingleToolCall(response);
    return typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? null);
  } catch { return ""; }
}

/** Reads a saved reply by the form it was asked with. Nothing is repaired: a
 * reply that is not the form is returned with what is wrong with it. */
export function readNpcReply(response: unknown, hearing: NpcReplyHearing): NpcReplyReading {
  const names = npcReplyOutcomeNames(hearing);
  const raw = npcReplyArguments(response);
  const unreadable = (diagnostics: readonly NpcReplyDiagnostic[]): NpcReplyReading => ({ kind: "unreadable", arguments: raw, diagnostics: deepFreeze([...diagnostics]) });
  const one = (code: ProposalDiagnostic["code"], constraint: string, path: ProposalDiagnosticPath, expected: unknown, actual: unknown) =>
    unreadable([proposalDiagnostic(code, constraint, { path, pathBase: "arguments", expected, actual: diagnosticActual(actual), repair: REASK })]);
  let value: unknown;
  try {
    const call = extractSingleToolCall(response);
    if (call.name !== NPC_REPLY_TOOL_NAME) return one("CONSTRAINT_CONFLICT", "npc-reply:tool-required", [], { tool: NPC_REPLY_TOOL_NAME }, call.name);
    value = typeof call.arguments === "string" ? parseJsonWithUniqueMembers(call.arguments) : call.arguments;
  } catch { return one("JSON_SYNTAX", "npc-reply:arguments-unreadable", [], { type: "object" }, raw); }
  if (!isPlainRecord(value)) return one("TYPE_MISMATCH", "npc-reply:object-required", [], { type: "object" }, value);
  const written = value;
  const extra = Object.keys(written).filter(key => !(names as string[]).includes(key)), missing = names.filter(name => !Object.hasOwn(written, name));
  if (extra.length > 0 || missing.length > 0) return unreadable([
    ...missing.map(name => proposalDiagnostic("FIELD_MISSING", "npc-reply:outcome-required", { path: [name], pathBase: "arguments", expected: { outcomes: names }, repair: REASK })),
    ...extra.map(name => proposalDiagnostic("VALUE_INVALID", "npc-reply:outcome-unknown", { path: [name], pathBase: "arguments", expected: { outcomes: names }, repair: REASK }))]);
  const reply: Partial<Record<NpcReplyOutcomeName, NpcReplyBranch>> = {}, problems: NpcReplyDiagnostic[] = [];
  for (const name of names) {
    try {
      const decoded = decodeNpcReplyWire(written[name], hearing.npcRef, [name], hearing.combat?.stances ?? []);
      const privateOrigin = npcReplyMotive(decoded.response.motive, decoded.introducedContent);
      if (decoded.introducedContent.length && typeof privateOrigin === "string" && privateOrigin.length > 4000) problems.push(proposalDiagnostic(
        "VALUE_INVALID", "npc-reply:private-origin-too-large", { path: [name, "introducedContent"], pathBase: "arguments",
          expected: { maximumCombinedOriginCharacters: 4000 }, actual: { combinedOriginCharacters: privateOrigin.length }, repair: REASK }));
      // SPEC 0006 §7: a fact the plan did not give this NPC is not its to cite.
      const given = new Set(hearing.newKnowledge.map(fact => fact.handle));
      (Array.isArray(decoded.response.basis) ? decoded.response.basis : []).forEach((source, index) => {
        if (isPlainRecord(source) && source.kind === "materializedKnowledge" && !given.has(String(source.definitionRef))) problems.push(proposalDiagnostic(
          "REFERENCE_UNAVAILABLE", "npc-reply:new-fact-not-given", { path: [name, "basis", index, "worldFactRef"], pathBase: "arguments",
            expected: { handles: [...given] }, actual: diagnosticActual(source.definitionRef), repair: REASK }));
      });
      reply[name] = { response: decoded.response, consequences: decoded.consequences, introducedContent: decoded.introducedContent,
        ...(decoded.combatStance === undefined ? {} : { combatStance: decoded.combatStance }) };
    } catch (error) {
      if (!(error instanceof ProposalFillingError)) throw error;
      problems.push(...error.diagnostics.map(diagnostic => ({ ...diagnostic, repair: REASK })));
    }
  }
  return problems.length > 0 ? unreadable(problems) : { kind: "read", reply: deepFreeze(reply), arguments: raw };
}

/** The plan with each listed step's reply in place: the reply replaces what
 * stood there, and what the NPC undertakes joins what the actor undertakes.
 * Steps not listed are left as they are. */
export function mergeNpcReplies<T>(bundle: T, replies: readonly Readonly<{ step: NpcReplyStep; reply: NpcReply }>[]): T {
  const merged = structuredClone(bundle) as unknown;
  for (const { step, reply } of replies) {
    const owner = step.frame.reduce<unknown>((value, key) => isPlainRecord(value) || Array.isArray(value) ? (value as Record<string | number, unknown>)[key] : undefined, merged);
    const entry = isPlainRecord(owner) && Array.isArray(owner.proposals) ? owner.proposals[step.proposal] : undefined;
    if (!isPlainRecord(entry) || entry.kind !== "social" || entry.npcRef !== step.hearing.npcRef || !isPlainRecord(entry.branches)) throw new TypeError("NPC_REPLY_STEP_UNAVAILABLE");
    for (const [branch, name] of outcomeNames(entry)) {
      const written = entry.branches[branch], answer = reply[name];
      if (!isPlainRecord(written) || answer === undefined || !Array.isArray(written.consequences)) throw new TypeError("NPC_REPLY_STEP_UNAVAILABLE");
      const response = structuredClone(answer.response);
      // The speaker's private origin retains its declared provenance even for
      // a false claim. The quoted words and listeners receive no private metadata.
      response.motive = npcReplyMotive(answer.response.motive, answer.introducedContent);
      written.response = response;
      written.consequences = mergeSocialConsequences(written.consequences.filter(row => socialConsequenceAuthor(row) === "actor"), structuredClone(answer.consequences));
      // ADR 0117: a stance that changes the fight joins the branch; lowering
      // makes it a step of its own after the conversation.
      if (isNpcCombatStance(answer.combatStance)) written.npcCombatStance = answer.combatStance;
      else delete written.npcCombatStance;
    }
    entry.consumes = derivedStepConsumes(entry);
  }
  return merged as T;
}

/** The plan as the ruling alone wrote it: every reply back to the
 * placeholder and what the NPCs undertook removed. */
export function withoutNpcReplies<T>(bundle: T): T {
  const ruling = structuredClone(bundle) as unknown;
  for (const frame of frames(ruling)) for (const entry of frame.proposals) {
    if (!isPlainRecord(entry) || entry.kind !== "social" || !isPlainRecord(entry.branches)) continue;
    for (const branch of ["success", "failure"] as const) {
      const written = entry.branches[branch];
      if (!isPlainRecord(written) || !Array.isArray(written.consequences)) continue;
      written.response = { kind: "silence", text: "", motive: NPC_REPLY_PENDING_MOTIVE, basis: [{ kind: "playerExpression" }] };
      written.consequences = written.consequences.filter(row => socialConsequenceAuthor(row) === "actor");
      delete written.npcCombatStance;
    }
    entry.consumes = derivedStepConsumes(entry);
  }
  return ruling as T;
}

/** Whether a plan still awaits a reply. */
export function awaitsNpcReply(bundle: unknown): boolean {
  return frames(bundle).some(frame => frame.proposals.some(entry => isPlainRecord(entry) && entry.kind === "social" && isPlainRecord(entry.branches)
    && Object.values(entry.branches).some(branch => isPlainRecord(branch) && npcReplyPending(branch.response))));
}

/** Splits the diagnostics of a merged plan by who has to answer them. One
 * that names a reply or a consequence its NPC wrote goes to that NPC, at the
 * reply's own path; every other one is the ruling's, at the ruling's own
 * draft path. */
export function npcReplyDiagnostics(merged: unknown, steps: readonly NpcReplyStep[], diagnostics: readonly ProposalDiagnostic[]):
  Readonly<{ replies: ReadonlyMap<string, readonly NpcReplyDiagnostic[]>; ruling: readonly ProposalDiagnostic[] }> {
  const replies = new Map<string, NpcReplyDiagnostic[]>(), ruling: ProposalDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const target = npcReplyDiagnosticTarget(merged, diagnostic);
    const step = target === undefined ? undefined : steps.find(candidate => candidate.proposal === target.proposal
      && sameCanonical(candidate.frame, target.frame));
    if (target === undefined || step === undefined) { ruling.push(rulingDiagnosticOfMerged(merged, diagnostic)); continue; }
    const name: NpcReplyOutcomeName = Object.hasOwn(step.hearing.outcomes, "result") ? "result" : target.branch;
    const { authorityPath: _authority, path: _path, pathBase: _base, ...detail } = diagnostic;
    replies.set(step.hearingHash, [...replies.get(step.hearingHash) ?? [], { ...detail, path: [name, ...target.path], pathBase: "arguments" }]);
  }
  return { replies, ruling };
}

/** A completed call of a reply: the ticket Room saved with it and what the
 * provider returned. */
export type NpcReplySaved = Readonly<{ ticket: NpcReplyTicket; response: unknown }>;

export type NpcReplySettlement =
  /** The next call to make. */
  | Readonly<{ kind: "ask"; ticket: NpcReplyTicket }>
  /** Every reply is in place. `ruling` lists what the ruling has to correct
   * before this plan can go on; empty when nothing is known against it. */
  | Readonly<{ kind: "merged"; bundle: VNextProposalBundle; bundleHash: string; ruling: readonly ProposalDiagnostic[] }>
  | Readonly<{ kind: "failed"; code: "NPC_REPLY_INVALID" | "PROPOSAL_REPAIR_EXHAUSTED" | "CONTEXT_INSUFFICIENT";
      issues: readonly string[]; diagnostics: readonly ProposalDiagnostic[] }>;

/** Decides, from the ruling's accepted plan and the replies saved so far,
 * what happens next. The adapter and Room both ask this one function, so a
 * call the adapter wants is exactly the call Room admits.
 *
 * `rejected` answers what is known against a merged plan beyond local
 * validation: the diagnostics lowering or Rules returned for it, or none. */
export function settleNpcReplies(input: Readonly<{
  bundle: VNextProposalBundle;
  context: VNextRequiredContext;
  saved: readonly NpcReplySaved[];
  rejected: (merged: VNextProposalBundle, mergedHash: string) => readonly ProposalDiagnostic[];
}>): NpcReplySettlement {
  const { bundle, context } = input;
  const failed = (code: Extract<NpcReplySettlement, { kind: "failed" }>["code"], diagnostics: readonly ProposalDiagnostic[]): NpcReplySettlement =>
    ({ kind: "failed", code, issues: diagnostics.map(detail => detail.constraint), diagnostics });
  const steps = npcReplySteps(bundle, context);
  // A plan without a conversation is the ruling's alone, as it was accepted.
  if (steps.length === 0) {
    const bundleHash = canonicalHash(bundle);
    return { kind: "merged", bundle, bundleHash, ruling: input.rejected(bundle, bundleHash) };
  }
  const latest = (hearingHash: string): NpcReplySaved | undefined => latestReplyCall(input.saved, hearingHash);
  /** The one second request a reply may get, or the end of this action. As
   * with the ruling's corrections, a diagnostic describes the reply that was
   * refused; being asked again is no proof that the next reply will pass. */
  const again = (step: NpcReplyStep, call: NpcReplySaved, diagnostics: readonly NpcReplyDiagnostic[]): NpcReplySettlement =>
    call.ticket.attempt === 1
      ? { kind: "ask", ticket: npcReplyTicket(step.hearing, { reply: npcReplyArguments(call.response),
        diagnostics: diagnostics.map(detail => ({ ...detail, repair: REASK })) }) }
      : failed("PROPOSAL_REPAIR_EXHAUSTED", diagnostics);
  const replies: { step: NpcReplyStep; reply: NpcReply }[] = [];
  for (const step of steps) {
    if (npcOwnModelView(context, step.hearing.npcRef) === undefined) return failed("CONTEXT_INSUFFICIENT", [proposalDiagnostic("REFERENCE_UNAVAILABLE",
      "social:npc-decision-context-unavailable", { path: [...step.frame, "proposals", step.proposal, "npcRef"], actual: diagnosticActual(step.hearing.npcRef) })]);
    const call = latest(step.hearingHash);
    if (call === undefined) return { kind: "ask", ticket: npcReplyTicket(step.hearing) };
    const reading = readNpcReply(call.response, step.hearing);
    if (reading.kind === "unreadable") {
      if (call.ticket.attempt === 1) return again(step, call, reading.diagnostics);
      // SPEC 0016 §7.2 (ADR 0077): a second reply that cannot be read into the
      // form is sent once more with the same request. The resend asks nothing
      // new, so it is no further second request; unreadable again, it ends.
      if (call.ticket.resend !== true) return { kind: "ask", ticket: deepFreeze({ ...call.ticket, resend: true as const }) };
      return failed("NPC_REPLY_INVALID", reading.diagnostics);
    }
    replies.push({ step, reply: reading.reply });
  }
  const merged = mergeNpcReplies(bundle, replies);
  const validated = validateVNextProposalBundle(merged);
  const answer = (diagnostics: readonly ProposalDiagnostic[]): NpcReplySettlement | undefined => {
    const split = npcReplyDiagnostics(merged, steps, diagnostics);
    const step = steps.find(candidate => split.replies.has(candidate.hearingHash));
    return step === undefined ? undefined : again(step, latest(step.hearingHash)!, split.replies.get(step.hearingHash)!);
  };
  if (validated.kind !== "accepted") {
    const diagnostics = validated.diagnostics ?? diagnosticsFromIssues(validated.code, validated.issues);
    // The ruling alone passed this validation, so what fails now came with a reply.
    return answer(diagnostics) ?? failed("NPC_REPLY_INVALID", diagnostics);
  }
  const bundleHash = canonicalHash(validated.bundle);
  const known = input.rejected(validated.bundle, bundleHash);
  if (known.length === 0) return { kind: "merged", bundle: validated.bundle, bundleHash, ruling: [] };
  const split = npcReplyDiagnostics(merged, steps, known);
  // What the ruling has to correct comes first: its correction may change
  // what the NPC hears, and a reply to something else is asked anew.
  if (split.ruling.length > 0) return { kind: "merged", bundle: validated.bundle, bundleHash, ruling: split.ruling };
  return answer(known) ?? failed("PROPOSAL_REPAIR_EXHAUSTED", known);
}

/** Whether every reply of a plan is the one its NPC's own call saved for
 * what that plan lets the NPC hear. Room asks this before a plan commits. */
export function npcRepliesAreSaved(bundle: unknown, context: VNextRequiredContext, saved: readonly NpcReplySaved[]): boolean {
  if (awaitsNpcReply(bundle)) return false;
  const steps = npcReplySteps(bundle, context);
  if (steps.length === 0) return true;
  try {
    const replies = steps.map(step => {
      const call = latestReplyCall(saved, step.hearingHash);
      const reading = call === undefined ? undefined : readNpcReply(call.response, step.hearing);
      if (reading?.kind !== "read") throw new TypeError("NPC_REPLY_UNAVAILABLE");
      return { step, reply: reading.reply };
    });
    return sameCanonical(mergeNpcReplies(withoutNpcReplies(bundle), replies), bundle);
  } catch { return false; }
}
