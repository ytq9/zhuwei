import { conditionSavingThrow,conditionAttack,conditionMechanics,conditionSourceRefs } from "./condition-mechanics";
import { entitiesAffectedByArea, rectangularFeatureEntity, entitiesWithinRange, entityWithinPointRange, entityDistanceSquared,
  canonicalCombatPoint, canonicalCombatDirection, freezeAreaOrigin, coverLevel } from "../profiles/combat-geometry";
import { canonicalSha256 } from "../profiles/canonical";
import { frozenRegisteredAbilityOperation } from "../profiles/ability-compiler";
import { combatAttackBonus, attackArmorClass } from "../profiles/attack-resolution";
import { WORLD_DAMAGE_PROFILE_REGISTRY } from "../profiles/world-interaction-registry";
import type { RuntimeProfileManifest } from "../profiles/types";
import type { AuthoritativeWorldState, JsonRecord } from "./model";
import type { AppliedWorldInteractionEffect, WorldInteractionBranch, WorldInteractionRegisteredHazardEffect, WorldInteractionResolutionPlan } from "./world-interaction-model";
import type { WorldInteractionDiceSpec } from "./world-interaction-randomness";
import { parseDamageFormula, rolledDamageComponents, worldDamageTarget } from "./damage";
import { environmentHazardMechanics } from "./environment-hazards";
import { hazardTriggerIsActive } from "./hazard-lifecycle";
import { isStoredSemanticDefinition } from "./semantic-definitions";
import { authorityRefBoundToScene } from "./authority-bindings";
import { savingThrowModifier, type ProficiencyAbility } from "./proficiency";
import { isRecord, isNonEmptyString } from "./validation";

export type HazardMechanics = {
  definition: JsonRecord;
  fixedDamage: Array<{type:string;rolled:number}>;
  effects: JsonRecord[];
  save: JsonRecord | null;
  attack: JsonRecord | null;
};

export function hazardMechanics(state: AuthoritativeWorldState, effect: WorldInteractionRegisteredHazardEffect): HazardMechanics | undefined {
  if (effect.damage.kind === "profile") {
    const profile = WORLD_DAMAGE_PROFILE_REGISTRY[effect.damage.damageProfileRef];
    return profile === undefined ? undefined : {definition:{},fixedDamage:[{type:profile.damageType,rolled:profile.amount}],effects:[],save:null,attack:null};
  }
  const definition = environmentHazardMechanics(state.campaignRuntime.definitions, state.campaignRuntime.definitions[effect.damage.hazardDefinitionRef]);
  if (definition === undefined) return undefined;
  // Effects are read from the registered artifact; validation of the artifact
  // binds these source fields to exactly the operations that were frozen.
  const effects = [definition.effect, ...(Array.isArray(definition.effects) ? definition.effects : [])].filter(isRecord);
  const fixedDamage: Array<{type:string;rolled:number}> = [];
  for (const effectValue of effects) {
    if (effectValue.kind === "fixedDamage") {
      if (!Number.isSafeInteger(effectValue.amount) || Number(effectValue.amount) < 0 || !isNonEmptyString(effectValue.damageType)) return undefined;
      fixedDamage.push({type:effectValue.damageType,rolled:Number(effectValue.amount)});
    } else if (effectValue.kind !== "grantEffect" && effectValue.kind !== "endEffect") return undefined;
  }
  if (Array.isArray(definition.damage) && definition.damage.some((component) => !isRecord(component) || !isNonEmptyString(component.type) || parseDamageFormula(component.formula) === undefined)) return undefined;
  const save = frozenRegisteredAbilityOperation(definition,"Random","/save")?.input ?? null;
  const attack = frozenRegisteredAbilityOperation(definition,"Random","/attack")?.input ?? null;
  if (save !== null && (!['str','dex','con','int','wis','cha'].includes(String(save.ability)) || !Number.isSafeInteger(Number(save.dc)))) return undefined;
  if (attack !== null && !(attack.kind === "fixed"
    ? typeof attack.bonus === "string" && /^-?(0|[1-9][0-9]*)$/.test(attack.bonus) && Number.isSafeInteger(Number(attack.bonus))
    : attack.kind === "spellAttack" || (attack.kind === undefined
      && ['str','dex','con','int','wis','cha'].includes(String(attack.ability)) && typeof attack.proficiency === "boolean"))) return undefined;
  if (fixedDamage.length === 0 && !Array.isArray(definition.damage) && effects.length === 0) return undefined;
  return { definition, fixedDamage, effects:effects.filter((value)=>value.kind!=="fixedDamage"), save, attack };
}

