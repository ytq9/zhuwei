export const GEAR_SLOTS = [
  { id: "head", label: "头" },
  { id: "neck", label: "颈" },
  { id: "cloak", label: "披风" },
  { id: "armor", label: "护甲" },
  { id: "hands", label: "手" },
  { id: "belt", label: "腰带" },
  { id: "boots", label: "靴" },
  { id: "ring1", label: "戒指一" },
  { id: "ring2", label: "戒指二" },
  { id: "main", label: "主手" },
  { id: "off", label: "副手" },
  { id: "ammo", label: "弹药" },
] as const;

export type GearSlot = (typeof GEAR_SLOTS)[number]["id"];

export type Equipped = Partial<Record<GearSlot, string>>;
export type PackEntry = { itemId: string; qty: number };

export type GearItem = {
  id: string;
  name: string;
  wear: GearSlot | "weapon" | "ring" | "pack";
  twoHanded?: boolean;
  armor?: "light" | "medium" | "heavy" | "shield";
  acBase?: number;
  /** Dex added to AC; cap 2 for medium, 0 for heavy. */
  acDexCap?: number;
  damage?: string;
  text: string;
  aliases?: string[];
  attune?: boolean;
};

export const ITEMS: GearItem[] = [
  { id: "padded", name: "布甲", wear: "armor", armor: "light", acBase: 11, acDexCap: 99, text: "轻甲。AC＝11＋敏捷调整。潜行劣势。" },
  { id: "leather", name: "皮甲", wear: "armor", armor: "light", acBase: 11, acDexCap: 99, text: "轻甲。AC＝11＋敏捷调整。不潜行劣势。", aliases: ["皮甲"] },
  { id: "studded", name: "镶钉皮甲", wear: "armor", armor: "light", acBase: 12, acDexCap: 99, text: "轻甲。AC＝12＋敏捷调整。" },
  { id: "hide", name: "兽皮甲", wear: "armor", armor: "medium", acBase: 12, acDexCap: 2, text: "中甲。AC＝12＋敏捷调整（最多＋2）。" },
  { id: "chain-shirt", name: "链衫", wear: "armor", armor: "medium", acBase: 13, acDexCap: 2, text: "中甲。AC＝13＋敏捷调整（最多＋2）。" },
  { id: "scale", name: "鳞甲", wear: "armor", armor: "medium", acBase: 14, acDexCap: 2, text: "中甲。AC＝14＋敏捷调整（最多＋2）。潜行劣势。", aliases: ["鳞甲"] },
  { id: "breastplate", name: "胸甲", wear: "armor", armor: "medium", acBase: 14, acDexCap: 2, text: "中甲。AC＝14＋敏捷调整（最多＋2）。不潜行劣势。" },
  { id: "half-plate", name: "半身板甲", wear: "armor", armor: "medium", acBase: 15, acDexCap: 2, text: "中甲。AC＝15＋敏捷调整（最多＋2）。潜行劣势。" },
  { id: "ring-mail", name: "环甲", wear: "armor", armor: "heavy", acBase: 14, acDexCap: 0, text: "重甲。AC＝14。潜行劣势。" },
  { id: "chain", name: "链甲", wear: "armor", armor: "heavy", acBase: 16, acDexCap: 0, text: "重甲。AC＝16。力量 13。潜行劣势。", aliases: ["链甲"] },
  { id: "splint", name: "板条甲", wear: "armor", armor: "heavy", acBase: 17, acDexCap: 0, text: "重甲。AC＝17。力量 15。潜行劣势。" },
  { id: "plate", name: "板甲", wear: "armor", armor: "heavy", acBase: 18, acDexCap: 0, text: "重甲。AC＝18。力量 15。潜行劣势。" },
  { id: "shield", name: "盾牌", wear: "off", armor: "shield", text: "占据副手。着装时 AC＋2。需盾牌熟练。", aliases: ["盾牌"] },

  { id: "dagger", name: "匕首", wear: "weapon", damage: "1d4 穿刺", text: "简易近战。灵巧、轻型、投掷（20/60）。", aliases: ["匕首"] },
  { id: "mace", name: "钉头锤", wear: "weapon", damage: "1d6 钝击", text: "简易近战。", aliases: ["钉头锤"] },
  { id: "staff", name: "短杖", wear: "weapon", damage: "1d6 钝击", text: "简易近战。多功能（1d8）。可作法器。", aliases: ["奥术法器（杖）", "手杖"] },
  { id: "handaxe", name: "手斧", wear: "weapon", damage: "1d6 挥砍", text: "简易近战。轻型、投掷（20/60）。", aliases: ["手斧", "两把手斧"] },
  { id: "javelin", name: "标枪", wear: "weapon", damage: "1d6 穿刺", text: "简易近战。投掷（30/120）。", aliases: ["标枪", "标枪 4 支"] },
  { id: "spear", name: "长矛", wear: "weapon", damage: "1d6 穿刺", text: "简易近战。投掷（20/60）、多功能（1d8）。" },
  { id: "club", name: "木棒", wear: "weapon", damage: "1d4 钝击", text: "简易近战。轻型。" },
  { id: "light-crossbow", name: "轻弩", wear: "weapon", twoHanded: true, damage: "1d8 穿刺", text: "简易远程。弹药（80/320）、装填、双手。", aliases: ["轻弩", "轻弩与 20 矢"] },
  { id: "shortbow", name: "短弓", wear: "weapon", twoHanded: true, damage: "1d6 穿刺", text: "简易远程。弹药（80/320）、双手。", aliases: ["短弓", "短弓与 20 矢"] },
  { id: "longbow", name: "长弓", wear: "weapon", twoHanded: true, damage: "1d8 穿刺", text: "军用远程。弹药（150/600）、双手、重型。", aliases: ["长弓", "长弓与 20 矢"] },
  { id: "shortsword", name: "短剑", wear: "weapon", damage: "1d6 穿刺", text: "军用近战。灵巧、轻型。", aliases: ["短剑", "两把短剑", "短剑两把"] },
  { id: "longsword", name: "长剑", wear: "weapon", damage: "1d8 挥砍", text: "军用近战。多功能（1d10）。", aliases: ["长剑"] },
  { id: "rapier", name: "刺剑", wear: "weapon", damage: "1d8 穿刺", text: "军用近战。灵巧。", aliases: ["刺剑"] },
  { id: "battleaxe", name: "战斧", wear: "weapon", damage: "1d8 挥砍", text: "军用近战。多功能（1d10）。" },
  { id: "warhammer", name: "战锤", wear: "weapon", damage: "1d8 钝击", text: "军用近战。多功能（1d10）。", aliases: ["战锤"] },
  { id: "greatsword", name: "巨剑", wear: "weapon", twoHanded: true, damage: "2d6 挥砍", text: "军用近战。重型、双手。", aliases: ["巨剑"] },
  { id: "greataxe", name: "巨斧", wear: "weapon", twoHanded: true, damage: "1d12 挥砍", text: "军用近战。重型、双手。", aliases: ["巨斧"] },
  { id: "glaive", name: "关刀", wear: "weapon", twoHanded: true, damage: "1d10 挥砍", text: "军用近战。重型、触及、双手。" },

  { id: "bolt", name: "弩矢", wear: "ammo", text: "轻弩或手弩的弹药。", aliases: ["20 矢"] },
  { id: "arrow", name: "箭", wear: "ammo", text: "短弓或长弓的弹药。" },

  { id: "holy-symbol", name: "圣徽", wear: "neck", text: "牧师法器。可戴在颈上，或持于盾面。施法时需要一只空闲手持用法器，戴着则免。", aliases: ["圣徽"] },
  { id: "orb", name: "奥术宝珠", wear: "pack", text: "奥术法器。施法时持用。", aliases: ["奥术法器（宝珠）"] },
  { id: "spellbook", name: "法术书", wear: "pack", text: "法师的法术抄本。被毁则准备清单出问题。", aliases: ["法术书"] },
  { id: "thieves-tools", name: "盗贼工具", wear: "pack", text: "开锁、解除陷阱。熟练则可加熟练加值。", aliases: ["盗贼工具"] },
  { id: "crowbar", name: "撬棍", wear: "pack", text: "撬、别。相关力量检定有优势。", aliases: ["撬棍"] },
  { id: "explorer-pack", name: "探险者套装", wear: "pack", text: "背包、睡袋、餐具、火绒盒、十支火把、十份口粮、水袋、五十尺绳。", aliases: ["探险者套装"] },
  { id: "burglar-pack", name: "盗贼套装", wear: "pack", text: "背包、一千颗滚珠、十尺绳、铃铛、蜡烛、撬棍、锤子、十根钉子、提灯、油、口粮、水袋、麻袋。", aliases: ["盗贼套装"] },
  { id: "scholar-pack", name: "学者套装", wear: "pack", text: "背包、书、墨水、笔、小袋羊皮纸、小刀、沙袋。", aliases: ["学者套装"] },
  { id: "priest-pack", name: "牧师套装", wear: "pack", text: "背包、毯子、蜡烛、香、祭服、口粮、水袋。", aliases: ["牧师套装"] },
  { id: "clothes", name: "普通衣服", wear: "pack", text: "日常穿着。不占护甲格，也不提供 AC。", aliases: ["普通衣服"] },
  { id: "fine-clothes", name: "细服", wear: "pack", text: "体面场合。某些社交场合有帮助。", aliases: ["细服"] },
  { id: "prayer-book", name: "祈祷书", wear: "pack", text: "仪式与经文。", aliases: ["祈祷书"] },
  { id: "incense", name: "香烛", wear: "pack", text: "供仪式使用。", aliases: ["香烛"] },
  { id: "ink", name: "墨水与笔", wear: "pack", text: "书写。", aliases: ["墨水与笔", "瓶装墨水"] },
  { id: "knife", name: "小刀", wear: "pack", text: "工具小刀，不当武器。", aliases: ["小刀"] },
  { id: "letters", name: "书信", wear: "pack", text: "几封旧信。", aliases: ["书信"] },
  { id: "pot", name: "铁锅", wear: "pack", text: "野炊。", aliases: ["铁锅", "铁质器皿"] },
  { id: "signet", name: "印章戒指", wear: "ring", text: "家族印记。可盖火漆。不需同调。", aliases: ["印章戒指"] },
  { id: "genealogy", name: "族谱卷", wear: "pack", text: "血统记录。", aliases: ["族谱卷"] },
  { id: "rank-badge", name: "军衔徽记", wear: "pack", text: "证明你曾经在编制里。", aliases: ["军衔徽记"] },
  { id: "trophy", name: "战利品", wear: "pack", text: "某次战役留下的残片。", aliases: ["战利品"] },
  { id: "dark-cloak-bag", name: "暗袋", wear: "pack", text: "藏小东西。", aliases: ["暗袋"] },
  { id: "map-scrap", name: "地图残片", wear: "pack", text: "城市的一块残图。", aliases: ["地图残片"] },
  { id: "pet-rat", name: "宠物鼠", wear: "pack", text: "一只习惯口袋的老鼠。不是熟悉物。", aliases: ["宠物鼠"] },
  { id: "gp", name: "金币", wear: "pack", text: "通用货币。10 gp＝1 pp，1 gp＝10 sp。", aliases: ["gp", "15 gp", "10 gp", "25 gp"] },
];

