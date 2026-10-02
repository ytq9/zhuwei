import { extractSingleToolCall } from "../authoritative-helpers";
import { authoritativeKpProfileByModelId } from "../authoritative-policy";
import { canonicalHash, deepFreeze, isPlainRecord, parseJsonWithUniqueMembers, sameCanonical } from "./canonical-json";
import { npcOwnModelView, vnextProposalContextBody } from "./proposal-context";
import { proposalDiagnostic, type ProposalDiagnostic, type ProposalDiagnosticPath } from "./proposal-diagnostics";
import { derivedStepConsumes } from "./proposal-filling-interface";
import { latestReplyCall, npcReplyArguments, npcReplyDiagnostics, npcReplyOutcomeNames, npcReplySteps, npcReplyTicket, readNpcReply, settleNpcReplies,
  type NpcReplySaved, type NpcReplySettlement, type NpcReplyStep, type NpcReplyOutcomeName } from "./npc-reply";
import type { NpcIntroduction } from "./npc-introductions";
import { vnextProposalRequestMessages, type VNextProposalBundle } from "./proposal-schema";
import { validateVNextProposalBundle } from "./proposal-validator";
import type { VNextRequiredContext } from "./required-context";
import { VNEXT_SEMANTIC_TEMPLATES } from "../../rules/profiles/semantic-templates";

// SPEC 0006 §7, SPEC 0016 §§7.2–7.3: an author's review is not an NPC turn.
// Both Room and the adapter derive the next call from the saved evidence.
export const NPC_REPLY_REVIEW_TOOL = "review_npc_replies";
export const NPC_REVIEW_FIRST_ORDINAL = 139;
/** Two review stages for each of up to four ruling versions (the initial one
 * and three corrections), each stage sent at most twice (ADR 0077). */
export const NPC_REVIEW_LAST_ORDINAL = 154;
const TICKET_SCHEMA = "zhuwei.npc-reply-review-ticket/v1";
/** `resend` marks the one call that sends a stage's request again, unchanged,
 * because the review it returned could not be used (SPEC 0016 §7.2, ADR 0077).
 * It is not another stage. */
export type NpcReviewTicket = Readonly<{
  schema: typeof TICKET_SCHEMA; contextHash: string; rulingHash: string; attempt: 1 | 2;
  replies: readonly Readonly<{ hearingHash: string; responseHash: string }>[];
  resend?: true;
}>;
export type NpcReviewSaved = Readonly<{ ticket: NpcReviewTicket; response: unknown }>;
type Candidate = Readonly<{ hearingHash: string; outcome: NpcReplyOutcomeName; introduction: NpcIntroduction }>;
const FIELDS = ["text", "basis", "introducedContent", "relationshipChanges", "newPromises", "promiseChanges", "newDebts"] as const;
const REASONS = ["unsupportedKnowledge", "conflictingMemory", "undeclaredContent", "inconsistentConsequence", "notAuthorizedBlank", "branchConflict"] as const;
type Finding = Readonly<{ hearingHash: string; outcome: NpcReplyOutcomeName; field: typeof FIELDS[number];
  reason: typeof REASONS[number]; ownRefs: readonly string[] }>;
type Verdict = Readonly<{ hearingHash: string; outcome: NpcReplyOutcomeName; introductionId: string; explanation: string } & (
  { decision: "existing"; existingRef: string } | { decision: "approve" | "claim" | "revise"; existingRef: null }
)>;
type Review = Readonly<{ status: "pass" | "revise"; findings: readonly Finding[]; verdicts: readonly Verdict[]; privateReason: string }>;
const hash = (v: unknown): v is string => typeof v === "string" && /^sha256:[a-f0-9]{64}$/u.test(v);
const nonempty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 4000;
const exact = (v: unknown, keys: readonly string[]): v is Record<string, unknown> => isPlainRecord(v)
  && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