export function hazardTarget(state:AuthoritativeWorldState,_profiles:RuntimeProfileManifest,targetRef:string):JsonRecord|undefined {
  return worldDamageTarget(state,targetRef);
}

function hazardSource(state:AuthoritativeWorldState,sceneRef:string,sourceRef:string):JsonRecord|undefined {
  const creature=state.combatRuntime.entities[sourceRef];
  if(creature!==undefined)return creature;
  const definition=state.campaignRuntime.definitions[sourceRef];
  const refs=isRecord(definition?.content)&&Array.isArray(definition.content.mechanicDefinitionRefs)
    ?definition.content.mechanicDefinitionRefs:[];
  const scene=state.combatRuntime.scenes[sceneRef];
  const obstacles=isRecord(scene?.geometry)&&Array.isArray(scene.geometry.obstacles)?scene.geometry.obstacles:[];
  const features=obstacles.filter(feature=>isRecord(feature)&&refs.includes(feature.featureId));
  if(features.length!==1||!isRecord(features[0]))return undefined;
  const source=rectangularFeatureEntity(features[0],sceneRef);
  return source===undefined?undefined:{...source,id:sourceRef,entityId:sourceRef,featureId:features[0].featureId};
}

function hazardCover(state:AuthoritativeWorldState,sceneRef:string,source:JsonRecord,target:JsonRecord) {
  const scene=structuredClone(state.combatRuntime.scenes[sceneRef]);
  if(isRecord(scene?.geometry)&&Array.isArray(scene.geometry.obstacles))scene.geometry.obstacles=
    scene.geometry.obstacles.filter(feature=>!isRecord(feature)||feature.featureId!==source.featureId);
  return coverLevel(scene,source,target,[]);
}

function canonicalNumber(value: unknown): boolean {
  return (typeof value === "number" || (typeof value === "string" && /^-?(0|[1-9][0-9]*)$/.test(value)))
    && Number.isSafeInteger(Number(value));
}

function hazardAttackSource(state: AuthoritativeWorldState, sceneRef: string, sourceRef: string, attack: JsonRecord) {
  const source = hazardSource(state, sceneRef, sourceRef);
  if (source === undefined || !isRecord(source.position) || !isRecord(source.footprint)) return undefined;
  if (attack.kind === "fixed") return source;
  if (attack.kind === "spellAttack") return isRecord(source.spellcasting)
    && canonicalNumber(source.spellcasting.spellAttackBonus) ? source : undefined;
  return isRecord(source.stats) && canonicalNumber(source.stats[String(attack.ability)])
    && (!attack.proficiency || canonicalNumber(source.proficiencyBonus)) ? source : undefined;
}

function hazardFearSources(state: AuthoritativeWorldState, sceneRef: string, sourceRef: string) {
  const source = hazardSource(state, sceneRef, sourceRef);
  const refs = conditionSourceRefs(state, sourceRef, "frightened");
  if (refs.length === 0) return [];
  if (source === undefined || !isRecord(source.position) || !isRecord(source.footprint)
    || !isRecord(state.combatRuntime.scenes[sceneRef]?.geometry)) return undefined;
  const visible: string[] = [];
  for (const ref of refs) {
    const target = hazardSource(state, sceneRef, ref);
    if (target === undefined || !isRecord(target.position) || !isRecord(target.footprint)) return undefined;
    if (target.sceneId === source.sceneId && conditionMechanics(state, sourceRef).canSee
      && conditionMechanics(state, ref).conditions.invisible !== true
      && hazardCover(state, sceneRef, source, target) !== "full") visible.push(ref);
  }
  return visible;
}

