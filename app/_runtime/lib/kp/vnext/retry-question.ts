import { compareCodeUnits, deepFreeze, isPlainRecord } from "./canonical-json";
import { proposalConversationRecords } from "./proposal-context";
import { VNEXT_RETRY_QUESTION_GUIDANCE } from "./proposal-guidance";
import type { VNextRequiredContext } from "./required-context";
import { frozenRetryHistory, madeByAnsweredAction } from "./retry-history";
import { isVNextRulingPrecedent, type VNextRulingPrecedent } from "../../rules/shapes";

// SPEC 0001 §19, SPEC 0016 §7.2 (ADR 0081, ADR 0083): when the player presses
// again for a goal a conversation, a check or a refusal already denied,
// without saying what changed, the KP may ask once. The question waits on the
// same prepared action; the player's answer, or a decline, continues that
// action on its frozen context.

export const RETRY_QUESTION_TOOL_NAME = "ask_player_what_changed";
export const RETRY_QUESTION_MAX_CHARACTERS = 300;
export const RETRY_ANSWER_MAX_CHARACTERS = 1200;
/** What the transcript shows for a decline; the table's button says the same. */
export const RETRY_DECLINE_TEXT = "就这样，不补充。";
const PENDING_PREFIX = "retry-question:";

/** A ruling of the acting character the question may name: a failed
 * conversation (`ref` is its thread, `npcRef` its NPC), or a failed check or a
 * refusal recorded as a precedent (`ref` is the precedent, `npcRef` null). */
export type VNextRetryTarget = Readonly<{ ref: string; npcRef: string | null }>;
/** The player's reply; `text: null` is a decline. */
export type VNextRetryAnswer = Readonly<{ submissionId: string; text: string | null }>;
/** The question saved with its prepared action, then the answer once given. */
export type VNextRetryQuestion = Readonly<{
  pendingInputId: string; ref: string; npcRef: string | null; question: string;
  answer?: VNextRetryAnswer;
}>;

/** The pending input that stands for the question of one intent submission. */
export function retryQuestionPendingInputId(submissionId: string): string {
  return `${PENDING_PREFIX}${submissionId}`;
}
/** The intent submission a question's pending input belongs to. */
export function retryQuestionSubmissionId(pendingInputId: unknown): string | undefined {
  return typeof pendingInputId === "string" && pendingInputId.startsWith(PENDING_PREFIX)
    && pendingInputId.length > PENDING_PREFIX.length ? pendingInputId.slice(PENDING_PREFIX.length) : undefined;
}

/** The ruling precedents a context froze, as Rules recorded them. */
export function proposalRulingPrecedents(context: VNextRequiredContext): readonly VNextRulingPrecedent[] {
  if (!Array.isArray(context.entries)) return [];
  return context.entries.flatMap(entry => entry.kind === "known" && isVNextRulingPrecedent(entry.value) ? [entry.value] : []);
}

/** The rulings of the acting character the question may name. A conversation
 * is open while it failed and no later conversation addresses it; of checks
 * and refusals only the actor's latest one here is, if it failed or refused.
 * A ruling already asked about, or made by the action that answered a
 * question, is never open again, so each ruling is questioned at most once
 * and the ruling on the answer is final. Adapter and Room both read it here. */
