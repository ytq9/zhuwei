import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  BACKGROUNDS,
  CLASSES,
  CLASS_KITS,
  CLERIC_CANTRIPS,
  CLERIC_SPELLS,
  RANGER_SPELLS,
  RACES,
  SPELLS,
  WIZARD_CANTRIPS,
  WIZARD_SPELLS,
  backgroundById,
  classById,
  raceById,
  toolChoiceOptions,
} from "@/lib/dnd/catalog";
import {
  POINT_BUY_CAP,
  chosenExpertise,
  compileSheet,
  expertiseChoice,
  finalScores,
  grantedSkills,
  kitProficiencyGaps,
  normalizeDraftChoices,
  pendingDraftChoices,
  pointsSpent,
  sheetProficiencies,
  skillOrToolLabel,
  toolChoiceLabel,
  type DraftChoiceStep,
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

/** The step where each owed proficiency choice is made. */
const CHOICE_STEP: Record<DraftChoiceStep, number> = {
  race: STEPS.indexOf("种族"),
  class: STEPS.indexOf("职业"),
  background: STEPS.indexOf("背景"),
  skills: STEPS.indexOf("技能"),
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
  const finals = finalScores(draft.scores, draft.raceId);
  const skipSpell = !cls.spellcasting && draft.raceId !== "high-elf" && draft.raceId !== "tiefling";
  const toolOptions = toolChoiceOptions(draft);
  const expertise = expertiseChoice(draft);
  const pending = pendingDraftChoices(draft);
  const stepPending = pending.filter((choice) => CHOICE_STEP[choice.step] === step);
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
          {!draft.name.trim() && (
            <p className="text-danger">锁定前请填写姓名。</p>
          )}
          {pending.length > 0 && (
            <p className="text-danger">锁定前还要选：{pending.map((choice) => choice.text).join("；")}。</p>
          )}
        </div>
      )}

      {stepPending.length > 0 && (
        <p className="mt-6 text-sm text-danger">
          还要选：{stepPending.map((choice) => choice.text).join("；")}。
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
            disabled={busy || !draft.name.trim() || pending.length > 0}
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
  const cls = classById(draft.classId)!;
  const race = RACES.find((r) => r.id === draft.raceId);
  // Background, race and Knowledge domain skills are already proficient.
  const granted = grantedSkills(draft);
  const locked = new Set<SkillId>(granted);
  const extra = (race?.extraSkills ?? 0) + cls.skillPicks;
  const chosen = draft.extraSkillIds;
  const expertise = expertiseChoice(draft);
  function toggle(id: SkillId) {
    if (locked.has(id)) return;
    if (chosen.includes(id)) {
      onChange({ ...draft, extraSkillIds: chosen.filter((x) => x !== id) });
      return;
    }
    if (chosen.length >= extra) return;
    if (cls.skillList.length && !cls.skillList.includes(id) && !(race?.extraSkills && !cls.skillList.includes(id))) {
      if (!cls.skillList.includes(id) && !(race?.extraSkills)) return;
    }
    const fromClass = cls.skillList.includes(id);
    const fromRaceExtra = Boolean(race?.extraSkills);
    if (!fromClass && !fromRaceExtra) return;
    onChange({ ...draft, extraSkillIds: [...chosen, id] });
  }
  return (
    <div>
      <h2 className="font-display text-2xl">技能</h2>
      <p className="mt-1 text-sm text-muted">
        已有熟练 {granted.map(skillOrToolLabel).join("、")}。
        再选 {extra} 项（已选 {chosen.length}）。
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
        {SKILLS.map((s) => {
          const isLocked = locked.has(s.id);
          const isOn = isLocked || chosen.includes(s.id);
          const allowed = isLocked || cls.skillList.includes(s.id) || Boolean(race?.extraSkills);
          return (
            <button
              key={s.id}
              type="button"
              disabled={!allowed || (isLocked as boolean)}
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

function SpellsStep({
  draft,
  onChange,
}: {
  draft: DraftSheet;
  onChange: (d: DraftSheet) => void;
}) {
  const cls = classById(draft.classId);
  const kind = cls?.spellcasting;
  const cantripPool = kind === "cleric" ? CLERIC_CANTRIPS : WIZARD_CANTRIPS;
  const spellPool =
    kind === "cleric" ? CLERIC_SPELLS : kind === "ranger" ? RANGER_SPELLS : WIZARD_SPELLS;
  const cantripNeed = kind === "ranger" ? 0 : 3;
  const bookNeed = kind === "wizard" ? 8 : 0;
  const prepNeed =
    kind === "wizard" || kind === "cleric"
      ? Math.max(1, abilityMod(finalScores(draft.scores, draft.raceId)[kind === "wizard" ? "int" : "wis"]) + 3)
      : kind === "ranger"
        ? 3
        : 0;

  function toggle(list: string[], id: string, cap: number) {
    if (list.includes(id)) return list.filter((x) => x !== id);
    if (list.length >= cap) return list;
    return [...list, id];
  }

  return (
    <div className="grid gap-6">
      <h2 className="font-display text-2xl">法术</h2>
      {cantripNeed > 0 && (
        <SpellGroup
          title={`戏法（${draft.cantrips.length}/${cantripNeed}）`}
          ids={cantripPool}
          selected={draft.cantrips}
          onToggle={(id) =>
            onChange({
              ...draft,
              cantrips: toggle(draft.cantrips, id, cantripNeed),
            })
          }
        />
      )}
      {kind === "wizard" && (
        <SpellGroup
          title={`法术书（${draft.spellbook.length}/${bookNeed}）`}
          ids={spellPool}
          selected={draft.spellbook}
          onToggle={(id) =>
            onChange({
              ...draft,
              spellbook: toggle(draft.spellbook, id, bookNeed),
            })
          }
        />
      )}
      {prepNeed > 0 && (
        <SpellGroup
          title={`${kind === "ranger" ? "已知法术" : "已准备"}（${(kind === "wizard" ? draft.prepared : kind === "ranger" ? draft.spellbook : draft.prepared).length}/${prepNeed}）`}
          ids={kind === "wizard" ? draft.spellbook.length ? draft.spellbook : spellPool : spellPool}
          selected={kind === "ranger" ? draft.spellbook : draft.prepared}
          onToggle={(id) =>
            onChange(
              kind === "ranger"
                ? { ...draft, spellbook: toggle(draft.spellbook, id, prepNeed) }
                : { ...draft, prepared: toggle(draft.prepared, id, prepNeed) },
            )
          }
        />
      )}
      {!kind && (
        <p className="text-sm text-muted">此职业不以法术见长。高精灵仍会获得一个戏法。</p>
      )}
    </div>
  );
}

function SpellGroup({
  title,
  ids,
  selected,
  onToggle,
}: {
  title: string;
  ids: string[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm text-muted">{title}</h3>
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