function hazardTargetsInRangeAndSight(
  state: AuthoritativeWorldState, sceneRef: string, effect: WorldInteractionRegisteredHazardEffect,
  targetDefinition: unknown, targets: readonly { targetRef: string; relationRefs: readonly string[] }[],
  reserveConditionalTargets: boolean,
) {
  // Legacy profile damage has no Ability target. An authored target's frozen
  // range and sight requirements constrain the zone membership as well.
  if (!isRecord(targetDefinition)) return targets;
  const source = hazardSource(state, sceneRef, effect.sourceDefinitionRef);
  if (source === undefined || canonicalCombatPoint(source.position) === undefined || !isRecord(source.footprint)
    || !isRecord(state.combatRuntime.scenes[sceneRef]?.geometry)) return undefined;
  const distance = ["rangeLongInches", "rangeInches", "rangeNormalInches", "reachInches"]
    .map(key => targetDefinition[key]).find(value => value !== undefined);
  if (distance !== undefined && (!canonicalNumber(distance) || Number(distance) < 0)) return undefined;
  try {
    const eligible: typeof targets[number][] = [];
    for (const candidate of targets) {
      const target = state.combatRuntime.entities[candidate.targetRef];
      if (target === undefined || canonicalCombatPoint(target.position) === undefined || !isRecord(target.footprint)) return undefined;
      // Validate even excluded occupants: unknown geometry is a missing causal
      // fact, while complete geometry can establish that a creature is outside.
      if (distance === undefined) entityDistanceSquared(source, target);
      else if (!entitiesWithinRange(source, target, String(distance))) continue;
      if (targetDefinition.requiresSight === true && (hazardCover(state, sceneRef, source, target) === "full"
        || !reserveConditionalTargets && (!conditionMechanics(state, effect.sourceDefinitionRef).canSee
          || conditionMechanics(state, candidate.targetRef).conditions.invisible === true))) continue;
      eligible.push(candidate);
    }
    return eligible;
  } catch { return undefined; }
}

export function registeredHazardTargets(state: AuthoritativeWorldState,sceneRef:string,effect:WorldInteractionRegisteredHazardEffect,
  options: {reserveConditionalTargets?:boolean} = {}): readonly {targetRef:string;relationRefs:readonly string[]}[] | undefined {
  if (hazardMechanics(state,effect) === undefined || !(isStoredSemanticDefinition(state.campaignRuntime.definitions[effect.sourceDefinitionRef])
      || state.entities[effect.sourceDefinitionRef] !== undefined && state.combatRuntime.entities[effect.sourceDefinitionRef] !== undefined)
    || !isStoredSemanticDefinition(state.campaignRuntime.definitions[effect.zoneRef])
    || !authorityRefBoundToScene(state,effect.sourceDefinitionRef,sceneRef) || !authorityRefBoundToScene(state,effect.zoneRef,sceneRef)) return undefined;
  const mechanics=hazardMechanics(state,effect)!;
  if (mechanics.attack !== null && hazardAttackSource(state,sceneRef,effect.sourceDefinitionRef,mechanics.attack) === undefined) return undefined;
  if(effect.damage.kind==="authored") {
    const hazard=state.campaignRuntime.definitions[effect.damage.hazardDefinitionRef];
    const trigger=isRecord(hazard?.content)?hazard.content.trigger:undefined;
    if(!isRecord(trigger)||trigger.ref!==(trigger.kind==="enterZone"?effect.zoneRef:effect.sourceDefinitionRef)
      || !hazardTriggerIsActive(state,hazard))return undefined;
  }
  const abilityTarget=mechanics.definition.target;
  if(isRecord(abilityTarget)&&abilityTarget.kind==="area") {
    if(effect.damage.kind!=="authored"||effect.damage.area===undefined)return undefined;
    try {
      const source=hazardSource(state,sceneRef,effect.sourceDefinitionRef);
      const origin=canonicalCombatPoint(effect.damage.area.origin);
      if(source===undefined||origin===undefined)return undefined;
      const sourcePoint=canonicalCombatPoint(source.position);
      const directional=isRecord(abilityTarget.shape)&&["cube","cone","line"].includes(String(abilityTarget.shape.kind));
      if(directional?canonicalCombatDirection(effect.damage.area.direction)===undefined:effect.damage.area.direction!==undefined)return undefined;
      if(abilityTarget.rangeInches===undefined?canonicalSha256(origin)!==canonicalSha256(sourcePoint)
        :!entityWithinPointRange(source,origin,String(abilityTarget.rangeInches)))return undefined;
      if(freezeAreaOrigin(state.combatRuntime.scenes[sceneRef],source,origin)===undefined)return undefined;
      const ids=entitiesAffectedByArea(Object.values(state.combatRuntime.entities).filter(entity=>entity.sceneId===sceneRef),
        state.combatRuntime.scenes[sceneRef],effect.damage.area.origin,abilityTarget.shape,effect.damage.area.direction);
      return ids.filter(id=>state.entities[id]?.tenureStatus==="active").map(targetRef=>({targetRef,relationRefs:[]}));
    } catch { return undefined; }
  }
  if(effect.damage.kind==="authored"&&effect.damage.area!==undefined)return undefined;
  const targets = new Map<string,string[]>();
  for (const [ref,definition] of Object.entries(state.campaignRuntime.definitions).sort(([a],[b])=>a.localeCompare(b))) {
    if (!isStoredSemanticDefinition(definition) || definition.semanticKind!=="worldRelation" || !isRecord(definition.content)) continue;
    const c = definition.content;
    if(c.kind!=="contains" || c.relationRef!==ref || c.subjectRef!==effect.zoneRef || c.state!=="active" || !isNonEmptyString(c.objectRef)) continue;
    const target = state.entities[c.objectRef];
    if (target?.tenureStatus!=="active" || target.sceneId!==sceneRef || target.hitPoints===undefined) continue;
    targets.set(c.objectRef,[...(targets.get(c.objectRef)??[]),ref]);
  }
  const reachable = hazardTargetsInRangeAndSight(state, sceneRef, effect, abilityTarget,
    [...targets].sort(([a],[b])=>a.localeCompare(b)).map(([targetRef,relationRefs])=>({targetRef,relationRefs})),options.reserveConditionalTargets===true);
  return reachable;
}