export function itemById(id: string | undefined | null) {
  if (!id) return undefined;
  return ITEMS.find((i) => i.id === id);
}

export function itemByAlias(raw: string) {
  const t = raw.trim();
  return (
    ITEMS.find((i) => i.name === t) ||
    ITEMS.find((i) => i.aliases?.includes(t))
  );
}

export function slotLabel(id: GearSlot) {
  return GEAR_SLOTS.find((s) => s.id === id)?.label ?? id;
}

export function emptyEquipped(): Equipped {
  return {};
}

function addPack(pack: PackEntry[], itemId: string, qty: number) {
  if (qty <= 0) return;
  const hit = pack.find((p) => p.itemId === itemId);
  if (hit) hit.qty += qty;
  else pack.push({ itemId, qty });
}

function takePack(pack: PackEntry[], itemId: string, qty = 1): boolean {
  const hit = pack.find((p) => p.itemId === itemId);
  if (!hit || hit.qty < qty) return false;
  hit.qty -= qty;
  if (hit.qty <= 0) {
    const i = pack.indexOf(hit);
    pack.splice(i, 1);
  }
  return true;
}

function kitQty(raw: string, item: GearItem): number {
  if (/两把|两支/.test(raw) || item.aliases?.some((a) => /两把/.test(a) && a === raw))
    return 2;
  const n = raw.match(/(\d+)\s*(支|矢|gp)/);
  if (n) return Number(n[1]);
  if (raw.includes("15 gp")) return 15;
  if (raw.includes("25 gp")) return 25;
  if (raw.includes("10 gp")) return 10;
  if (raw.includes("20 矢") && item.id !== "bolt" && item.id !== "arrow") return 1;
  return 1;
}

