/** The roll a table shows a player while it waits for the click. The legacy
 * KP that once filled these rows is retired; the Room-owned authority fills
 * them now, and the table and boost helpers read them. */
export type RollKind = "check" | "save" | "attack" | "init" | "damage" | "death" | "heal";

export type PendingRoll = {
  id: string;
  userId: string;
  name: string;
  ability: string;
  skill?: string;
  kind?: RollKind;
  dc: number;
  reason: string;
  advantage?: boolean;
  disadvantage?: boolean;
  dice?: string;
  targetId?: string;
  sneakOk?: boolean;
  /** 双轨检定绑定的线索。失败停在免费层，成功给完整层。 */
  clueId?: string;
  result?: {
    d20: number;
    total: number;
    success: boolean;
    bonus?: number;
    parts?: string[];
    effectNote?: string;
  };
  /** V3 Room-owned roll: the click authorizes generation but supplies no face
   * or optional legacy boost. */
  authoritative?: true;
};
