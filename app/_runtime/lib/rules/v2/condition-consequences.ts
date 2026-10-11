import { RulesValidationError } from "../errors";
import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState, EventEnvelope, JsonRecord } from "./model";
import { conditionHitPointLimits, conditionMechanics } from "./condition-mechanics";
import { releaseItemQuantity } from "./item-transitions";
import { concentrationLinkedEffectIds, dueWorldEffectDrafts, worldEffectEndDrafts, worldEffectsEndingWhen } from "./world-effects";
import { grappledBy, withoutGrapple } from "./contest";
import { helpRecords, isDodging, withoutDodge, withoutHelpFrom } from "./basic-actions";
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
    if("error" in released)throw new RulesValidationError("A condition-forced item drop could not preserve its canonical entry.");
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

type FollowupDraft={eventType:"ConditionStateSynchronized"|"ConcentrationEnded"|"CreatureDied"|"EffectEnded"|"ConditionChanged";payload:JsonRecord;visibilityPolicyId:string;secrecy:"internal"};
/** SPEC 0012 §6.3, SRD 5.1 Dodge: the benefit lasts until the start of the
 * creature's next turn or the end of the encounter, and is lost once the
 * creature is incapacitated or its speed drops to 0. */
function dodgeEndDrafts(state:AuthoritativeWorldState,entityIds:readonly string[]):FollowupDraft[] {
  return entityIds.filter(entityId=>isDodging(state.combatRuntime.entities[entityId]?.conditions)).map(entityId=>({
    eventType:"ConditionChanged",payload:{entityId,conditions:withoutDodge(state.combatRuntime.entities[entityId]!.conditions)},
    visibilityPolicyId:"visibility:room-authority-only",secrecy:"internal"}));
}
/** SPEC 0012 §6.3 (ADR 0099 decision 1), SRD 5.1 Help: the advantage a
 * helper gave lasts until that helper's next turn starts (`helperRef`), and
 * all help ends with the encounter (no helper). */
function helpEndDrafts(state:AuthoritativeWorldState,entityIds:readonly string[],helperRef?:string):FollowupDraft[] {
  return entityIds.filter(entityId=>helpRecords(state.combatRuntime.entities[entityId]?.conditions)
    .some(record=>helperRef===undefined||record.helperRef===helperRef)).map(entityId=>({
    eventType:"ConditionChanged",payload:{entityId,conditions:withoutHelpFrom(state.combatRuntime.entities[entityId]!.conditions,helperRef)},
    visibilityPolicyId:"visibility:room-authority-only",secrecy:"internal"}));
}
/** SPEC 0012 §10.2: the conditions a caster held by concentration end with it. */
function concentrationLinkEndDrafts(state:AuthoritativeWorldState,entityId:string):FollowupDraft[] {
  return worldEffectEndDrafts(state,concentrationLinkedEffectIds(state,entityId),"concentrationEnded");
}
/** SPEC 0012 §10.2: once its spell holds no condition any more -- each saved,
 * expired or was ended -- there is nothing left to concentrate on. */