function extraAmmo(raw: string): PackEntry | null {
  if (!/20\s*矢/.test(raw)) return null;
  if (/弓/.test(raw)) return { itemId: "arrow", qty: 20 };
  return { itemId: "bolt", qty: 20 };
}

export function defaultSlot(item: GearItem): GearSlot | null {
  if (item.wear === "pack") return null;
  if (item.wear === "weapon") return "main";
  if (item.wear === "ring") return "ring1";
  return item.wear;
}

export function kitToGear(lines: string[]): { equipped: Equipped; backpack: PackEntry[] } {
  const equipped = emptyEquipped();
  const backpack: PackEntry[] = [];
  for (const line of lines) {
    const item = itemByAlias(line);
    if (!item) {
      backpack.push({ itemId: line, qty: 1 });
      continue;
    }
    const qty = kitQty(line, item);
    const ammo = extraAmmo(line);
    let placed = 0;
    const slot = defaultSlot(item);
    if (slot && !equipped[slot]) {
      equipped[slot] = item.id;
      placed = 1;
      if (item.twoHanded) equipped.off = undefined;
    } else if (item.wear === "weapon" && !equipped.off && !item.twoHanded && !itemById(equipped.main)?.twoHanded) {
      equipped.off = item.id;
      placed = 1;
    } else if (item.wear === "ring" && !equipped.ring1) {
      equipped.ring1 = item.id;
      placed = 1;
    } else if (item.wear === "ring" && !equipped.ring2) {
      equipped.ring2 = item.id;
      placed = 1;
    }
    if (qty - placed > 0) addPack(backpack, item.id, qty - placed);
    if (ammo) addPack(backpack, ammo.itemId, ammo.qty);
  }
  if (!equipped.ammo) {
    if (backpack.some((p) => p.itemId === "arrow")) equipped.ammo = "arrow";
    else if (backpack.some((p) => p.itemId === "bolt")) equipped.ammo = "bolt";
  }
  return { equipped, backpack };
}

