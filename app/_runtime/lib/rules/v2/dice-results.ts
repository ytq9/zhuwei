import type { AuthoritativeWorldState, EventEnvelope, JsonRecord, ObserverDeltaChange } from "./model";
import { spatialRecordVisibleTo } from "./spatial-visibility";
import { isNonEmptyString, isRecord } from "./validation";

const record = (value: unknown): JsonRecord => isRecord(value) ? value : {};
const number = (value: unknown): number | undefined =>
  (typeof value === "number" || typeof value === "string") && value !== "" && Number.isFinite(Number(value))
    ? Number(value) : undefined;

/** Display only committed mechanical outcomes. Internal requests, unused
 * candidate dice, hidden reality, DC bases and state patches never leave Rules. */
export function observerDiceResults(
  state: AuthoritativeWorldState,
  events: readonly EventEnvelope[],
  viewerId: string,
  eventVisible: (event: EventEnvelope) => boolean,
  evidenceEvents: readonly EventEnvelope[] = events,
): ObserverDeltaChange[] {
  const results: ObserverDeltaChange[] = [];
  for (const event of events) {
    const payload = record(event.payload);
    const add = (suffix: string, owner: unknown, label: string, checkValue: unknown, ownCheck = false, sceneOutcome = false) => {
      if (!isNonEmptyString(owner)) return;
      const entity = state.entities[owner] ?? state.combatRuntime.entities[owner];
      if (entity === undefined) return;
      const own = owner === viewerId;
      if (!own && (entity.sceneId !== state.entities[viewerId]?.sceneId
        || !spatialRecordVisibleTo(state, state.combatRuntime.entities[owner] ?? entity, viewerId))) return;
      const observedNpcAction = ownCheck && entity.kind === "npc" && evidenceEvents.some(candidate => {
        const action = record(candidate.payload);
        return candidate.eventType === "NpcActionCommitted" && candidate.rootActionId === event.rootActionId
          && action.npcId === owner && evidenceEvents.some(trace => trace.eventType === "CanonicalFactDeclared"
            && record(record(trace.payload).fact).id === action.traceFactRef && eventVisible(trace));
      });
      if (!(ownCheck && own) && !observedNpcAction && !sceneOutcome && !eventVisible(event)) return;
      const check = record(checkValue);
      const selected = number(check.selectedRoll ?? check.selectedFace ?? check.selected ?? check.roll ?? check.natural);
      const faces = Array.isArray(check.rolls) ? check.rolls.map(number).filter((n): n is number => n !== undefined)
        : selected === undefined ? [] : [selected];
      if (faces.length === 0) return;
      const total = number(check.total);
      const modifier = number(check.modifier) ?? (total !== undefined && selected !== undefined ? total - selected : undefined);
      const succeeded = check.succeeded ?? check.success ?? check.hit;
      const selection = selected !== undefined && faces.length > 1 ? `，取 ${selected}` : "";
      const adjustment = modifier === undefined ? "" : `，修正 ${modifier >= 0 ? "+" : ""}${modifier}`;
      const result = total === undefined ? "" : `，合计 ${total}`;
      const verdict = typeof succeeded === "boolean" ? `，${succeeded ? "成功" : "失败"}` : "";
      results.push({ kind: "diceRolled", messageId: `roll:${event.eventId}:${suffix}`,
        characterId: owner, speakerName: entity.name ?? "角色", sceneId: entity.sceneId,
        body: `${entity.kind === "npc" ? "系统代骰 · " : ""}${label}：${check.formula ?? "d20"} [${faces.join(", ")}]${selection}${adjustment}${result}${verdict}`,
        sourceEventSeq: event.eventSeq });
    };
    switch (event.eventType) {
      case "WorldInteractionResolved":
        add("check", payload.actorCharacterId, record(payload.check).resolutionKind === "attack" ? "攻击检定" : "检定", payload.check, true);
        for (const [index, effect] of (Array.isArray(payload.appliedEffects) ? payload.appliedEffects : []).entries()) {
          if (isRecord(effect) && effect.kind === "rollResult")
            add(`effect:${index}`, effect.characterId, effect.rollKind === "save" ? "豁免检定" : "攻击检定", effect, true, true);
        }
        break;
      case "ImprovisedCheckResolved":
        add("check", record(payload.request).actorCharacterId, "检定", payload, true);
        break;
      case "SocialCheckResolved":
        add("social", payload.actorCharacterId, "社交检定", { ...payload, rolls: payload.rolls }, true);
        break;
      case "ContestResolved":
        add("initiator", payload.initiatorId, "对抗检定", { rolls: payload.initiatorRolls, total: payload.initiatorTotal });
        add("defender", payload.defenderId, "对抗检定", { rolls: payload.defenderRolls, total: payload.defenderTotal });
        break;
      case "AbilityInvoked": {
        const mechanical = record(payload.mechanicalResult);
        add("attack", payload.sourceEntityId, "攻击检定", mechanical.attack);
        for (const [target, attack] of Object.entries(record(mechanical.attacks))) add(`attack:${target}`, payload.sourceEntityId, "攻击检定", attack);
        for (const [target, save] of Object.entries(record(mechanical.saves))) add(`save:${target}`, target, "豁免检定", save);
        add("check", payload.sourceEntityId, "检定", mechanical.check);
        add("medicine", payload.sourceEntityId, "医疗检定", mechanical.medicine);
        break;
      }
      case "EnvironmentFeatureDamaged":
        add("attack", payload.actorCharacterId, "攻击检定", { rolls: payload.attackRolls, selectedRoll: payload.selectedAttackRoll,
          modifier: payload.attackBonus, total: payload.attackTotal, hit: payload.hit });
        break;
      case "EnvironmentAreaTargetResolved":
        add("save", payload.targetEntityId, "豁免检定", { rolls: payload.saveRolls, selectedRoll: payload.selectedSaveRoll,
          modifier: payload.saveModifier, total: payload.saveTotal, succeeded: payload.saveSucceeded });
        break;
      case "ConcentrationTested":
        add("concentration", payload.entityId, "专注豁免", payload, true);
        break;
      case "DeathSaveResolved":
        add("death", payload.entityId, `死亡豁免（累计成功 ${payload.successes}，失败 ${payload.failures}）`, payload, true);
        break;
      case "HealingResolved":
      case "TemporaryHitPointsGranted":
        add("recovery", record(payload.rollResult).sourceEntityId,
          event.eventType === "HealingResolved" ? "恢复骰" : "临时生命值骰", payload.rollResult);
        break;
      case "SpellResolved":
        add("spell-check", payload.sourceEntityId, "法术检定", payload.outcome);
        break;
      case "InitiativeEstablished":
        for (const entry of Array.isArray(payload.entries) ? payload.entries.filter(isRecord) : []) {
          for (const id of Array.isArray(entry.combatantEntityIds) ? entry.combatantEntityIds : []) add(`initiative:${id}`, id, "先攻", entry);
        }
        break;
    }
  }
  return results;
}