export function isNpcReviewTicket(v: unknown): v is NpcReviewTicket {
  const keys = ["schema", "contextHash", "rulingHash", "attempt", "replies"];
  return (exact(v, keys) || exact(v, [...keys, "resend"]) && v.resend === true) && v.schema === TICKET_SCHEMA
    && hash(v.contextHash) && hash(v.rulingHash) && (v.attempt === 1 || v.attempt === 2)
    && Array.isArray(v.replies) && v.replies.length > 0 && v.replies.length <= 64
    && v.replies.every(row => exact(row, ["hearingHash", "responseHash"]) && hash(row.hearingHash) && hash(row.responseHash))
    && new Set(v.replies.map(row => row.hearingHash)).size === v.replies.length;
}
const instruction = `你是主持人一侧的NPC交谈审核者，不扮演NPC，也不代写台词。只调用review_npc_replies一次。
检查每份回答的全部台词、本人承诺和其他后果，即使introducedContent为空也检查漏报、越权知识、身份指代、与本人过去说法矛盾、成败分支编出不同往事。所见材料是冻结切片，不是世界全部历史；未加载、技术缺失、明确未知、已知不存在与授权留白不同。requiredContext里的主持人真相绝不授权NPC知道。
phaseA只允许围绕已有对象的普通习惯/往事和有来源的说法，不创作新人物、地点、物件、主线答案或玩家经历。没有同义旧记录不妨碍合法留白，但必须符合锚点、身份、既有事实，说明本人如何知道。NPC可以隐瞒、误信、夸张或说谎；这些必须有成立的来源、时间和动机，不能事后替矛盾编谎言理由。
每条candidate精确给一个verdict，decision只能取它的allowedDecisions：approve将该候选原文、发生时间和本人的取得依据固化，须有授权留白；claim只保留说法和来源、不改变命题真假；existing复用本人的existingRef记录且不新增事实；revise退回。仅existing填写引用，其余existingRef填none。candidates为空时verdicts必须=[]；台词问题只写findings，不虚构候选id（包括none）。各分支的共同过去必须一致，差别只在披露和态度，不能用骰子选真相。不可修改候选原文；需要修改就退回。
每个问题填findings，精确选择hearingHash、outcome和field；reason只能选给定类别，ownRefs只能选这份reply.view.sources里的本人已读引用，可为空。privateReason写完整主持人理由但不会传给NPC。没有问题才status=pass且findings=[]；任一退回用revise并定位对应回答，不得把模型格式错误伪装为世界内拒绝。`;
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const str = { type: "string" };
const en = (values: readonly string[]) => ({ type: "string", enum: [...values] });
const reviewSchema = (outcomes: readonly NpcReplyOutcomeName[]) => obj({ privateReason: str,
  findings: { type: "array", items: obj({ hearingHash: str, outcome: en(outcomes), field: en(FIELDS), reason: en(REASONS), ownRefs: { type: "array", items: str } }) },
  verdicts: { type: "array", items: obj({ hearingHash: str, outcome: en(outcomes), introductionId: str, explanation: str,
    decision: en(["approve", "claim", "existing", "revise"]), existingRef: str }) }, status: en(["pass", "revise"]) });
// SPEC 0016 §7.2 (ADR 0081): on DeepSeek the review reasons before it
// reports, as the narration review does (ADR 0069). Without reasoning it once
// approved and once sent back the same replies, and passed success branches
// that still refused after the words had worked. Reasoning mode refuses a
// forced tool call, so the tool is offered; a reply without the one call
// cannot be read and is sent once more (ADR 0077). The limit covers reasoning
// and the review together. Other providers keep the forced call.
const REVIEW_TRANSPORT = deepFreeze({
  reasoning: { tool_choice: "auto", thinking: { type: "enabled" }, reasoning_effort: "low", max_completion_tokens: 16_384 },
  direct: { tool_choice: "required", max_completion_tokens: 4000 },
});
/** A reasoning review took up to 34 s in the 2026-10-02 probe; other calls
 * keep the adapter's 45 s. */