export function vnextRetryQuestionTargets(context: VNextRequiredContext): readonly VNextRetryTarget[] {
  const actor = context.intent?.actorRef;
  if (typeof actor !== "string") return [];
  const history = frozenRetryHistory(Array.isArray(context.entries) ? context.entries : [], actor);
  const closed = (ref: string, root: unknown) => history.askedRefs.includes(ref) || madeByAnsweredAction(root, history);
  const conversations = proposalConversationRecords(context);
  const addressed = new Set(conversations.flatMap(value => typeof value.addressedThreadRef === "string" ? [value.addressedThreadRef] : []));
  const open = new Map<string, VNextRetryTarget>();
  for (const value of conversations) {
    if (value.actorCharacterId !== actor || value.outcome !== "failure" || typeof value.threadRef !== "string"
      || typeof value.npcCharacterId !== "string" || addressed.has(value.threadRef) || closed(value.threadRef, value.rootActionId)) continue;
    open.set(value.threadRef, { ref: value.threadRef, npcRef: value.npcCharacterId });
  }
  const latest = proposalRulingPrecedents(context).filter(record => record.actorCharacterId === actor)
    .sort((left, right) => BigInt(right.recordedEventSeq) > BigInt(left.recordedEventSeq) ? 1 : -1)[0];
  if (latest !== undefined && (latest.ruling.kind === "refusal" || latest.ruling.outcome === "failure")
    && !closed(latest.precedentId, latest.rootActionId)) open.set(latest.precedentId, { ref: latest.precedentId, npcRef: null });
  return deepFreeze([...open.values()].sort((a, b) => compareCodeUnits(a.ref, b.ref)));
}

/** The second tool of a selection while a failure is open to question. */
export function retryQuestionTool(targets: readonly VNextRetryTarget[]) {
  return deepFreeze({
    type: "function" as const,
    function: {
      name: RETRY_QUESTION_TOOL_NAME, strict: true as const, description: VNEXT_RETRY_QUESTION_GUIDANCE.tool,
      parameters: {
        type: "object", additionalProperties: false,
        properties: {
          ref: { type: "string", enum: targets.map(target => target.ref), description: VNEXT_RETRY_QUESTION_GUIDANCE.ref },
          question: { type: "string", description: VNEXT_RETRY_QUESTION_GUIDANCE.question },
        },
        required: ["ref", "question"],
      },
    },
  });
}

const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.trim().length > 0
  && value.length <= limit;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** A saved question, with or without its answer, exactly as Room stores it. */
export function isVNextRetryQuestion(value: unknown): value is VNextRetryQuestion {
  if (!isPlainRecord(value)) return false;
  const keys = ["pendingInputId", "ref", "npcRef", "question"];
  if (!exactKeys(value, keys) && !exactKeys(value, [...keys, "answer"])) return false;
  if (retryQuestionSubmissionId(value.pendingInputId) === undefined || !text(value.ref, 512)
    || !(value.npcRef === null || text(value.npcRef, 512)) || !text(value.question, RETRY_QUESTION_MAX_CHARACTERS)) return false;
  if (value.answer === undefined) return true;
  const answer = value.answer;
  return isPlainRecord(answer) && exactKeys(answer, ["submissionId", "text"]) && text(answer.submissionId, 200)
    && (answer.text === null || text(answer.text, RETRY_ANSWER_MAX_CHARACTERS));
}

/** A task as sent once the player has answered: the task, then the question
 * and the answer, then how to read them. Before an answer it is the task. */
export function vnextRetryAnswerTask(task: string, question: VNextRetryQuestion | undefined): string {
  if (question?.answer === undefined) return task;
  return `${task}\n${VNEXT_RETRY_QUESTION_GUIDANCE.answered}${JSON.stringify({
    ref: question.ref, question: question.question, answer: question.answer.text })}\n${VNEXT_RETRY_QUESTION_GUIDANCE.rule}`;
}

/** A filling or correction request with the answer added to its task, the
 * second message. Everything before it, the system message with the frozen
 * context, stays byte for byte what the action sent before the answer. */
export function withRetryAnswer<T extends Readonly<{ messages: readonly unknown[] }>>(input: T, question: VNextRetryQuestion | undefined): T {
  if (question?.answer === undefined) return input;
  const [system, task, ...rest] = input.messages;
  if (!isPlainRecord(task) || task.role !== "user" || typeof task.content !== "string") throw new TypeError("RETRY_ANSWER_TASK_UNAVAILABLE");
  return Object.freeze({ ...input,
    messages: Object.freeze([system, Object.freeze({ ...task, content: vnextRetryAnswerTask(task.content, question) }), ...rest]) });
}
