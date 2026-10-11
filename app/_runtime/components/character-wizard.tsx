import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  BACKGROUNDS,
  CLASSES,
  CLASS_KITS,
  DRAGON_ANCESTRIES,
  RACES,
  SPELLS,
  backgroundById,
  classById,
  raceById,
  toolChoiceOptions,
} from "@/lib/dnd/catalog";
import {
  POINT_BUY_CAP,
  chosenExpertise,
  compileSheet,
  draftIssues,
  expertiseChoice,
  finalScores,
  grantedSkills,
  kitProficiencyGaps,
  normalizeDraftChoices,
  pointsSpent,
  sheetProficiencies,
  skillOrToolLabel,
  skillPickRule,
  spellRequirement,
  toolChoiceLabel,
  validHalfElfPicks,
  type DraftIssueStep,
} from "@/lib/dnd/compute";
import {
  ABILITIES,
  ABILITY_LABEL,
  EMPTY_SCORES,
  SKILLS,
  STANDARD_ARRAY,
  TOOLS,
  type Ability,
  type AbilityScores,
  type BackgroundDef,
  type CharacterSheet,
  type DraftSheet,
  type SkillId,
  type ToolChoiceSource,
  type ToolId,
} from "@/lib/dnd/types";
import { abilityMod, cn, signed } from "@/lib/utils";
import { spellCardFacts } from "@/lib/dnd/spell-card";

const STEPS = [
  "种族",
  "职业",
  "属性",
  "背景",
  "技能",
  "法术",
  "装备",
  "身份",
  "总览",
] as const;

export const DEFAULT_DRAFT: DraftSheet = {
  name: "",
  raceId: "human",
  classId: "fighter",
  subclassId: "champion",
  backgroundId: "soldier",
  scores: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 },
  extraSkillIds: [],
  cantrips: [],
  prepared: [],
  spellbook: [],
  equipmentChoice: 0,
  appearance: "",
  trait: "",
  ideal: "",
  bond: "",
  flaw: "",
};

/** The step where each thing a draft still owes is settled (ADR 0156). */
const ISSUE_STEP: Record<DraftIssueStep, number> = {
  race: STEPS.indexOf("种族"),
  class: STEPS.indexOf("职业"),
  scores: STEPS.indexOf("属性"),
  background: STEPS.indexOf("背景"),
  skills: STEPS.indexOf("技能"),
  spells: STEPS.indexOf("法术"),
  equipment: STEPS.indexOf("装备"),
  identity: STEPS.indexOf("身份"),
};