export const NPC_REVIEW_CALL_TIMEOUT_MS = 120_000;
export const NPC_REPLY_REVIEW_POLICY = deepFreeze({ version: "zhuwei.npc-reply-review/v8", instruction, schema: reviewSchema(["result", "success", "failure"]),
  // Where each part is sent; npcReviewModelInput builds it (ADR 0078).
  requestLayout: "system-message-is-the-filling-calls-context-guide-and-frozen-context-then-review-rules-tool-follows-reviewed-replies-last/v1",
  schemaBinding: "outcomes-present-in-the-saved-hearings-v1",
  candidateDecisions: "approve-only-for-believed-v1",
  transport: { deepseek: REVIEW_TRANSPORT.reasoning, other: REVIEW_TRANSPORT.direct }, callTimeoutMs: NPC_REVIEW_CALL_TIMEOUT_MS,
  stages: 2, unusableReviewResends: 1, tool: NPC_REPLY_REVIEW_TOOL, authoring: "existing-subject-experience-v1" });
export const NPC_REPLY_REVIEW_BINDING_HASH = canonicalHash(NPC_REPLY_REVIEW_POLICY);

function reviewReplies(bundle: VNextProposalBundle, context: VNextRequiredContext, saved: readonly NpcReplySaved[], ticket?: NpcReviewTicket) {
  const unique = [...new Map(npcReplySteps(bundle, context).map(step => [step.hearingHash, step])).values()];
  return unique.map(step => {
    const responseHash = ticket?.replies.find(row => row.hearingHash === step.hearingHash)?.responseHash;
    const call = responseHash === undefined ? latestReplyCall(saved, step.hearingHash)
      : saved.find(row => row.ticket.hearingHash === step.hearingHash && canonicalHash(row.response) === responseHash);
    const view = npcOwnModelView(context, step.hearing.npcRef);
    const reading = call && readNpcReply(call.response, step.hearing);
    if (!call || !view || reading?.kind !== "read") throw new TypeError("NPC_REVIEW_CONTEXT_UNAVAILABLE");
    return { step, call, view, reply: reading.reply, arguments: reading.arguments };
  });
}
function candidatesOf(rows: ReturnType<typeof reviewReplies>): Candidate[] {
  return rows.flatMap(row => npcReplyOutcomeNames(row.step.hearing).flatMap(outcome =>
    row.reply[outcome]!.introducedContent.map(introduction => ({ hearingHash: row.step.hearingHash, outcome, introduction }))));
}
/** Only what the NPC holds as true can become a fact of the world; what it
 * heard, doubts or invents stays its claim (SPEC 0006 §7). */
const allowedDecisions = (candidate: Candidate): readonly Verdict["decision"][] =>
  candidate.introduction.attitude === "believed" ? ["approve", "claim", "existing", "revise"] : ["claim", "existing", "revise"];
/** The bystander views and memory bodies the ruling's filling call was sent:
 * those its selection named, or its one amendment. */