export function hazardOccurrence(plan: WorldInteractionResolutionPlan, branch: "success"|"failure",index:number):string {
  return `hazard:${plan.resolutionId}:${branch}:${index}`;
}

export function hazardDiceSpecs(profiles:RuntimeProfileManifest,state:AuthoritativeWorldState,plan:WorldInteractionResolutionPlan,branches:readonly ("success"|"failure")[] = plan.ruling.kind === "check" ? ["success","failure"] : ["success"]):WorldInteractionDiceSpec[] {
  const specs:WorldInteractionDiceSpec[]=[];
  for(const branchName of branches) {
    const branch=plan.branches[branchName];
    for(const [index,effect] of branch.effects.entries()) {
      if(effect.kind!=="registeredHazard")continue;
      // A preceding outcome may change visibility, roll mode, or concentration.
      // Reserve the spatially eligible population before any outcome is known.
      const mechanics=hazardMechanics(state,effect), targets=registeredHazardTargets(state,plan.sceneRef,effect,{reserveConditionalTargets:true});
      if(mechanics===undefined||targets===undefined)throw new TypeError("registered hazard mechanics are not executable");
      if(targets.length===0)continue;
      const key=hazardOccurrence(plan,branchName,index);
      const damage=Array.isArray(mechanics.definition.damage)?mechanics.definition.damage:[];
      for(const [componentIndex,componentValue] of damage.entries()) {
        const component=componentValue as JsonRecord;
        const f=parseDamageFormula(component.formula)!;
        const recipients=component.sharedAcrossTargets===false?targets.map(target=>target.targetRef):[null];
        for(const recipient of recipients)specs.push({purposeKey:`${key}:damage:${componentIndex}${recipient===null?"":`:${recipient}`}`,
          dice:[{count:String(f.count),sides:String(f.sides)}],frozenParameters:{component:structuredClone(component),
            targetRef:recipient,definitionHash:canonicalSha256(mechanics.definition)}});
        if(mechanics.attack!==null)for(const {targetRef} of targets)specs.push({purposeKey:`${key}:critical:${componentIndex}:${targetRef}`,
          dice:[{count:String(f.count),sides:String(f.sides)}],frozenParameters:{component:structuredClone(component),targetRef,
            definitionHash:canonicalSha256(mechanics.definition)}});
      }
      for(const {targetRef} of targets) {
        const target=hazardTarget(state,profiles,targetRef);
        if(target===undefined)throw new TypeError("hazard target mechanics unavailable");
        if(damage.length>0||mechanics.fixedDamage.some(component=>component.rolled>0)) {
          const modifier=savingThrowModifier(profiles,target,"con");
          if(modifier===undefined)throw new TypeError("Hazard concentration saving throw is unavailable.");
          specs.push({purposeKey:`${key}:concentration:${targetRef}`,
            dice:[{count:"2",sides:"20"}],
            frozenParameters:{targetRef,modifier,definitionHash:canonicalSha256(mechanics.definition)}});
        }
        if(mechanics.save!==null) {
          const ability=String(mechanics.save.ability);
          const modifier=savingThrowModifier(profiles,target,ability as ProficiencyAbility);
          if(modifier===undefined)throw new TypeError("hazard target saving throw is unavailable");
          specs.push({purposeKey:`${key}:save:${targetRef}`,dice:[{count:"2",sides:"20"}],frozenParameters:{targetRef,ability,dc:Number(mechanics.save.dc),modifier,halfOnSuccess:mechanics.save.halfOnSuccess===true}});
        }
        if(mechanics.attack!==null) {
          const sourceEntity=hazardAttackSource(state,plan.sceneRef,effect.sourceDefinitionRef,mechanics.attack);
          if(sourceEntity===undefined)throw new TypeError("Hazard attack source mechanics or geometry is unavailable.");
          const cover=hazardCover(state,plan.sceneRef,sourceEntity,target);
          const bonus=cover==="half"?2:cover==="threeQuarters"?5:0;
          specs.push({purposeKey:`${key}:attack:${targetRef}`,dice:[{count:"2",sides:"20"}],
            frozenParameters:{targetRef,modifier:combatAttackBonus(sourceEntity,mechanics.definition),
              sourceRef:effect.sourceDefinitionRef,sceneRef:plan.sceneRef,
              withinFiveFeet:entitiesWithinRange(sourceEntity,target,"60"),coverBonus:bonus,blocked:cover==="full"}});
        }
      }
    }
  }
  return specs;
}

