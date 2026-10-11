import { toolChoiceOptions } from "../../../app/_runtime/lib/dnd/catalog";
import {
  chosenExpertise,
  draftIssues,
  expertiseChoice,
  grantedSkills,
  normalizeDraftChoices,
  skillPickRule,
  spellRequirement,
} from "../../../app/_runtime/lib/dnd/compute";
import { SKILLS, TOOL_CHOICE_SOURCES, type DraftSheet, type SkillId } from "../../../app/_runtime/lib/dnd/types";

/** A fixture draft with every choice the server requires (ADR 0156) made:
 * what the draft already picked stays, and each missing pick takes the
 * first legal option. For tests about rooms, not about building a card;
 * the building rules have their own tests. Throws if a choice is left. */
export function completeDraft(input: DraftSheet): DraftSheet {
  let draft = normalizeDraftChoices(input);
  const offered = toolChoiceOptions(draft);
  draft = { ...draft, toolChoices: Object.fromEntries(TOOL_CHOICE_SOURCES.flatMap((source) => {
    const picked = draft.toolChoices?.[source];
    const options = offered[source];
    return options === undefined ? [] : [[source, picked ?? options[0]]];
  })) };
  if (draft.raceId === "half-elf" && (draft.halfElfPicks?.length ?? 0) < 2) draft = { ...draft, halfElfPicks: ["dex", "con"] };
  if (draft.raceId === "dragonborn" && draft.dragonAncestry === undefined) draft = { ...draft, dragonAncestry: "red" };
  const fill = (picked: readonly string[], pool: readonly string[], count: number) =>
    [...picked, ...pool.filter((id) => !picked.includes(id))].slice(0, count);
  // A subclass's Expertise skills (Knowledge) are granted before the class
  // picks; a class's (rogue) is taken from the skills picked.
  const settleExpertise = (source: "class" | "subclass") => {
    const expertise = expertiseChoice(draft);
    if (expertise?.source !== source) return;
    draft = normalizeDraftChoices({ ...draft,
      expertiseIds: fill(chosenExpertise(draft, expertise), expertise.options, expertise.count) as DraftSheet["expertiseIds"] });
  };
  settleExpertise("subclass");
  const rule = skillPickRule(draft);
  const granted = new Set<string>(grantedSkills(draft));
  const skills = [...draft.extraSkillIds];
  for (const pool of [rule.classList, SKILLS.map((skill) => skill.id)]) {
    for (const id of pool) {
      const outside = skills.filter((skill) => !rule.classList.includes(skill)).length;
      if (skills.length >= rule.count) break;
      if (granted.has(id) || skills.includes(id as SkillId)) continue;
      if (!rule.classList.includes(id as SkillId) && outside >= rule.anyCount) continue;
      skills.push(id as SkillId);
    }
  }
  draft = normalizeDraftChoices({ ...draft, extraSkillIds: skills });
  settleExpertise("class");
  const need = spellRequirement(draft);
  if (need !== null) {
    const spellbook = need.spellbook === null ? [] : fill(draft.spellbook, need.spellbook.pool, need.spellbook.count);
    const prepared = fill(draft.prepared, need.spellbook === null ? need.prepared.pool : spellbook, need.prepared.count);
    draft = normalizeDraftChoices({ ...draft, cantrips: fill(draft.cantrips, need.cantrips.pool, need.cantrips.count), spellbook, prepared });
  }
  const left = draftIssues(draft);
  if (left.length > 0) throw new Error(`completeDraft could not settle: ${left.map((issue) => issue.text).join("; ")}`);
  return draft;
}
