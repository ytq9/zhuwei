import { actDuration, withActDuration } from './vnext-action-duration.mjs';
import {createAuthoredProbeFixture,PROBE_ACTOR as ACTOR,PROBE_TARGET as TARGET,PROBE_SCENE as SCENE,PROBE_SOURCE as SOURCE,PROBE_ZONE as ZONE} from '../../tools/lib/vnext-authored-probe-fixture.mjs';
import {lowerVNext2ProposalBundle} from '../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import {VNEXT2_PROPOSAL_BUNDLE_SCHEMA} from '../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
const A='prospective:mechanics',H='prospective:hazard',I='prospective:item-definition',E='prospective:item-entry';
function ability(extra={}){return {label:'Generated mechanics',description:'A frozen Ability.',aliases:[],tags:[],activation:{kind:'nonCombatHazard'},target:{kind:'creature',count:'1',rangeInches:'120',requiresSight:false},attack:null,save:null,damage:[],effect:null,effects:[],healing:null,temporaryHitPoints:null,costs:[],grants:[],...extra};}
function source(kind,content,handle,consumes=[]){return {kind:'materializeDefinition',basisRefs:[SOURCE],consumes:consumes.map(handle=>({kind:'prospective',handle})),produces:[{handle,kind:`${kind}Definition`,outcomeBinding:'always'}],outcomeBinding:'always',source:{kind,content},visibilityPolicyRef:'visibility:public',summary:'Definition frozen.'};}
function bundle(proposals){return withActDuration({schema:VNEXT2_PROPOSAL_BUNDLE_SCHEMA,kind:'proposalBundle',mode:'adjudication',basisRefs:[SOURCE],adjudication:{kind:'directSuccess', durationMicros: actDuration(proposals),risk:'Frozen mechanics settle.',successOutcome:'The action can proceed.'},terminal:null,proposals});}
function inventory(operation){return {kind:'inventoryOperation',basisRefs:[SOURCE],consumes:[{kind:'prospective',handle:E}],produces:[],outcomeBinding:'always',operation,summary:'Inventory changed.'};}
export function itemBundle(){return bundle([
 source('ability',ability({activation:{kind:'useObject',actionGrant:'normalAction'},target:{kind:'creature',count:'1',rangeInches:'0',requiresSight:false},healing:{formula:'2d4+2'}}),A),
 source('item',{schema:'zhuwei.item-definition-content/v1',label:'Restorative',description:'A consumable.',category:'consumable',aliases:[],tags:[],stackable:true,equipment:null,equippedAbilityRefs:[],use:{kind:'useObject',abilityRef:A,quantityCost:1,chargeCost:0,durabilityCost:0},chargesMaximum:null,durabilityMaximum:null},I,[A]),
 {kind:'materializeItem',basisRefs:[SOURCE],consumes:[{kind:'prospective',handle:I}],produces:[{handle:E,kind:'itemEntry',outcomeBinding:'always'}],outcomeBinding:'always',definitionRef:I,sceneRef:SCENE,quantity:2,ownership:{kind:'unowned',ownerRef:null},visibilityPolicyRef:'visibility:public',summary:'Two doses appear.'},
 inventory({kind:'acquire',entryRef:E,quantity:2}),inventory({kind:'use',entryRef:E,targetRefs:[ACTOR]}),
]);}
export function hazardBundle(){return bundle([
 source('ability',ability({save:{ability:'dex',dc:13,halfOnSuccess:true},damage:[{formula:'1d6+2',type:'fire',sharedAcrossTargets:true},{formula:'1d8-1',type:'cold',sharedAcrossTargets:false}],effects:[{kind:'grantEffect',condition:'blinded',duration:{kind:'timed',durationMicros:'10000000'}}]}),A),
 source('hazard',{schema:'zhuwei.environment-hazard-definition/v1',label:'Frozen danger',trigger:{kind:'disturbFeature',ref:SOURCE},perceptibleSigns:['A visible sign.'],disableMethods:['Close the mechanism.'],environmentalConsequences:['The floor is damp.'],mechanicsRef:A},H,[A]),
 {kind:'worldInteraction',basisRefs:[SOURCE],consumes:[{kind:'prospective',handle:H}],produces:[],outcomeBinding:'always',sceneRef:SCENE,targetRefs:[SOURCE],directTargetRefs:[SOURCE],instrumentRefs:[],abilityRef:null,intent:'Turn the control.',method:'Rotate it.',branches:{success:{outcomeCode:'outcome:activated',summary:'The frozen danger resolves.',effects:[{kind:'registeredHazard',sourceDefinitionRef:SOURCE,zoneRef:ZONE,damage:{kind:'authored',hazardDefinitionRef:H}}],sensoryEvidence:[],pressures:[],opportunities:[]},failure:null}},
]);}