function conditionRollFace(rolls:readonly number[],mode:"normal"|"advantage"|"disadvantage"):number {
  if(rolls.length!==2)throw new TypeError("Hazard condition roll requires its two reserved faces.");
  return mode==="normal"?rolls[0]!:mode==="disadvantage"?Math.min(...rolls):Math.max(...rolls);
}

/** The save is reserved before the hit or damage is known; only actual
 * applied damage determines its 2014 DC. Incapacitation has already ended
 * concentration through the common condition consequence fold. */
export function hazardConcentrationDrafts(state:AuthoritativeWorldState,targetRef:string,key:string,
  specs:readonly WorldInteractionDiceSpec[],faces:ReadonlyMap<string,readonly number[]>,appliedDamage:number,sourceAbilityRef:string) {
  if(appliedDamage<=0||!isRecord(state.combatRuntime.entities[targetRef]?.concentration))return [];
  const purposeKey=`${key}:concentration:${targetRef}`;
  const spec=specs.find(spec=>spec.purposeKey===purposeKey),rolls=faces.get(purposeKey);
  if(spec===undefined||rolls===undefined||rolls.length===0)throw new TypeError("Hazard concentration reserve is unavailable.");
  const roll=conditionRollFace(rolls,conditionSavingThrow(state,targetRef,"con").mode);
  const modifier=Number(spec.frozenParameters.modifier),dc=Math.max(10,Math.floor(appliedDamage/2));
  const total=roll+modifier,succeeded=total>=dc;
  return [{eventType:"ConcentrationTested" as const,
    payload:{entityId:targetRef,causeFactId:sourceAbilityRef,dc,modifier,roll,total,succeeded},
    visibilityPolicyId:"visibility:room-authority-only",secrecy:"internal" as const},
    ...(!succeeded?[{eventType:"ConcentrationEnded" as const,payload:{entityId:targetRef,reason:"failedDamageSave"},
      visibilityPolicyId:"visibility:room-authority-only",secrecy:"internal" as const}]:[])];
}