export function acFromGear(
  classId: string,
  scores: { dex: number; con: number },
  equipped: Equipped,
) {
  const dex = Math.floor((scores.dex - 10) / 2);
  const con = Math.floor((scores.con - 10) / 2);
  const armor = itemById(equipped.armor);
  let ac: number;
  if (armor?.armor && armor.armor !== "shield" && armor.acBase != null) {
    const cap = armor.acDexCap ?? 0;
    const dexPart = cap === 0 ? 0 : Math.min(dex, cap);
    ac = armor.acBase + dexPart;
  } else if (classId === "barbarian") ac = 10 + dex + con;
  else ac = 10 + dex;
  const off = itemById(equipped.off);
  if (off?.armor === "shield") ac += 2;
  if (classId === "fighter" && armor?.armor && armor.armor !== "shield") ac += 1;
  return ac;
}

export function wearItem(
  equipped: Equipped,
  backpack: PackEntry[],
  itemId: string,
  slot: GearSlot,
): { equipped: Equipped; backpack: PackEntry[]; error?: string } {
  const nextEq = { ...equipped };
  const nextPack = backpack.map((p) => ({ ...p }));
  const item = itemById(itemId);
  if (!item) return { equipped, backpack, error: "没有这件东西" };
  if (item.wear === "ammo") {
    if (!nextPack.some((p) => p.itemId === itemId) && equipped.ammo !== itemId) {
      return { equipped, backpack, error: "背包里没有这种弹药" };
    }
    nextEq.ammo = itemId;
    return { equipped: nextEq, backpack: nextPack };
  }
  if (!takePack(nextPack, itemId, 1) && !Object.values(equipped).includes(itemId)) {
    return { equipped, backpack, error: "背包里没有" };
  }
  const occupying = (Object.entries(nextEq) as [GearSlot, string][]).find(
    ([s, id]) => id === itemId && s !== slot,
  );
  if (occupying) delete nextEq[occupying[0]];

  const allowed = allowedSlots(item);
  if (!allowed.includes(slot)) {
    addPack(nextPack, itemId, 1);
    return { equipped, backpack, error: `「${item.name}」不能戴在${slotLabel(slot)}` };
  }
  if (nextEq[slot]) addPack(nextPack, nextEq[slot]!, 1);
  if (item.twoHanded && slot === "main") {
    if (nextEq.off) addPack(nextPack, nextEq.off, 1);
    delete nextEq.off;
  }
  if (slot === "off" && itemById(nextEq.main)?.twoHanded) {
    addPack(nextPack, nextEq.main!, 1);
    delete nextEq.main;
  }
  if (item.armor === "shield" && slot === "off" && itemById(nextEq.main)?.twoHanded) {
    addPack(nextPack, nextEq.main!, 1);
    delete nextEq.main;
  }
  nextEq[slot] = itemId;
  return { equipped: nextEq, backpack: nextPack };
}