export type NpcReviewContextView = Readonly<{ npcRefs: readonly string[]; knowledgeRefs: readonly string[] }>;
export function npcReviewModelInput(bundle: VNextProposalBundle, context: VNextRequiredContext, saved: readonly NpcReplySaved[], ticket: NpcReviewTicket,
  view: NpcReviewContextView, model: string) {
  const rows = reviewReplies(bundle, context, saved, ticket);
  // SPEC 0016 §7.3: a review may name only a branch the NPC actually wrote.
  // Mixed groups keep the union; readReview still validates each hearing pair.
  const schema = reviewSchema([...new Set(rows.flatMap(row => npcReplyOutcomeNames(row.step.hearing)))]);
  // ADR 0077: a resend is the stage's own request again, byte for byte, so
  // the ticket it shows the reviewer is the stage's, without the resend mark.
  const { resend: _resend, ...stage } = ticket;
  const body = { phase: "A", ruling: bundle,
    replies: rows.map(row => ({ hearingHash: row.step.hearingHash, hearing: row.step.hearing, view: row.view, arguments: JSON.parse(row.arguments) })),
    candidates: candidatesOf(rows).map(candidate => ({ ...candidate, allowedDecisions: allowedDecisions(candidate) })), ticket: stage };
  // SPEC 0016 §7.2 (ADR 0078): the review reads the frozen host material the
  // ruling read, sent as the filling call sent it. The system message opens
  // with the same reading guide and context bytes as that call's, so a
  // provider prefix cache can serve the context again; the review rules
  // follow it, and what this stage reviews comes last. DeepSeek caches
  // reasoning requests apart from the others, so there only an action's later
  // reviews reuse its first (ADR 0081).
  const { thinking, reasoning_effort, tool_choice, max_completion_tokens } = authoritativeKpProfileByModelId(model)?.provider === "deepseek"
    ? { ...REVIEW_TRANSPORT.reasoning } : { thinking: undefined, reasoning_effort: undefined, ...REVIEW_TRANSPORT.direct };
  return { messages: vnextProposalRequestMessages(vnextProposalContextBody(context, view.npcRefs, view.knowledgeRefs), instruction, JSON.stringify(body)),
    tools: [{ type: "function", function: { name: NPC_REPLY_REVIEW_TOOL, strict: true, description: "Review all saved NPC replies and every introduced candidate.", parameters: schema } }],
    tool_choice, parallel_tool_calls: false,
    ...(thinking === undefined ? {} : { thinking: { ...thinking }, reasoning_effort }), max_completion_tokens };
}
const key = (row: { hearingHash: string; outcome: string; introductionId: string }) => `${row.hearingHash}:${row.outcome}:${row.introductionId}`;
/** A saved review as the protocol reads it, or undefined when it cannot be
 * used: not the one tool call, not the form, or not about the replies and
 * candidates it was sent. Nothing in it is repaired. */
function readReview(response: unknown, rows: ReturnType<typeof reviewReplies>): Review | undefined {
  try { return readReviewOrThrow(response, rows); } catch { return undefined; }
}
function readReviewOrThrow(response: unknown, rows: ReturnType<typeof reviewReplies>): Review {
  const fail = (): never => { throw new TypeError("NPC_REVIEW_INVALID"); };
  const tool = extractSingleToolCall(response);
  if (tool.name !== NPC_REPLY_REVIEW_TOOL) return fail();
  const value: unknown = typeof tool.arguments === "string" ? parseJsonWithUniqueMembers(tool.arguments) : tool.arguments;
  if (!exact(value, ["status", "privateReason", "findings", "verdicts"]) || !["pass", "revise"].includes(String(value.status))
    || !nonempty(value.privateReason) || !Array.isArray(value.findings) || !Array.isArray(value.verdicts)
    || value.findings.length > 64 || value.verdicts.length > 512) return fail();
  const lookup = (item: Record<string, unknown>) => rows.find(row => row.step.hearingHash === item.hearingHash
    && npcReplyOutcomeNames(row.step.hearing).includes(item.outcome as NpcReplyOutcomeName));
  for (const item of value.findings) {
    if (!exact(item, ["hearingHash", "outcome", "field", "reason", "ownRefs"])) return fail();
    const row = lookup(item);
    if (!row || !(FIELDS as readonly unknown[]).includes(item.field) || !(REASONS as readonly unknown[]).includes(item.reason)
      || !Array.isArray(item.ownRefs) || item.ownRefs.length > 16 || new Set(item.ownRefs).size !== item.ownRefs.length
      || item.ownRefs.some(ref => typeof ref !== "string" || !row.view.sources.refs.includes(ref))) return fail();
  }
  const candidates = candidatesOf(rows);
  if (value.verdicts.length !== candidates.length) return fail();
  const seen = new Set<string>();
  const verdicts: Verdict[] = [];
  for (const item of value.verdicts) {
    if (!exact(item, ["hearingHash", "outcome", "introductionId", "decision", "existingRef", "explanation"])) return fail();
    const row = lookup(item), candidate = candidates.find(c => c.hearingHash === item.hearingHash && c.outcome === item.outcome && c.introduction.id === item.introductionId);
    // DeepSeek's wire schema uses the same none sentinel as the proposal
    // forms. Decode it to domain null; a native null means the same absence.
    // Never mutate the saved response whose hash binds the review ticket.
    const existingRef = item.existingRef === "none" ? null : item.existingRef;
    if (!row || !candidate || !allowedDecisions(candidate).includes(item.decision as Verdict["decision"]) || !nonempty(item.explanation)
      || (item.decision === "existing" ? typeof existingRef !== "string" || !row.view.sources.refs.includes(existingRef) : existingRef !== null)) return fail();
    const id = key(item as unknown as Verdict);
    if (seen.has(id)) return fail(); seen.add(id);
    if (item.decision === "revise" && !value.findings.some(f => isPlainRecord(f) && f.hearingHash === item.hearingHash && f.outcome === item.outcome)) return fail();
    verdicts.push({ ...item, existingRef } as Verdict);
  }
  if (value.status === "pass" ? value.findings.length !== 0 || value.verdicts.some(v => v.decision === "revise") : value.findings.length === 0) return fail();
  return { status: value.status as Review["status"], privateReason: value.privateReason as string,
    findings: value.findings as Finding[], verdicts };
}