export function hazardDamageForTarget(mechanics:HazardMechanics,key:string,targetRef:string,specs:readonly WorldInteractionDiceSpec[],faces:ReadonlyMap<string,readonly number[]>,currentState:AuthoritativeWorldState):{components:Array<{type:string;rolled:number}>;affected:boolean;critical:boolean;hit:boolean;rollResults:AppliedWorldInteractionEffect[]} {
  const rollResults: AppliedWorldInteractionEffect[] = [];
  const specFor=(kind:string)=>specs.find(spec=>spec.purposeKey===`${key}:${kind}:${targetRef}`);
  const saveSpec=specFor("save"), attackSpec=specFor("attack");
  let saved=false, hit=true, critical=false;
  if(mechanics.save!==null) {
    const rolls=faces.get(`${key}:save:${targetRef}`);
    if(saveSpec===undefined)throw new TypeError("frozen hazard save unavailable");
    const condition=conditionSavingThrow(currentState,targetRef,String(saveSpec.frozenParameters.ability));
    if(!condition.automaticFailure) {
      if(rolls===undefined)throw new TypeError("frozen hazard save faces unavailable");
      const selected=conditionRollFace(rolls,condition.mode);
      saved=selected+Number(saveSpec.frozenParameters.modifier)>=Number(saveSpec.frozenParameters.dc);
      const modifier=Number(saveSpec.frozenParameters.modifier);
      rollResults.push({kind:"rollResult",characterId:targetRef,rollKind:"save",
        rolls:condition.mode==="normal"?[rolls[0]]:[...rolls],selectedRoll:selected,
        modifier,total:selected+modifier,succeeded:saved});
    }
  }
  if(mechanics.attack!==null) {
    const attackFaces=faces.get(`${key}:attack:${targetRef}`);
    if(attackSpec===undefined||attackFaces===undefined)throw new TypeError("frozen hazard attack unavailable");
    const sourceRef=String(attackSpec.frozenParameters.sourceRef),sceneRef=String(attackSpec.frozenParameters.sceneRef);
    const condition=conditionAttack(currentState,sourceRef,targetRef,{
      withinFiveFeet:attackSpec.frozenParameters.withinFiveFeet===true,
      visibleFearSourceRefs:hazardFearSources(currentState,sceneRef,sourceRef)});
    if(condition.requiredContext.length>0)throw new TypeError("Current hazard attack condition context is unavailable.");
    const roll=conditionRollFace(attackFaces,condition.mode),target=worldDamageTarget(currentState,targetRef);
    if(target===undefined||!canonicalNumber(attackSpec.frozenParameters.coverBonus))throw new TypeError("Current hazard target or frozen cover is unavailable.");
    const armorClass=attackArmorClass(target,Object.values(currentState.combatRuntime.effects))+Number(attackSpec.frozenParameters.coverBonus);
    // Actor permission is checked at action entry. A passive source may lose
    // its ability to attack within this transaction; only its consequence stops.
    hit=condition.allowed&&attackSpec.frozenParameters.blocked!==true&&(roll===20||(roll!==1&&roll+Number(attackSpec.frozenParameters.modifier)>=armorClass));
    critical=hit&&(roll===20||condition.criticalIfHit);
    if(condition.allowed&&attackSpec.frozenParameters.blocked!==true)rollResults.push({kind:"rollResult",
      characterId:sourceRef,rollKind:"attack",rolls:condition.mode==="normal"?[attackFaces[0]]:[...attackFaces],
      selectedRoll:roll,modifier:Number(attackSpec.frozenParameters.modifier),
      total:roll+Number(attackSpec.frozenParameters.modifier),succeeded:hit});
  }
  const components=[...mechanics.fixedDamage];
  for(const [index,value] of (Array.isArray(mechanics.definition.damage)?mechanics.definition.damage:[]).entries()) {
    const component=value as JsonRecord;
    const purpose=`${key}:damage:${index}${component.sharedAcrossTargets===false?`:${targetRef}`:""}`;
    const rolled=rolledDamageComponents({damage:[component]},faces,purpose)[0]!;
    if(critical)rolled.rolled+=(faces.get(`${key}:critical:${index}:${targetRef}`)??[]).reduce((sum,face)=>sum+face,0);
    components.push(rolled);
  }
  return {components:components.map(c=>({...c,rolled:!hit?0:!saved?c.rolled:mechanics.save?.halfOnSuccess===true?Math.floor(c.rolled/2):0})),affected:hit&&!saved,critical,hit,rollResults};
}