export function CharacterWizard({
  initial,
  onLock,
  busy,
}: {
  initial?: DraftSheet;
  onLock: (draft: DraftSheet) => void;
  busy?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraftState] = useState<DraftSheet>(() => normalizeDraftChoices(initial ?? DEFAULT_DRAFT));
  // SPEC 0004 §4: every change drops the tool and Expertise choices the new
  // race, class, subclass, background or skills no longer offer, and moves
  // off a kit with armor or weapons the character is not proficient with.
  const setDraft = (next: DraftSheet) => setDraftState(normalizeDraftChoices(next));
  const cls = classById(draft.classId)!;
  const spent = pointsSpent(draft.scores);
  const finals = finalScores(draft.scores, draft.raceId, validHalfElfPicks(draft) ? draft.halfElfPicks : undefined);
  // A race's own cantrip comes with the race; only a spellcasting class picks spells.
  const skipSpell = !cls.spellcasting;
  const toolOptions = toolChoiceOptions(draft);
  const expertise = expertiseChoice(draft);
  const pending = draftIssues(draft);
  const stepPending = pending.filter((issue) => ISSUE_STEP[issue.step] === step);
  const kitGaps = kitProficiencyGaps(draft);
  const anyKitAllowed = kitGaps.some((gap) => gap.length === 0);
  const pickTool = (source: ToolChoiceSource, tool: ToolId | undefined) =>
    setDraft({ ...draft, toolChoices: { ...draft.toolChoices, [source]: tool } });

  useEffect(() => {
    if (skipSpell && step === 5) setStep(6);
  }, [skipSpell, step]);

  function next() {
    let n = step + 1;
    if (n === 5 && skipSpell) n = 6;
    setStep(Math.min(n, STEPS.length - 1));
  }
  function prev() {
    let n = step - 1;
    if (n === 5 && skipSpell) n = 4;
    setStep(Math.max(n, 0));
  }

  const preview = useMemo(() => compileSheet(draft), [draft]);

  return (
    <div className="rounded-[28px] border border-border bg-surface p-5 md:p-8">
      <div className="mb-6 flex flex-wrap gap-1 text-xs text-subtle">
        {STEPS.map((s, i) => {
          if (i === 5 && skipSpell) return null;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStep(i)}
              className={cn(
                "rounded-full px-2.5 py-1",
                i === step ? "bg-primary text-primary-fg" : "hover:text-fg",
              )}
            >
              {s}
            </button>
          );
        })}
      </div>

      {step === 0 && (
        <div className="grid gap-6">
          <GridPick
            title="你的血脉"
            items={RACES.map((r) => ({
              id: r.id,
              title: r.name,
              body: r.summary,
            }))}
            value={draft.raceId}
            onChange={(raceId) => {
              if (raceId === draft.raceId) return;
              // A race changes the extra skill count and may grant a skill.
              setDraft({ ...draft, raceId, extraSkillIds: [], toolChoices: { ...draft.toolChoices, race: undefined } });
            }}
          />
          {toolOptions.race && (
            <ChoicePick
              title={`工具熟练：${toolChoiceLabel(toolOptions.race)}`}
              hint={`${raceById(draft.raceId)?.name ?? ""}从下列工具中选一种熟练。`}
              options={toolOptions.race.map((id) => ({ id, label: skillOrToolLabel(id) }))}
              selected={draft.toolChoices?.race ? [draft.toolChoices.race] : []}
              max={1}
              onChange={([tool]) => pickTool("race", tool as ToolId | undefined)}
            />
          )}
          {draft.raceId === "half-elf" && (
            <ChoicePick
              title="属性：另外两项各 +1"
              hint="魅力已 +2；再从其他属性中选两项，各 +1。"
              options={ABILITIES.filter((ability) => ability !== "cha").map((id) => ({ id, label: ABILITY_LABEL[id] }))}
              selected={draft.halfElfPicks ?? []}
              max={2}
              onChange={(ids) => setDraft({ ...draft, halfElfPicks: ids as Ability[] })}
            />
          )}
          {draft.raceId === "dragonborn" && (
            <ChoicePick
              title="龙种"
              hint="决定吐息武器的伤害类型和形状，以及你抵抗的伤害。"
              options={DRAGON_ANCESTRIES.map((ancestry) => ({ id: ancestry.id,
                label: `${ancestry.name} · ${ancestry.damage} · ${ancestry.breath}（${ancestry.save}豁免）` }))}
              selected={draft.dragonAncestry ? [draft.dragonAncestry] : []}
              max={1}
              onChange={([id]) => setDraft({ ...draft, dragonAncestry: id })}
            />
          )}
        </div>
      )}
      {step === 1 && (
        <div className="grid gap-6">
          <GridPick
            title="职业"
            items={CLASSES.map((c) => ({
              id: c.id,
              title: c.name,
              body: c.summary,
            }))}
            value={draft.classId}
            onChange={(classId) => {
              if (classId === draft.classId) return;
              const c = classById(classId)!;
              setDraft({
                ...draft,
                classId,
                subclassId: c.subclasses[0].id,
                extraSkillIds: [],
                expertiseIds: [],
                toolChoices: { ...draft.toolChoices, subclass: undefined },
                cantrips: [],
                prepared: [],
                spellbook: [],
                equipmentChoice: 0,
              });
            }}
          />
          <GridPick
            title="子职（3 级）"
            items={cls.subclasses.map((s) => ({
              id: s.id,
              title: s.name,
              body: s.summary,
            }))}
            value={draft.subclassId}
            onChange={(subclassId) => {
              if (subclassId === draft.subclassId) return;
              setDraft({
                ...draft,
                subclassId,
                expertiseIds: expertise?.source === "subclass" ? [] : draft.expertiseIds,
                toolChoices: { ...draft.toolChoices, subclass: undefined },
              });
            }}
          />
          {toolOptions.subclass && (
            <ChoicePick
              title={`工具熟练：${toolChoiceLabel(toolOptions.subclass)}`}
              hint={`${cls.subclasses.find((s) => s.id === draft.subclassId)?.name ?? ""}从下列工具中选一种熟练。`}
              options={toolOptions.subclass.map((id) => ({ id, label: skillOrToolLabel(id) }))}
              selected={draft.toolChoices?.subclass ? [draft.toolChoices.subclass] : []}
              max={1}
              onChange={([tool]) => pickTool("subclass", tool as ToolId | undefined)}
            />
          )}
          {expertise?.source === "subclass" && (
            <ChoicePick
              title={`专精：选 ${expertise.count} 项技能`}
              hint="所选技能熟练，并且熟练加值翻倍。"
              options={expertise.options.map((id) => ({ id, label: skillOrToolLabel(id) }))}
              selected={chosenExpertise(draft, expertise)}
              max={expertise.count}
              onChange={(ids) =>
                setDraft({
                  ...draft,
                  expertiseIds: ids as SkillId[],
                  // A skill this grants is no longer one of the class picks.
                  extraSkillIds: draft.extraSkillIds.filter((id) => !ids.includes(id)),
                })
              }
            />
          )}
        </div>
      )}
      {step === 2 && (
        <ScoresStep
          scores={draft.scores}
          finals={finals}
          spent={spent}
          onChange={(scores) => setDraft({ ...draft, scores })}
        />
      )}
      {step === 3 && (
        <div className="grid gap-6">
          <GridPick
            title="背景"
            items={BACKGROUNDS.map((b) => ({
              id: b.id,
              title: b.name,
              body: `${b.summary} 熟练：${b.skills.map((id) => SKILLS.find((s) => s.id === id)?.label).join("、")}${backgroundTools(b) ? `；工具：${backgroundTools(b)}` : ""}`,
            }))}
            value={draft.backgroundId}
            onChange={(backgroundId) => {
              if (backgroundId === draft.backgroundId) return;
              setDraft({ ...draft, backgroundId, extraSkillIds: [], toolChoices: { ...draft.toolChoices, background: undefined } });
            }}
          />
          {(backgroundById(draft.backgroundId)?.toolProficiencies?.length ?? 0) > 0 && (
            <p className="text-sm text-muted">
              背景工具熟练：{backgroundById(draft.backgroundId)!.toolProficiencies!.map(skillOrToolLabel).join("、")}
            </p>
          )}
          {toolOptions.background && (
            <ChoicePick
              title={`工具熟练：${toolChoiceLabel(toolOptions.background)}`}
              hint={`${backgroundById(draft.backgroundId)?.name ?? ""}从下列中选一种熟练。`}
              options={toolOptions.background.map((id) => ({ id, label: skillOrToolLabel(id) }))}
              selected={draft.toolChoices?.background ? [draft.toolChoices.background] : []}
              max={1}
              onChange={([tool]) => pickTool("background", tool as ToolId | undefined)}
            />
          )}
        </div>
      )}
      {step === 4 && (
        <SkillsStep draft={draft} onChange={setDraft} />
      )}
      {step === 5 && (
        <SpellsStep draft={draft} onChange={setDraft} />
      )}
      {step === 6 && (
        <div className="grid gap-3">
          <GridPick
            title="起身时带上什么"
            items={(CLASS_KITS[draft.classId] ?? []).map((kit, i) => ({
              id: String(i),
              title: `行装 ${i + 1}`,
              body: kit.join(" · "),
              // 2014: starting armor and weapons are "if proficient".
              note: kitGaps[i]?.length ? `不熟练：${kitGaps[i].join("、")}` : undefined,
              disabled: anyKitAllowed && (kitGaps[i]?.length ?? 0) > 0,
            }))}
            value={String(draft.equipmentChoice)}
            onChange={(v) => setDraft({ ...draft, equipmentChoice: Number(v) })}
          />
          {kitGaps.some((gap) => gap.length > 0) && (
            <p className="text-xs text-subtle">
              {anyKitAllowed
                ? "护甲和武器只在熟练时随行装领取，含不熟练护甲或武器的行装不能选。"
                : "每套行装都有你不熟练的护甲或武器：用不熟练的武器攻击不加熟练加值；穿不熟练的护甲时，力量和敏捷的检定、豁免与攻击有劣势，也不能施法。"}
            </p>
          )}
        </div>
      )}
      {step === 7 && (
        <div className="grid gap-3">
          <h2 className="font-display text-2xl">你是谁</h2>
          <Input
            placeholder="角色姓名"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <Textarea
            placeholder="外貌（别人第一眼看见什么）"
            value={draft.appearance}
            onChange={(e) => setDraft({ ...draft, appearance: e.target.value })}
          />
          <Input
            placeholder="性格特点"
            value={draft.trait}
            onChange={(e) => setDraft({ ...draft, trait: e.target.value })}
          />
          <Input
            placeholder="理想"
            value={draft.ideal}
            onChange={(e) => setDraft({ ...draft, ideal: e.target.value })}
          />
          <Input
            placeholder="羁绊"
            value={draft.bond}
            onChange={(e) => setDraft({ ...draft, bond: e.target.value })}
          />
          <Input
            placeholder="缺点"
            value={draft.flaw}
            onChange={(e) => setDraft({ ...draft, flaw: e.target.value })}
          />
        </div>
      )}
      {step === 8 && (
        <div className="grid gap-3 text-sm leading-relaxed">
          <h2 className="font-display text-2xl">{preview.name || "未名冒险者"}</h2>
          <p className="text-muted">
            {RACES.find((r) => r.id === preview.raceId)?.name}
            {CLASSES.find((c) => c.id === preview.classId)?.name}
            {" · "}
            {cls.subclasses.find((s) => s.id === preview.subclassId)?.name}
            {" · 3 级"}
          </p>
          <p>
            AC {preview.ac} · 生命 {preview.hp.max} · 速度 {preview.speed} 尺
          </p>
          <p>
            {ABILITIES.map((a) => `${ABILITY_LABEL[a]} ${preview.scores[a]}（${signed(abilityMod(preview.scores[a]))}）`).join("　")}
          </p>
          <ProficiencySummary sheet={preview} draft={draft} />
          <p className="text-muted">装备：{preview.equipment.join("、")}</p>
          {pending.length > 0 && (
            <p data-wizard-issues className="text-danger">锁定前还要：{pending.map((issue) => issue.text).join("；")}。</p>
          )}
        </div>
      )}

      {stepPending.length > 0 && step !== STEPS.length - 1 && (
        <p data-wizard-step-issues className="mt-6 text-sm text-danger">
          这一步还要：{stepPending.map((issue) => issue.text).join("；")}。
        </p>
      )}
      <div className="mt-8 flex justify-between gap-3">
        <Button variant="ghost" onClick={prev} disabled={step === 0}>
          上一步
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={next} disabled={stepPending.length > 0}>下一步</Button>
        ) : (
          <Button
            disabled={busy || pending.length > 0}
            onClick={() => onLock(draft)}
          >
            {busy ? "写入人物卡……" : "锁定人物卡"}
          </Button>
        )}
      </div>
    </div>
  );
}

