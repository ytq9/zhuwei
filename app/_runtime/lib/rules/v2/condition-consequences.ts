import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState, EventEnvelope, JsonRecord } from "./model";
import { conditionHitPointLimits, conditionMechanics } from "./condition-mechanics";
import { releaseItemQuantity } from "./item-transitions";
import { dueWorldEffectDrafts } from "./world-effects";
import { hasExactKeys, isNonEmptyString, isRecord, isSha256 } from "./validation";

export type ConditionStateSynchronizedPayload = {
  characterId:string;
  hitPoints:{before:{current:number;maximum:number};after:{current:number;maximum:number}};
  unconditionedMaximum:number|null;
  droppedEntryRefs:string[];
  fallsProne:boolean;
  itemSystemHash:string;
};

/** Consequences are derived from active conditions and canonical ItemEntries.
 * No model can supply a patch or elect to keep holding an object while unconscious. */
export function planConditionStateSynchronization(state:AuthoritativeWorldState,characterId:string) {
  const character=state.entities[characterId];
  if(character?.hitPoints===undefined)return undefined;
  const combat=state.combatRuntime.entities[characterId];
  const facts=conditionMechanics(state,characterId);
  const priorBase=combat?.unconditionedHitPointMaximum;
  const base=Number(priorBase??character.hitPoints.maximum);
  const limits=conditionHitPointLimits(state,characterId,base,character.hitPoints.current);
  const after={current:limits.diesFromExhaustion?0:limits.current,maximum:limits.maximum};
  const unconditionedMaximum=facts.hitPointMaximumHalved?base:null;
  const fallsProne=facts.conditions.unconscious===true
    && (!isRecord(combat?.conditions)||combat.conditions.prone!==true);
  let itemSystem=state.campaignRuntime.itemSystem;
  const droppedEntryRefs=Object.values(itemSystem.entries).filter(entry=>facts.dropHeldObjects
    &&entry.disposition==="held"&&entry.holderRef===characterId
    &&(entry.equippedSlot==="main"||entry.equippedSlot==="off")).map(entry=>entry.entryId).sort();
  for(const entryId of droppedEntryRefs) {
    const entry=itemSystem.entries[entryId]!;
    const released=releaseItemQuantity(itemSystem,{entryId,holderRef:characterId,sceneRef:character.sceneId,quantity:entry.quantity});
    if("error" in released)throw new TypeError("A condition-forced item drop could not preserve its canonical entry.");
    itemSystem=released.itemSystem;
  }
  if(!fallsProne&&droppedEntryRefs.length===0&&after.current===character.hitPoints.current&&after.maximum===character.hitPoints.maximum
    &&(priorBase??null)===unconditionedMaximum)return undefined;
  const payload:ConditionStateSynchronizedPayload={characterId,hitPoints:{before:{...character.hitPoints},after},
    unconditionedMaximum,droppedEntryRefs,fallsProne,itemSystemHash:canonicalSha256(itemSystem)};
  return {payload,itemSystem};
}

export function isConditionStateSynchronizedPayload(value:unknown):value is ConditionStateSynchronizedPayload {
  if(!isRecord(value)||!hasExactKeys(value,["characterId","hitPoints","unconditionedMaximum","droppedEntryRefs","fallsProne","itemSystemHash"])
    ||!isNonEmptyString(value.characterId)||!isRecord(value.hitPoints)||!hasExactKeys(value.hitPoints,["before","after"])
    ||typeof value.fallsProne!=="boolean"
    ||!(value.unconditionedMaximum===null||Number.isSafeInteger(value.unconditionedMaximum)&&Number(value.unconditionedMaximum)>=0)
    ||!Array.isArray(value.droppedEntryRefs)||!value.droppedEntryRefs.every(isNonEmptyString)||!isSha256(value.itemSystemHash))return false;
  return [value.hitPoints.before,value.hitPoints.after].every(hp=>isRecord(hp)&&hasExactKeys(hp,["current","maximum"])
    &&Number.isSafeInteger(hp.current)&&Number(hp.current)>=0&&Number.isSafeInteger(hp.maximum)&&Number(hp.maximum)>=0&&Number(hp.current)<=Number(hp.maximum));
}

type FollowupDraft={eventType:"ConditionStateSynchronized"|"ConcentrationEnded"|"CreatureDied"|"EffectEnded";payload:JsonRecord;visibilityPolicyId:string;secrecy:"internal"};
export function conditionFollowupDrafts(state:AuthoritativeWorldState,event:EventEnvelope, scope: { timelineId?: string } = {}):FollowupDraft[] {
  if(["FictionTimeAdvanced","RoundEnded","EncounterConcluded"].includes(event.eventType))return dueWorldEffectDrafts(state,scope);
  if(event.eventType==="TurnStarted"||event.eventType==="TurnEnded") {
    const payload=event.payload as JsonRecord;
    const encounter=state.combatRuntime.encounters[String(payload.encounterId)];
    return dueWorldEffectDrafts(state,{...scope,turn:{entityId:String(payload.sourceEntityId),
      edge:event.eventType==="TurnStarted"?"turnStart":"turnEnd",encounterId:String(payload.encounterId),
      round:Number(payload.round??encounter?.round)}});
  }
  if(!["EffectApplied","EffectEnded","ConditionChanged","DamagePacketResolved","DeathSaveResolved"].includes(event.eventType))return [];
  const payload=event.payload as JsonRecord;
  const ref=isRecord(payload.effect)?payload.effect.targetEntityId
    :payload.targetEntityId??payload.entityId;
  if(!isNonEmptyString(ref)||state.entities[ref]===undefined)return event.eventType==="EffectEnded"?dueWorldEffectDrafts(state,scope):[];
  const policy={visibilityPolicyId:"visibility:room-authority-only",secrecy:"internal" as const};
  const drafts:FollowupDraft[]=[];
  const sync=planConditionStateSynchronization(state,ref);
  if(sync!==undefined)drafts.push({eventType:"ConditionStateSynchronized",payload:sync.payload,...policy});
  const facts=conditionMechanics(state,ref);
  if(facts.concentrationMustEnd&&isRecord(state.combatRuntime.entities[ref]?.concentration))drafts.push({
    eventType:"ConcentrationEnded",payload:{entityId:ref,reason:"incapacitated2014"},...policy});
  if(facts.exhaustion>=6&&state.entities[ref]?.tenureStatus!=="dead")drafts.push({
    eventType:"CreatureDied",payload:{characterId:ref,causeId:event.rootActionId},...policy});
  if(event.eventType==="EffectEnded")drafts.push(...dueWorldEffectDrafts(state,scope));
  return drafts;
}