// Only enums and exact NPC-owned records cross the review -> NPC boundary.
// The reviewer's free prose, expected world truth and other holders do not.
function findingDiagnostic(finding: Finding, row: ReturnType<typeof reviewReplies>[number]): ProposalDiagnostic {
  const originals: unknown = JSON.parse(row.arguments);
  const candidate = isPlainRecord(originals) ? originals[finding.outcome] : undefined;
  const branch = isPlainRecord(candidate) ? candidate : undefined;
  return proposalDiagnostic("CONSTRAINT_CONFLICT", `npc-review:${finding.reason}`, {
    path: [finding.outcome, finding.field], pathBase: "arguments",
    actual: branch?.[finding.field], expected: { reason: finding.reason, ownRecords: finding.ownRefs.map(ref => ({ ref,
      record: row.view.entries.find(entry => entry.entryRef === ref)?.value ?? row.view.entries.flatMap(entry =>
        isPlainRecord(entry.value) && Array.isArray(entry.value.records) ? entry.value.records : []).find(record => isPlainRecord(record) && record.ref === ref) })) },
    repair: { allowed: true, reason: "one-npc-reply-reask" } });
}

type IntroducedFactSource = Readonly<{ path: ProposalDiagnosticPath; hearingHash: string; outcome: NpcReplyOutcomeName; index: number }>;
type ReviewedPlan = Readonly<{ bundle: VNextProposalBundle; sources: readonly IntroducedFactSource[]; generatedPaths: readonly ProposalDiagnosticPath[] }>;
function addReviewedFacts(bundle: VNextProposalBundle, rows: ReturnType<typeof reviewReplies>, review: Review, steps: readonly NpcReplyStep[]): ReviewedPlan {
  const merged = structuredClone(bundle);
  const histories = new Map<string, NpcIntroduction>();
  const sources: IntroducedFactSource[] = [], generatedPaths: ProposalDiagnosticPath[] = [];
  const generatedFacts = new Map<string, number>();
  for (const verdict of review.verdicts) {
    if (verdict.decision !== "approve" && verdict.decision !== "existing") continue;
    const row = rows.find(r => r.step.hearingHash === verdict.hearingHash)!;
    const introduction = row.reply[verdict.outcome]!.introducedContent.find(c => c.id === verdict.introductionId)!;
    const npcRef = row.step.hearing.npcRef;
    const identity = `${npcRef}:${introduction.id}`;
    if (verdict.decision === "approve") {
      const previous = histories.get(identity);
      if (previous && !sameCanonical(previous, introduction)) throw new TypeError("NPC_REVIEW_BRANCH_CONFLICT");
      histories.set(identity, introduction);
    }
    // A hearing may be shared by multiple clarification continuations.
    for (const step of steps.filter(step => step.hearingHash === row.step.hearingHash)) {
      const frame = step.frame.reduce<unknown>((v, k) => isPlainRecord(v) || Array.isArray(v) ? (v as Record<string | number, unknown>)[k] : undefined, merged);
      if (!isPlainRecord(frame) || !Array.isArray(frame.proposals)) throw new TypeError("NPC_REVIEW_FRAME_INVALID");
      const social = frame.proposals[step.proposal];
      if (!isPlainRecord(social) || !isPlainRecord(social.branches)) throw new TypeError("NPC_REVIEW_FRAME_INVALID");
      const branch = social.branches[verdict.outcome === "result" ? "success" : verdict.outcome];
      if (!isPlainRecord(branch) || !isPlainRecord(branch.response) || !Array.isArray(branch.response.basis)) throw new TypeError("NPC_REVIEW_BRANCH_INVALID");
      const socialPath = [...step.frame, "proposals", step.proposal];
      const responseBasis = branch.response.basis;
      const addBasis = (source: unknown) => {
        const basis = responseBasis;
        if (!basis.some(value => sameCanonical(value, source))) {
          generatedPaths.push([...socialPath, "branches", verdict.outcome === "result" ? "success" : verdict.outcome, "response", "basis", basis.length]);
          basis.push(source);
        }
      };
      if (verdict.decision === "existing") {
        addBasis({ kind: "npcContext", ref: verdict.existingRef });
      }
      else {
        const handle = `prospective:npc-history-${canonicalHash({ npcRef, introduction }).slice(7, 31)}`;
        const template = VNEXT_SEMANTIC_TEMPLATES.worldFact;
        const producedKey = `${canonicalHash(step.frame)}:${handle}`;
        let ordinal = frame.proposals.findIndex(p => isPlainRecord(p) && Array.isArray(p.produces) && p.produces.some(v => isPlainRecord(v) && v.handle === handle));
        if (ordinal >= 0 && generatedFacts.get(producedKey) !== ordinal) throw new TypeError("NPC_REVIEW_PRODUCER_CONFLICT");
        if (ordinal < 0) {
          ordinal = frame.proposals.length;
          generatedFacts.set(producedKey, ordinal);
          frame.proposals.push({ kind: "materializeObject", semanticKind: "worldFact", basisRefs: [npcRef], consumes: [], outcomeBinding: "always",
            produces: [{ handle, kind: "semanticDefinition", outcomeBinding: "always" }], templateRef: template.templateRef, templateHash: template.templateHash,
            visibilityPolicyRef: "visibility:hidden-until-evidence", summary: introduction.label,
            definition: { sceneRef: null, visibilityFactId: null, label: introduction.label, description: introduction.content, observableState: null,
              affordances: null, mechanicDefinitionRefs: [], worldFact: { historyCoverage: null, subjectRefs: [npcRef], occurrence: introduction.occurrence,
                consistency: { judgment: "compatible", explanation: verdict.explanation }, initialKnowledge: [{ holderRef: npcRef,
                  acquisitionBasisRefs: [npcRef], acquisitionExplanation: introduction.source }] } } });
        }
        sources.push({ path: [...step.frame, "proposals", ordinal], hearingHash: verdict.hearingHash, outcome: verdict.outcome,
          index: row.reply[verdict.outcome]!.introducedContent.findIndex(c => c.id === verdict.introductionId) });
        addBasis({ kind: "materializedKnowledge", definitionRef: handle, holderRef: npcRef });
      }
      const priorConsumes = Array.isArray(social.consumes) ? social.consumes : [];
      social.consumes = derivedStepConsumes(social);
      (social.consumes as unknown[]).forEach((value, index) => {
        if (!priorConsumes.some(prior => sameCanonical(prior, value))) generatedPaths.push([...socialPath, "consumes", index]);
      });
    }
  }
  return { bundle: merged, sources, generatedPaths };
}