function emptyConcentrationDrafts(state:AuthoritativeWorldState):FollowupDraft[] {
  return Object.keys(state.combatRuntime.entities).sort().filter(id=>{
    const concentration=state.combatRuntime.entities[id]?.concentration;
    return isRecord(concentration)&&concentration.linkedEffects===true&&concentrationLinkedEffectIds(state,id).length===0;
  }).map(id=>({eventType:"ConcentrationEnded",payload:{entityId:id,reason:"spellEnded"},
    visibilityPolicyId:"visibility:room-authority-only",secrecy:"internal"}));
}
export function conditionFollowupDrafts(state:AuthoritativeWorldState,event:EventEnvelope, scope: { timelineId?: string } = {}):FollowupDraft[] {
  if(event.eventType==="ConcentrationEnded")return concentrationLinkEndDrafts(state,String((event.payload as JsonRecord).entityId));
  // SPEC 0012 §10.1: a countered spell was still cast.
  if(event.eventType==="SpellCountered") {
    const caster=String((event.payload as JsonRecord).sourceEntityId);
    return worldEffectEndDrafts(state,worldEffectsEndingWhen(state,caster,"targetAttacksOrCasts").map(effect=>effect.effectId),"targetAttackedOrCast");
  }
  if(event.eventType==="EncounterConcluded") {
    const participants=state.combatRuntime.encounters[String((event.payload as JsonRecord).encounterId)]?.participantEntityIds;
    const ids=Array.isArray(participants)?participants.filter(isNonEmptyString).sort():[];
    return [...dodgeEndDrafts(state,ids),...helpEndDrafts(state,ids),
      ...dueWorldEffectDrafts(state,scope)];
  }
  if(["FictionTimeAdvanced","RoundEnded"].includes(event.eventType))return dueWorldEffectDrafts(state,scope);
  if(event.eventType==="TurnStarted"||event.eventType==="TurnEnded") {
    const payload=event.payload as JsonRecord;
    const encounter=state.combatRuntime.encounters[String(payload.encounterId)];
    const participants=Array.isArray(encounter?.participantEntityIds)?encounter.participantEntityIds.filter(isNonEmptyString).sort():[];
    return [...(event.eventType==="TurnStarted"?dodgeEndDrafts(state,[String(payload.sourceEntityId)]):[]),
      ...(event.eventType==="TurnStarted"?helpEndDrafts(state,participants,String(payload.sourceEntityId)):[]),
      ...dueWorldEffectDrafts(state,{...scope,turn:{entityId:String(payload.sourceEntityId),
        edge:event.eventType==="TurnStarted"?"turnStart":"turnEnd",encounterId:String(payload.encounterId),
        round:Number(payload.round??encounter?.round)}})];
  }
  if(!["EffectApplied","EffectEnded","ConditionChanged","DamagePacketResolved","DeathSaveResolved"].includes(event.eventType))return [];
  const payload=event.payload as JsonRecord;
  const ref=isRecord(payload.effect)?payload.effect.targetEntityId
    :payload.targetEntityId??payload.entityId;
  const lostDodge=isNonEmptyString(ref)&&isDodging(state.combatRuntime.entities[ref]?.conditions)
    &&(conditionMechanics(state,ref).incapacitated||conditionMechanics(state,ref).speedIsZero)?dodgeEndDrafts(state,[ref]):[];
  const spellEnded=event.eventType==="EffectEnded"?emptyConcentrationDrafts(state):[];
  if(!isNonEmptyString(ref)||state.entities[ref]===undefined)return [...lostDodge,...spellEnded,...(event.eventType==="EffectEnded"?dueWorldEffectDrafts(state,scope):[])];
  const policy={visibilityPolicyId:"visibility:room-authority-only",secrecy:"internal" as const};
  const drafts:FollowupDraft[]=[...lostDodge];
  const sync=planConditionStateSynchronization(state,ref);
  if(sync!==undefined)drafts.push({eventType:"ConditionStateSynchronized",payload:sync.payload,...policy});
  const facts=conditionMechanics(state,ref);
  if(facts.concentrationMustEnd&&isRecord(state.combatRuntime.entities[ref]?.concentration))drafts.push({
    eventType:"ConcentrationEnded",payload:{entityId:ref,reason:"incapacitated2014"},...policy});
  // SPEC 0004 §4, SRD 5.1: an incapacitated grappler lets go of whoever it held.
  if(facts.incapacitated)for(const targetId of grappledBy(state,ref))drafts.push({eventType:"ConditionChanged",
    payload:{entityId:targetId,conditions:withoutGrapple(state.combatRuntime.entities[targetId]!.conditions)},...policy});
  if(facts.exhaustion>=6&&state.entities[ref]?.tenureStatus!=="dead")drafts.push({
    eventType:"CreatureDied",payload:{characterId:ref,causeId:event.rootActionId},...policy});
  if(event.eventType==="EffectEnded")drafts.push(...spellEnded,...dueWorldEffectDrafts(state,scope));
  return drafts;
}
