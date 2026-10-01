import { compareCodeUnits, deepFreeze, isPlainRecord } from "./canonical-json";
import { proposalConversationRecords } from "./proposal-context";
import { VNEXT_RETRY_QUESTION_GUIDANCE } from "./proposal-guidance";
import type { VNextRequiredContext } from "./required-context";

// SPEC 0001 §19, SPEC 0016 §7.2 (ADR 0081): when the player presses again for
// a goal a conversation already failed to reach, without saying what changed,
// the KP may ask once. The question waits on the same prepared action; the
// player's answer, or a decline, continues that action on its frozen context.

export const RETRY_QUESTION_TOOL_NAME = "ask_player_what_changed";
export const RETRY_QUESTION_MAX_CHARACTERS = 300;
export const RETRY_ANSWER_MAX_CHARACTERS = 1200;
/** What the transcript shows for a decline; the table's button says the same. */
export const RETRY_DECLINE_TEXT = "就这样，不补充。";
const PENDING_PREFIX = "retry-question:";

/** A failed conversation of the acting character that the question may name. */
export type VNextRetryThread = Readonly<{ threadRef: string; npcRef: string }>;
/** The player's reply; `text: null` is a decline. */
export type VNextRetryAnswer = Readonly<{ submissionId: string; text: string | null }>;
/** The question saved with its prepared action, then the answer once given. */
export type VNextRetryQuestion = Readonly<{
  pendingInputId: string; threadRef: string; npcRef: string; question: string;
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

/** The failed conversations of the acting character that the selection view
 * shows and that no later conversation has answered (its `addressedThreadRef`
 * names them). A question answered in an action that then rules the talk
 * again leaves that ruling's conversation addressing the failure, so each
 * failure is questioned at most once. Adapter and Room both read it here. */
export function vnextRetryQuestionThreads(context: VNextRequiredContext): readonly VNextRetryThread[] {
  const actor = context.intent?.actorRef;
  if (typeof actor !== "string") return [];
  const conversations = proposalConversationRecords(context);
  const addressed = new Set(conversations.flatMap(value => typeof value.addressedThreadRef === "string" ? [value.addressedThreadRef] : []));
  const open = new Map<string, VNextRetryThread>();
  for (const value of conversations) {
    if (value.actorCharacterId !== actor || value.outcome !== "failure" || typeof value.threadRef !== "string"
      || typeof value.npcCharacterId !== "string" || addressed.has(value.threadRef)) continue;
    open.set(value.threadRef, { threadRef: value.threadRef, npcRef: value.npcCharacterId });
  }
  return deepFreeze([...open.values()].sort((a, b) => compareCodeUnits(a.threadRef, b.threadRef)));
}

/** The second tool of a selection while a failure is open to question. */
export function retryQuestionTool(threads: readonly VNextRetryThread[]) {
  return deepFreeze({
    type: "function" as const,
    function: {
      name: RETRY_QUESTION_TOOL_NAME, strict: true as const, description: VNEXT_RETRY_QUESTION_GUIDANCE.tool,
      parameters: {
        type: "object", additionalProperties: false,
        properties: {
          threadRef: { type: "string", enum: threads.map(thread => thread.threadRef), description: VNEXT_RETRY_QUESTION_GUIDANCE.threadRef },
          question: { type: "string", description: VNEXT_RETRY_QUESTION_GUIDANCE.question },
        },
        required: ["threadRef", "question"],
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
  const keys = ["pendingInputId", "threadRef", "npcRef", "question"];
  if (!exactKeys(value, keys) && !exactKeys(value, [...keys, "answer"])) return false;
  if (retryQuestionSubmissionId(value.pendingInputId) === undefined || !text(value.threadRef, 512) || !text(value.npcRef, 512)
    || !text(value.question, RETRY_QUESTION_MAX_CHARACTERS)) return false;
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
    threadRef: question.threadRef, question: question.question, answer: question.answer.text })}\n${VNEXT_RETRY_QUESTION_GUIDANCE.rule}`;
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