/** The generated fact never belonged to the ruling. Only an exact authored
 * field may go back to its NPC; server scaffolding fails technically. No Rules
 * prose, hidden expected values or review rationale enters the reply request. */
function introducedFactDiagnostics(plan: ReviewedPlan, diagnostics: readonly ProposalDiagnostic[]) {
  const replies = new Map<string, ProposalDiagnostic[]>(), other: ProposalDiagnostic[] = [];
  const prefix = (path: ProposalDiagnosticPath, start: ProposalDiagnosticPath) => start.every((part, index) => part === path[index]);
  const fields: Readonly<Record<string, keyof NpcIntroduction>> = {
    "summary": "label", "definition.label": "label", "definition.description": "content", "definition.worldFact.occurrence": "occurrence",
    "definition.worldFact.initialKnowledge.0.acquisitionExplanation": "source",
  };
  for (const diagnostic of diagnostics) {
    const path = diagnostic.path;
    if (!path || diagnostic.pathBase === "arguments" || diagnostic.pathBase === "rulesInput") {
      // Without a mapped owner, a composite-plan error cannot safely buy a
      // ruling correction for something that the server may have generated.
      if (plan.sources.length || plan.generatedPaths.length) throw new TypeError("npc-review:generated-structure-invalid");
      other.push(diagnostic); continue;
    }
    const sources = plan.sources.filter(source => prefix(path, source.path));
    if (sources.length) {
      for (const source of sources) {
        const name = path.slice(source.path.length).join(".");
        if (!Object.hasOwn(fields, name)) throw new TypeError("npc-review:generated-structure-invalid");
        const field = fields[name];
        replies.set(source.hearingHash, [...replies.get(source.hearingHash) ?? [], proposalDiagnostic("VALUE_INVALID", "npc-introduction:field-not-admissible", {
          path: [source.outcome, "introducedContent", source.index, field], pathBase: "arguments",
          expected: { requirement: "revise this declared field within your own knowledge and the permitted experience scope" },
          repair: { allowed: true, reason: "one-npc-reply-reask" },
        })]);
      }
    } else if (plan.generatedPaths.some(generated => prefix(path, generated) || prefix(generated, path))
      || plan.sources.some(source => prefix(source.path, path))) throw new TypeError("npc-review:generated-structure-invalid");
    else other.push(diagnostic);
  }
  return { replies, other };
}

