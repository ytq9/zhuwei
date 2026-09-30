import { isPlainRecord } from "./canonical-json";

// SPEC 0006 §7: phase A authors experiences about existing subjects only.
// These are proposals for review, never authority or an NPC knowledge grant.
export type NpcIntroduction = Readonly<{
  id: string; label: string; content: string; occurrence: string;
  attitude: "believed" | "reported" | "uncertain" | "deception";
  source: string;
}>;
const text = { type: "string" };
export const NPC_INTRODUCTIONS_SCHEMA = Object.freeze({ type: "array",
  description: "New experiences or claims about existing subjects, not new people, places or items. Shared pasts use the same id in every outcome. [] explicitly means none.",
  items: { type: "object", additionalProperties: false,
    properties: { id: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" }, label: text, content: text, occurrence: text,
      // ZW-munycxry: without these meanings Lian marked what she saw herself as
      // reported, and a review could not approve it (only believed is admitted).
      attitude: { type: "string", enum: ["believed", "reported", "uncertain", "deception"],
        description: "believed：你亲身经历、亲眼所见或确信是真的；reported：从别人那里听来的；uncertain：你自己也拿不准；deception：你明知不是这样，仍这么说。" },
      source: text },
    required: ["id", "label", "content", "occurrence", "attitude", "source"] } });

export function npcIntroductionsConform(value: unknown): value is readonly NpcIntroduction[] {
  return Array.isArray(value) && value.length <= 8 && new Set(value.map(row => isPlainRecord(row) ? row.id : undefined)).size === value.length
    && value.every(row => isPlainRecord(row) && Object.keys(row).sort().join() === "attitude,content,id,label,occurrence,source"
      && typeof row.id === "string" && /^[a-z][a-z0-9-]{0,63}$/u.test(row.id)
      && [row.label, row.content, row.occurrence, row.source].every(v => typeof v === "string" && v.trim().length > 0
        && v.trim() === v && v.normalize("NFC") === v && v.length <= 2000)
      && typeof row.label === "string" && row.label.length <= 500
      && ["believed", "reported", "uncertain", "deception"].includes(String(row.attitude)));
}

/** Retain declared provenance in the speaker's private origin, with no change
 * to the audible quote. An empty list keeps the existing motive byte-for-byte. */
export function npcReplyMotive(motive: unknown, introducedContent: readonly NpcIntroduction[]): unknown {
  return introducedContent.length ? JSON.stringify({ motive, introducedContent }) : motive;
}