export function stowSlot(
  equipped: Equipped,
  backpack: PackEntry[],
  slot: GearSlot,
): { equipped: Equipped; backpack: PackEntry[] } {
  const nextEq = { ...equipped };
  const nextPack = backpack.map((p) => ({ ...p }));
  const id = nextEq[slot];
  if (id) {
    addPack(nextPack, id, 1);
    delete nextEq[slot];
  }
  return { equipped: nextEq, backpack: nextPack };
}

export function allowedSlots(item: GearItem): GearSlot[] {
  if (item.wear === "pack") return [];
  if (item.wear === "weapon") return item.twoHanded ? ["main"] : ["main", "off"];
  if (item.wear === "ring") return ["ring1", "ring2"];
  if (item.wear === "off") return ["off"];
  return [item.wear];
}

export function wornSummary(equipped: Equipped) {
  const bits = GEAR_SLOTS.map((s) => {
    const it = itemById(equipped[s.id]);
    return it ? `${s.label} ${it.name}` : null;
  }).filter(Boolean);
  return bits.length ? bits.join(" · ") : "全身未着装";
}

export function packSummary(pack: PackEntry[]) {
  const n = pack.reduce((s, p) => s + p.qty, 0);
  const gp = pack.find((p) => p.itemId === "gp")?.qty ?? 0;
  return `${n} 件` + (gp ? ` · ${gp} gp` : "");
}