export type NpcConversationSettlement = NpcReplySettlement | Readonly<{ kind: "review"; ticket: NpcReviewTicket }>;
export function settleNpcConversation(input: Readonly<{
  bundle: VNextProposalBundle; context: VNextRequiredContext; saved: readonly NpcReplySaved[]; reviews: readonly NpcReviewSaved[];
  rejected: (bundle: VNextProposalBundle, hash: string) => readonly ProposalDiagnostic[];
}>): NpcConversationSettlement {
  const fail = (reason: string): NpcConversationSettlement => ({ kind: "failed", code: "NPC_REPLY_INVALID", issues: [reason],
    diagnostics: [proposalDiagnostic("CONSTRAINT_CONFLICT", reason, { repair: { allowed: false, reason: "review-failed" } })] });
  // Ordinary actions keep their existing Rules rejection/correction path.
  if (npcReplySteps(input.bundle, input.context).length === 0) return settleNpcReplies(input);
  // Review may supply legitimate knowledge producers. Preflighting a reply
  // without those producers would judge a different plan. Local shape and
  // ownership checks still precede review; Rules sees the complete plan below.
  const settled = settleNpcReplies({ ...input, rejected: () => [] });
  if (settled.kind !== "merged" || settled.ruling.length) return settled;
  try {
    const rows = reviewReplies(input.bundle, input.context, input.saved);
    const rulingHash = canonicalHash(input.bundle);
    const reviews = input.reviews.filter(r => r.ticket.rulingHash === rulingHash);
    // A resend repeats a stage; only stages count toward the two a ruling has.
    const stages = reviews.filter(r => r.ticket.resend !== true).length;
    const replies = rows.map(row => ({ hearingHash: row.step.hearingHash, responseHash: canonicalHash(row.call.response) }));
    const last = reviews.at(-1);
    let review: Review | undefined;
    if (last) {
      if (last.ticket.contextHash !== input.context.binding.contextHash) return fail("npc-review:context-changed");
      const originals = reviewReplies(input.bundle, input.context, input.saved, last.ticket);
      review = readReview(last.response, originals);
      // SPEC 0016 §7.2 (ADR 0077): a review that cannot be used is sent once
      // more with the same request; the resend is no new stage.
      if (review === undefined) return last.ticket.resend === true ? fail("npc-review:unusable-after-resend")
        : { kind: "review", ticket: deepFreeze({ ...last.ticket, resend: true as const }) };
      for (const finding of review.findings) {
        const original = originals.find(row => row.step.hearingHash === finding.hearingHash)!;
        const current = rows.find(row => row.step.hearingHash === finding.hearingHash)!;
        if (canonicalHash(original.call.response) !== canonicalHash(current.call.response)) continue;
        if (current.call.ticket.attempt !== 1) return fail("npc-review:reask-exhausted");
        return { kind: "ask", ticket: npcReplyTicket(current.step.hearing, { reply: current.arguments,
          diagnostics: review.findings.filter(f => f.hearingHash === finding.hearingHash).map(f => findingDiagnostic(f, original)) }) };
      }
    }
    if (!last || !sameCanonical(last.ticket.replies, replies)) {
      if (stages >= 2) return fail("npc-review:review-exhausted");
      return { kind: "review", ticket: deepFreeze({ schema: TICKET_SCHEMA, contextHash: input.context.binding.contextHash, rulingHash,
        attempt: stages === 0 ? 1 : 2, replies }) };
    }
    if (!review || review.status !== "pass") return fail("npc-review:not-approved");
    const plan = addReviewedFacts(settled.bundle, rows, review, npcReplySteps(input.bundle, input.context));
    const validated = validateVNextProposalBundle(plan.bundle);
    if (validated.kind !== "accepted") return fail("npc-review:admission-invalid");
    const bundleHash = canonicalHash(validated.bundle), diagnostics = input.rejected(validated.bundle, bundleHash);
    const introduced = introducedFactDiagnostics(plan, diagnostics);
    const split = npcReplyDiagnostics(validated.bundle, npcReplySteps(input.bundle, input.context), introduced.other);
    if (split.ruling.length) return { kind: "merged", bundle: validated.bundle, bundleHash, ruling: split.ruling };
    const replyDiagnostics = new Map(split.replies);
    for (const [hearingHash, details] of introduced.replies) replyDiagnostics.set(hearingHash, [...replyDiagnostics.get(hearingHash) ?? [], ...details]);
    for (const [hearingHash, details] of replyDiagnostics) {
      const row = rows.find(r => r.step.hearingHash === hearingHash)!;
      if (row.call.ticket.attempt !== 1) return fail("npc-review:reask-exhausted");
      return { kind: "ask", ticket: npcReplyTicket(row.step.hearing, { reply: npcReplyArguments(row.call.response), diagnostics: details }) };
    }
    return { kind: "merged", bundle: validated.bundle, bundleHash, ruling: [] };
  } catch (error) { return fail(error instanceof Error ? error.message : "npc-review:invalid"); }
}
