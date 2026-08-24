import type { CharacterSheet } from "./types";
import type { PendingRoll, RollKind } from "@/lib/kp/prompt";
import { ensureResources, left } from "./resources";
import { uniqueSpellIds } from "./catalog";
import { placeOf } from "@/lib/kp/where";

export type BoostId =
  | "guidance"
  | "bless"
  | "help"
  | "lucky"
  | "inspiration"
  | "guided-strike"
  | "sneak"
  | "superiority";

export type EligibleBoost = {
  id: BoostId;
  label: string;
  detail: string;
  fromUserId: string;
  defaultOn?: boolean;
  /** 够不到时填写，界面灰掉且服务器不认。 */
  blocked?: string;
};

function knowsGuidance(sheet: CharacterSheet) {
  return uniqueSpellIds(sheet).includes("guidance");
}

export function rollKind(roll: Pick<PendingRoll, "kind" | "skill">): RollKind {
  if (
    roll.kind === "save" ||
    roll.kind === "attack" ||
    roll.kind === "check" ||
    roll.kind === "init" ||
    roll.kind === "damage" ||
    roll.kind === "death" ||
    roll.kind === "heal"
  ) {
    return roll.kind;
  }
  return "check";
}

export function eligibleBoosts(
  party: { userId: string; sheet: CharacterSheet }[],
  roll: Pick<PendingRoll, "userId" | "kind" | "skill" | "advantage" | "sneakOk">,
  opts?: {
    where?: Record<string, string>;
    sceneId?: string;
    inCombat?: boolean;
    activeId?: string | null;
    spendAction?: Record<string, boolean>;
  },
): EligibleBoost[] {
  const kind = rollKind(roll);
  const out: EligibleBoost[] = [];
  const roller = party.find((p) => p.userId === roll.userId);
  const where = opts?.where ?? {};
  const sceneId = opts?.sceneId ?? "wake";
  const rollerPlace = placeOf(where, roll.userId, sceneId);

  if (kind === "heal") return [];
  if (kind === "damage") {
    if (
      roller?.sheet.subclassId === "war" &&
      left(ensureResources(roller.sheet).resources!.channel) > 0
    ) {
      out.push({
        id: "guided-strike",
        label: "导向打击 +10",
        detail: "引导神力。命中后勾选，掷出伤害才扣次数。",
        fromUserId: roll.userId,
      });
    }
    if (roller?.sheet.classId === "rogue") {
      out.push({
        id: "sneak",
        label: "偷袭 +2d6",
        detail: "须有优势，或目标贴身有未失能盟友且你无劣势。每回合一次。",
        fromUserId: roll.userId,
        blocked: roll.sneakOk ? undefined : "这次没有优势也没有夹击",
      });
    }
    if (
      roller?.sheet.subclassId === "battlemaster" &&
      left(ensureResources(roller.sheet).resources!.superiority) > 0
    ) {
      out.push({
        id: "superiority",
        label: "战术骰 +1d8",
        detail: "战斗大师。命中后勾选，掷出伤害才扣一颗。短休恢复。",
        fromUserId: roll.userId,
      });
    }
    return out;
  }

  if ((kind === "check" || kind === "init") && roller) {
    const already = roller.sheet.resources?.conc?.id === "guidance";
    if (!already) {
      const selfHas = knowsGuidance(roller.sheet);
      const ally = party.find(
        (p) =>
          p.userId !== roll.userId &&
          knowsGuidance(p.sheet) &&
          placeOf(where, p.userId, sceneId) === rollerPlace,
      );
      const caster = selfHas ? roller : ally;
      if (caster) {
        let blocked: string | undefined;
        if (opts?.inCombat) {
          const ownTurn = opts.activeId === caster.userId;
          const hasAction = opts.spendAction?.[caster.userId] !== false;
          if (!ownTurn) blocked = "战斗里要在施法者自己的回合用动作施放";
          else if (!hasAction) blocked = "施法者本回合动作已经用过";
        }
        out.push({
          id: "guidance",
          label:
            caster.userId === roll.userId
              ? "神导术 +1d4"
              : `${caster.sheet.name || "同伴"}的神导术 +1d4`,
          detail: "戏法，不耗环位。勾了并掷出才加在这次对话/技能检定上。",
          fromUserId: caster.userId,
          blocked,
        });
      }
    }
  }

  if (roller?.sheet.inspiration && !roll.advantage) {
    out.push({
      id: "inspiration",
      label: "激励（优势）",
      detail: "花掉你的激励，掷两颗 d20 取高。",
      fromUserId: roll.userId,
    });
  }

  if (roller?.sheet.raceId === "lightfoot") {
    out.push({
      id: "lucky",
      label: "半身人幸运",
      detail: "这颗 d20 若出 1，必须重掷，用新结果。",
      fromUserId: roll.userId,
      defaultOn: true,
    });
  }

  return out;
}

export function d20() {
  return 1 + Math.floor(Math.random() * 20);
}

export function d4() {
  return 1 + Math.floor(Math.random() * 4);
}