function GridPick({
  title,
  items,
  value,
  onChange,
}: {
  title: string;
  items: { id: string; title: string; body: string; note?: string; disabled?: boolean }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div>
      <h2 className="mb-4 font-display text-2xl">{title}</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            disabled={it.disabled}
            onClick={() => onChange(it.id)}
            className={cn(
              "rounded-[16px] border p-4 text-left transition-colors",
              value === it.id
                ? "border-brass bg-elevated"
                : "border-border bg-bg/40 hover:bg-elevated/60",
              it.disabled && "cursor-not-allowed opacity-50 hover:bg-bg/40",
            )}
          >
            <p className="font-medium">{it.title}</p>
            <p className="mt-1 text-sm text-muted">{it.body}</p>
            {it.note && <p className="mt-1 text-xs text-danger">{it.note}</p>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Pick `max` of `options`; with `max` 1 a click replaces the pick. */
function ChoicePick({
  title,
  hint,
  options,
  selected,
  max,
  onChange,
}: {
  title: string;
  hint?: string;
  options: { id: string; label: string }[];
  selected: readonly string[];
  max: number;
  onChange: (ids: string[]) => void;
}) {
  const full = max > 1 && selected.length >= max;
  function toggle(id: string) {
    if (max === 1) return onChange([id]);
    if (selected.includes(id)) return onChange(selected.filter((x) => x !== id));
    if (!full) onChange([...selected, id]);
  }
  return (
    <div>
      <h3 className="font-medium">
        {title}
        <span className="ml-2 text-xs text-subtle">已选 {selected.length}/{max}</span>
      </h3>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
        {options.map((option) => {
          const on = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => toggle(option.id)}
              className={cn(
                "rounded-[12px] border px-3 py-2 text-left text-sm",
                on ? "border-brass bg-elevated" : "border-border",
                !on && full && "opacity-40",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A background's tools in words: fixed ones and its "one of your choice". */
function backgroundTools(background: BackgroundDef): string {
  return [
    ...(background.toolProficiencies ?? []).map(skillOrToolLabel),
    ...(background.toolChoice ? [toolChoiceLabel(background.toolChoice)] : []),
  ].join("、");
}

/** SPEC 0004 §4: the sheet's skills, tools, weapons and armor. Skills and
 * Expertise are the draft's own picks, not the compiler's fill-ins for
 * choices still owed. */
function ProficiencySummary({ sheet, draft }: { sheet: CharacterSheet; draft: DraftSheet }) {
  const choice = expertiseChoice(draft);
  const expertise: string[] = choice === undefined ? [] : chosenExpertise(draft, choice);
  const skills = new Set<string>([...grantedSkills(draft), ...draft.extraSkillIds]);
  const proficiencies = sheetProficiencies({ ...sheet, expertise });
  const words = (entries: { label: string; expertise: boolean }[]) =>
    entries.map((entry) => `${entry.label}${entry.expertise ? "（专精）" : ""}`).join("、") || "无";
  return (
    <div className="grid gap-1">
      <p>
        技能：
        {words(SKILLS.filter((s) => skills.has(s.id))
          .map((s) => ({ label: s.label, expertise: expertise.includes(s.id) })))}
      </p>
      <p>工具：{words(proficiencies.tools)}</p>
      <p>武器：{words(proficiencies.weapons)}</p>
      <p>护甲：{words(proficiencies.armor)}</p>
    </div>
  );
}

function ScoresStep({
  scores,
  finals,
  spent,
  onChange,
}: {
  scores: AbilityScores;
  finals: AbilityScores;
  spent: number;
  onChange: (s: AbilityScores) => void;
}) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-2xl">属性</h2>
        <p className={cn("text-sm", spent > POINT_BUY_CAP ? "text-danger" : "text-muted")}>
          点买 {spent} / {POINT_BUY_CAP}
        </p>
      </div>
      <div className="mb-4 flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          type="button"
          onClick={() =>
            onChange({ str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 })
          }
        >
          标准数组
        </Button>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          onClick={() => onChange({ ...EMPTY_SCORES })}
        >
          清零点买
        </Button>
      </div>
      <div className="grid gap-2">
        {ABILITIES.map((a) => (
          <div
            key={a}
            className="flex items-center gap-3 rounded-[12px] border border-border bg-bg/40 px-3 py-2"
          >
            <span className="w-12 font-medium">{ABILITY_LABEL[a]}</span>
            <input
              type="range"
              min={8}
              max={15}
              value={scores[a]}
              onChange={(e) =>
                onChange({ ...scores, [a]: Number(e.target.value) as number })
              }
              className="flex-1 accent-brass"
            />
            <span className="w-8 tabular-nums">{scores[a]}</span>
            <span className="w-16 text-right text-sm text-muted tabular-nums">
              最终 {finals[a]}（{signed(abilityMod(finals[a]))}）
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-subtle">
        左侧为点买基础（8–15），右侧已加种族加值。标准数组：{STANDARD_ARRAY.join("、")}。
      </p>
    </div>
  );
}

function SkillsStep({
  draft,
  onChange,
}: {
  draft: DraftSheet;
  onChange: (d: DraftSheet) => void;
}) {
  // Background, race and Knowledge domain skills are already proficient.
  const granted = grantedSkills(draft);
  const locked = new Set<SkillId>(granted);
  const rule = skillPickRule(draft);
  const chosen = draft.extraSkillIds;
  const outside = chosen.filter((id) => !rule.classList.includes(id)).length;
  const expertise = expertiseChoice(draft);
  // A class pick comes from the class list; a race's extra picks may be any skill.
  const pickable = (id: SkillId) => !locked.has(id) && !chosen.includes(id) && chosen.length < rule.count
    && (rule.classList.includes(id) || outside < rule.anyCount);
  function toggle(id: SkillId) {
    if (chosen.includes(id)) onChange({ ...draft, extraSkillIds: chosen.filter((x) => x !== id) });
    else if (pickable(id)) onChange({ ...draft, extraSkillIds: [...chosen, id] });
  }
  return (
    <div>
      <h2 className="font-display text-2xl">技能</h2>
      <p className="mt-1 text-sm text-muted">
        已有熟练 {granted.map(skillOrToolLabel).join("、") || "无"}。
        再选 {rule.count} 项（已选 {chosen.length}）
        {rule.anyCount > 0 ? `，其中 ${rule.anyCount} 项可以不在职业技能表里` : "，都从职业技能表里选"}。
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
        {SKILLS.map((s) => {
          const isLocked = locked.has(s.id);
          const isOn = isLocked || chosen.includes(s.id);
          const allowed = isOn || pickable(s.id);
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={isOn}
              data-wizard-skill={s.id}
              disabled={isLocked || !allowed}
              onClick={() => toggle(s.id)}
              className={cn(
                "rounded-[12px] border px-3 py-2 text-left text-sm",
                isOn ? "border-brass bg-elevated" : "border-border",
                !allowed && "opacity-30",
              )}
            >
              {s.label}
              <span className="ml-1 text-xs text-subtle">{ABILITY_LABEL[s.ability]}</span>
            </button>
          );
        })}
      </div>
      {expertise?.source === "class" && (
        <div className="mt-6">
          <ChoicePick
            title={`专精：选 ${expertise.count} 项`}
            hint={`从已熟练的技能和${expertise.options.filter((id) => TOOLS.some((t) => t.id === id)).map(skillOrToolLabel).join("、")}中选，熟练加值翻倍。`}
            options={expertise.options.map((id) => ({ id, label: skillOrToolLabel(id) }))}
            selected={chosenExpertise(draft, expertise)}
            max={expertise.count}
            onChange={(ids) => onChange({ ...draft, expertiseIds: ids as (SkillId | ToolId)[] })}
          />
        </div>
      )}
    </div>
  );
}

/** SRD 5.1 (2014), 3rd level, as `spellRequirement` counts it (ADR 0156). */
function SpellsStep({
  draft,
  onChange,
}: {
  draft: DraftSheet;
  onChange: (d: DraftSheet) => void;
}) {
  const need = spellRequirement(draft);
  if (need === null) return <p className="text-sm text-muted">此职业不选法术。</p>;
  function toggle(list: string[], id: string, cap: number) {
    if (list.includes(id)) return list.filter((x) => x !== id);
    if (list.length >= cap) return list;
    return [...list, id];
  }
  const wizard = need.spellbook !== null;
  return (
    <div className="grid gap-6">
      <h2 className="font-display text-2xl">法术</h2>
      {need.cantrips.count > 0 && (
        <SpellGroup
          title={`戏法（${draft.cantrips.length}/${need.cantrips.count}）`}
          ids={need.cantrips.pool}
          selected={draft.cantrips}
          onToggle={(id) => onChange({ ...draft, cantrips: toggle(draft.cantrips, id, need.cantrips.count) })}
        />
      )}
      {need.spellbook !== null && (
        <SpellGroup
          title={`法术书（${draft.spellbook.length}/${need.spellbook.count}）`}
          hint="3 级法师的法术书里有 10 个法术，每天从中准备一部分。"
          ids={need.spellbook.pool}
          selected={draft.spellbook}
          onToggle={(id) => onChange({ ...draft, spellbook: toggle(draft.spellbook, id, need.spellbook!.count) })}
        />
      )}
      <SpellGroup
        title={`${need.prepared.label}（${draft.prepared.length}/${need.prepared.count}）`}
        hint={wizard
          ? need.prepared.pool.length === 0 ? "先在上面的法术书里选法术，再从书里准备。" : "只能准备法术书里的法术；数量＝智力调整值＋3。"
          : need.prepared.label === "已知法术" ? "3 级游侠知道 3 个法术。" : "数量＝感知调整值＋3。"}
        ids={need.prepared.pool}
        selected={draft.prepared}
        onToggle={(id) => onChange({ ...draft, prepared: toggle(draft.prepared, id, need.prepared.count) })}
      />
    </div>
  );
}

function SpellGroup({
  title,
  hint,
  ids,
  selected,
  onToggle,
}: {
  title: string;
  hint?: string;
  ids: readonly string[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm text-muted">{title}</h3>
      {hint ? <p className="-mt-1 mb-2 text-xs text-subtle">{hint}</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {ids.map((id) => {
          const sp = SPELLS.find((s) => s.id === id);
          if (!sp) return null;
          const facts = spellCardFacts(id);
          const on = selected.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              data-wizard-spell={id}
              onClick={() => onToggle(id)}
              className={cn(
                "rounded-[12px] border p-3 text-left",
                on ? "border-brass bg-elevated" : "border-border",
              )}
            >
              <p className="text-sm font-medium">
                {sp.name}
                <span className="ml-2 text-xs text-subtle">
                  {sp.level === 0 ? "戏法" : `${sp.level} 环`} · {sp.school}
                  {sp.askOn === "check" && " · 鉴定前问"}
                </span>
              </p>
              {(sp.time || sp.range || sp.duration) && (
                <p className="mt-0.5 text-[11px] text-subtle">
                  {[sp.time, sp.range, sp.duration].filter(Boolean).join(" · ")}
                </p>
              )}
              {facts && (
                <div className="mt-1 grid gap-0.5 text-[11px] text-brass">
                  <p>{facts.target}</p>
                  <p>{facts.resolution}</p>
                </div>
              )}
              <p className="mt-1 text-xs leading-relaxed text-muted">{sp.text}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
