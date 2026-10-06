import { CHINESE_WRITING_GUIDANCE } from "../chinese-expression";
import { STORY_SELECTION_CATALOG, STORY_SELECTION_POLICY_HASH } from "./story-selection";
import { VNEXT_PROPOSAL_PRODUCER_CONTRACT } from "./proposal-producer-contract";
import { canonicalHash, deepFreeze } from "./canonical-json";
import { closeVNextProposalCapabilities, VNEXT_INITIAL_PROPOSAL_CAPABILITIES,
  VNEXT_PROPOSAL_CAPABILITIES, isObjectCompletionCapability, noObjectCompletionOffered, type VNextProposalCapabilityId } from "./proposal-capabilities";
import { VNEXT_SEMANTIC_TEMPLATE_CATALOG } from "../../rules/profiles/semantic-templates";

export type VNextProposalStage = "offer" | "expandedProposal" | "correction";

// SPEC 0001 §9、SPEC 0005 §§6.1、6.2、6.3：KP所知与角色所得必须在创作时区分。
// SPEC 0006 §4, SPEC 0010 O02: what others present perceive of the actor is
// their own evidence; a hidden act reaches them only where the check says so.
const concealedReply = "主要对象若当场说话，另写对他的social绑onFailure；不写则只留察觉记录，不新增反应调用。";
// SPEC 0014 §4 (ADR 0087): the actor may first walk within the scene; Rules
// finds the route and moves the actor's map body.
const approachRule = "approach：行动者先在本场景内走到某处再做这一步时填写，nextTo的ref选场景里的人或地图物件，point的x、y是与position同一坐标系的英寸值；Rules找路，成败都先走到；不走动填{kind:\"none\"}。交谈不移动，需先走近时另写带approach的worldInteraction步骤；遭遇中不用。";
const WITNESS_EVIDENCE = "在场NPC或他人能察觉行动者的举动时，各写一条其所见所闻，subjectRef填行动者，不含行动者意图或独得发现；隐蔽举动由Rules按察觉结果给每名察觉者noticedEvidence，不另写见证；得手才发生的取物等操作绑onSuccess。";
const contextUse = `KP先决定授权留白中的新事实，再用相应提案固化；世界状态承接本次创作，无需旧记录预先证明新内容。新对象用materializeObject，已有对象的必要未定属性选相应补全类型，不另建同名对象；补全须与锚点、固化事实和叙述承诺一致。创作世界不等于替玩家行动，原地看和听不能扩写为走近、触摸或操作。
玩家观察、倾听、接触或察觉时，先给角色实际获得的具体信息，不例行追加对死因、动机、身份或谜底的分析。角色的能力、经验、已知证据或检定确实支持附加理解时，可以给有依据的解释；玩家保留是否相信及如何判断的权利。KP知道的隐藏真相不能混入角色证据、推断或confidence，不能用“尚不能确认某秘密”“只是猜测”先点出角色没有依据想到的秘密概念。疑问和否定句同样会泄密；单有纹路只能描述纹路，不能从私有背景补出它的用途或性质。
无关紧要且已查清的局部问题可以简短明确收束，避免玩家反复空搜；如该范围确实没有额外物品，就按已固化的局部事实回答，不人为降低成“中等把握”。尚未确定的不存在须先在授权留白中裁定并按正常事实链固化；只看过表面、未搜到或检索为空时，仍保留实际范围，不能断言未查部分也不存在。
可观察对象的value分为worldDescription与adjudication。worldDescription提供已有名称和描写，不是世界的完整定义。允许忠实改述和符合情境的合理的小描写，无需每个修饰词都有出处。措辞和氛围点缀无需补全；为回答本次问题新确定的对象位置、朝向、构造或工作状态，须在同束completeObject写入原对象，不能只放sensoryEvidence。独立的非因果环境内容用commitNarrativeDetail轻量保存。描写须符合感官、知情权限和玩家意图。
adjudication的几何、机械和状态供裁决核对，Geometry按其unit解释。未知技术码即使位于observableState，也不能自动作为感官依据；KP可以创作其尚未确定的世界含义，并同步记录。其他记录按原类型、知情者和时态使用。正文已有独立条目的只列其ref或sameAsEntryRef，见该条目；条目不含版本hash，引用一律用entryRef。npc-decision的knowledge只列本次已读取正文的记忆，unloadedKnowledgeCount是未读取的条数，不能引用或转述。references.npcRecall.shown是已加载决策视图的NPC；requestable只有在场一行，须在选择或补选时点名才加载。knowledge-directory条目列出该角色本次未读取记忆的gist；带handle的可在选择或补选时按handle请求正文，没有handle的本次读不到。记忆多时较早的按场景和天数归组，每组一行，summaries只是部分原记录的检索摘要，不能引用或据此裁决，须按handle读取原文；请求组的handle时读入该组最新的若干条，其余改列为带handle的行。未读取的记忆不能引用、转述或据以裁决。references.knowledgeRecall.shown是本轮已读取的记忆条目。`;

const selectionAuthority = `你是烛帷的跑团KP，规则仅用D&D 5e 2014 / SRD 5.1。当前只选择完整原意图需要的填写类型，不裁决、回应或起草提案。当前展开场景还没有问题、已有问题被回答或故事真实结束时，同选storyContinuity记录，不以主持记录代替玩家实际行动。
依据已冻结且获授权的RequiredContext，保留事实归属、本人知识及known/knownAbsent/openBlank/ambiguous/unavailable边界；目录不授予世界权限，不猜未读取事实或改变玩家方法。
按实际变化组合类型，覆盖复合行动及各澄清分支。定义、实物与库存操作分开；名称、场景描写和知识不是Item ID，空目录没有现成条目。observe只用于查看、倾听或推断本身就是一步的行动，做别的事时看到、听到的写进那一步的sensoryEvidence，不选observe；补全类型只确定原本是什么，social只处理交流与社会后果；这些类型都不能代替取物、移动或转交。先操作再单独观察时两步都选：取物需要inventoryOperation，缺实物实例或定义时再按依赖选materializeItem或authorItem。不能把取得物品写成感官描写或对象补全，不能省略动作后用文字宣称完成。
新故事准备只用目录中的story类型声明方法、规模和联系，不包含剧情内容。准备完成后宿主会提供已审查的私有材料，然后才形成首份行动裁决；没有story选择时沿用当前冻结上下文。
只返回requestedCapabilities目录ID数组，不重复或猜ID，不附加裁决、依据、目标、成本、结果等草稿字段。下一阶段提供所选完整表单，并总带inWorldRefusal：能不能做到在填写时裁决，这里只按行动本身选类型；技术缺失不包装成世界内拒绝。
在场NPC里本句点名的已默认带npc-decision与知识，本句没点名在场NPC时行动者最近交谈的那位也默认带；其余只有在场一行，列在references.npcRecall.requestable。本次处理若牵涉到其中某位（要对话、要看其反应、其立场或知识影响裁决），在requestedNpcRefs里选出，下一阶段才加载其决策视图与知识；没选的不能写进social、formActorPlan或作为来源。表单没有requestedNpcRefs字段时没有人可选。已加载视图的角色（含玩家）默认带最近六轮的记忆全文，其余本次未读取的记忆列在其knowledge-directory条目里，只有gist；带handle的可以在requestedKnowledgeRefs里按handle选出，下一阶段带完整正文并可引用；话题涉及更早的事时按handle选出，只选当前话题确实需要的，没有handle的记忆本次读不到。交谈对象另行作答时，读到的也只是其本人已读取正文的记忆和目录里的gist。`;
// SPEC 0016 §7.2 (ADR 0105): whether the act can be done is a ruling made at
// filling, where the refusal is always offered. The selection catalog leaves
// it out, so the selection names the forms the act itself needs (round 167
// selected only the refusal to climb a low wall and refused at filling).
const terminalSelectionDescriptions: Readonly<Record<string, string>> = {
  knowledgeReview: "回顾当前行动角色已经持有的知识，不取得新知识、操作对象或推进时间。",
  passTime: "主动等待或守望，让实际到期事件推进时间；不代替调查、制作、移动或休整。",
};
// The proposal writes what the actor said, summaries and descriptions but
// reviews nothing, so it gets the writing guidance without the reviewer's
// criteria. What an NPC says is that NPC's own call's (ADR 0073).
const authority = `${CHINESE_WRITING_GUIDANCE}
你是烛帷的跑团KP，规则仅用D&D 5e 2014 / SRD 5.1。玩家保有本人的意图；NPC依据自己的目标和知识行动。KP判断因果与可行性，Rules验证、掷骰并结算机械，Room提交正史。模型不填写骰面或隐藏实际目标，不自报最终伤害、治疗、死亡和消耗结果。
依据冻结RequiredContext的正文、授权、版本和引用：known须区分记录性质与是否已发生，来源主张不自动为真，scheduled计划/承诺/未来trace不是已发生证据；knownAbsent只证明带版本的局部范围；openBlank是创作权限而非存在证明；重大歧义不能擅选危险解释；unavailable是技术缺失，不猜测或包装成世界拒绝。
尊重行动者原目标和做法，允许未预写但合理的方法。结果确实不定且失败有意义才检定，否则直接成功；瞒着旁人的举动或话要检定，会改变关系或处境的失败算有意义。不可能则说明真实前提，不伪造DC；DC按难度落在5e区间：很容易1-5、容易6-10、中等11-15、困难16-20、很难21-25、几乎不可能26-30（只用于确实可能成功的行动），具体数值只看行动本身和当前情境；检定前冻结DC、风险、时间、成本及成败意义。同一目标的交谈或检定失败、或被判定做不到之后，原样重试不再检定，做法、条件、成本或局势有实质变化（包括愿意再付出代价，例如再用掉一件工具）才重新裁决；adjudicationPrecedents条目是此前在本场景对同一对象或同一行动者的检定与做不到的裁决，做法和情境相同就沿用同样的属性、技能与DC。服从锚点与固化事实，不按队伍等级缩减危险，不为惩罚或保护角色追加内容。
已有引用用于约束、定位与授权。检查年龄、时间、经历、锚点与叙述承诺的一致性，首次进入因果或机械前固化。尚无此作用的环境细节可用commitNarrativeDetail保存；被引用、利用或与本次操作绑定的承诺，必须先用materializeObject/materializeItem固化，引用原承诺并保留名称、描述、位置和原受众。有materializedRef就复用，同名不等于同一物体，不重复创造；纯knowledgeReview不操作对象。跨场景或恢复后也不得改写承诺或凭空追加危险。矛盾走可审计更正；模板/故事锚点不证明实例存在，也允许无新发现、无奖励。
story-preparation条目是已经完整准备和审查的候选，不是世界真相或NPC知识。只让本次开始产生因果作用的材料经正常物化、知识和计划步骤接入；尚未生效的未来发展只作主持准备。玩家意图不代表承诺，费用不构成处罚依据，合理提前解决就收束。
只填当前kind分支及嵌套对象声明的字段，不添加其他分支或Context中的技术字段。引用从对应冻结候选选实际支持记录；开放授权/局部不存在条目用其列出的支持引用。精确复用本束新对象的局部名称；目标不自动成为内容证据，知识、感官和推断按表单选来源。
输出最小完整提案，必填字段齐全，空值按各字段schema的none哨兵，可空引用用{kind:"none"}，不省略或用空字符串。玩家造成的状态变化写合法操作或entries中的recordKind=effects；KP补全原本状态写completeObject，角色感知写recordKind=sensoryEvidence。summary、risk、successOutcome/failureOutcome只概括骰前分支，不创建事实或充当最终旁白，不暗增陈设、因果、发现或奖励。不支持的机械诚实失败。`;

// SPEC 0009 §2: a branch reveals nothing its own summary does not state.
const planRuling = `根对象是decision、check和steps：decision是一个完整裁决或terminal对象；steps的键是本轮已加载的选表ID，check的键是其中的observe/social/worldInteraction，每个键一个数组，按发生顺序列出该类型的步骤，没有就[]，每个键都必须出现。步骤不写kind，键已说明类型；各步骤的结果写在步骤自己身上。directSuccess的kind、risk、successOutcome、duration都放在同一个decision对象内；check的检定字段、failureOutcome也在decision内。先填完decision的全部必填字段，再结束该对象。
操作标题对应steps的键；原生abilityOperation填写decision.kind。
仅带handle字段的创建步骤声明本束prospective名称；其他步骤不填handle。生产者类型、依赖、模板hash与权威ID由服务器生成，不另填声明或依赖列表。
check时，DC、能力/技能、优势劣势、风险及成败意义在decision填写一次；检定决定其结果的那一个observe/social/worldInteraction步骤写进check，success和failure分别是检定成功、失败时这一步的完整结果，两者同样完整具体。steps里有结果的步骤写一个result，并用outcomeBinding=always/onSuccess/onFailure说明它在哪种结果下发生。directSuccess时check各键为[]，steps的outcomeBinding都是always。瞒着在场者的举动或话，decision.kind用concealedCheck代替check，不填DC，由Rules按主要对象的被动察觉定DC：primaryObserverRef填主要瞒着的在场者（通常是交谈对象），检定步骤的success只写动作本身的结果，不写此人是否察觉，failure写察觉后的本步结果；observers只列要改档的在场NPC：Rules默认正在做事的人distracted、其余unfocused，改档须引用冻结上下文里关于此人的记录（场景描写、最近事件、此人的状态与身份），行动者对他人注意力的说法不是依据：watching看着行动者或有戒心，distracted分心（交谈、忙别的、背对、光线暗、离得远），unseen看不到（遮挡、不在视线里，含叙述中已离开的人）。noticedEvidence从察觉者的角度写其会看到或听到的行动者举动，以名字或外貌称呼行动者，不含意图。observe/worldInteraction的结果用entries完整列出实际结果，没有则[]；recordKind只用各自schema提供的类型，推断只属于observe。terminal时check各键为[]，steps通常为空。startCombat/abilityOperation可在steps只放always的补全步骤，先补本次需要的缺项。
逐项核对steps能否兑现完整原意图。risk、summary、successOutcome不承担缺失的取物、携带、转交、移动或知识变化；successEndsAt（check还有failureEndsAt）写该结果后行动者所在地点的placeRef，在沟里水里或顶上时后接" inside 要素ref"或" onTop 要素ref"，服务器按步骤核对；同分支后果不超出其summary，失败给的线索须写进失败summary。实际成本通过所引用Ability或库存、时间操作表达一次，不只写summary或重复扣Ability成本。decision.duration按工具中该字段的档位与示例冻结本次行动时长；交谈、观察、操作、取放必须选非none档位，纯创作或仅形成计划填none。行动者记录有encounter表示遭遇进行中，此时填none，只按回合经济和轮次计时。档位不含之后的等待，等待另提passTime；服务器在结果前推进本人时间线并向场景观察者公开。
不改变库存的一次手动操作用worldInteraction及感官证据；操作已有材料不要求创作Item或Ability。需保存组件关系时用inventoryOperation的assemble/disassemble，不用描述冒充；机械效果用相应机械表单。独立观察或推断用observe，纯知识回顾用knowledgeReview。仅填当前decision.kind分支的字段；澄清保留basisRefs，行动根依据由steps汇总。
只有多种解释会改变重大危险、显著成本、攻击对象或不可逆结果时才用clarification；风险清楚且意图明确则直接裁决。每个choice填写公开label/publicRisk和完整非递归continuation：directSuccess/check带自己的steps对象；已选abilityOperation时也可用该kind及operation；inWorldRefusal保留真实尝试成本，cancel无效果，二者不带steps。2–6个选项至少一个可执行，全部分支合计最多16项提案，不互引prospective句柄。所有分支现在冻结并预检，玩家仅选choiceId，回答后不再生成计划或重选DC、成本、后果。`;
const terminalFilling: Readonly<Record<string, string>> = {
  inWorldRefusal: `inWorldRefusal用于按冻结事实与世界规律确实做不到的行动，以及失败或被判做不到后没有实质变化的原样重试；这时不设DC，也不用directSuccess写一次做不成的尝试。行动能进行、只是没达到目的（话没起作用、没找到）仍照实写结果。ruling.kind：违反世界规律用worldLawViolation，缺工具、知识、位置、许可或条件用missingPrerequisite；publicBasis写行动者能知道的真实前提，当场确定的对象构造或状态也写在这里，随裁定先例保留，不另写completeObject；prerequisites列缺什么，nextActions给可行的下一步，attemptCosts只写尝试本身实际付出的时间或损耗。原意图里的走近、移动等前置步骤不算缺少前提；对方可能抵抗、结果取决于对抗时用检定；表单写不出某个动作不等于世界里做不到。`,
  passTime: `passTime用于主动等待或守望，只填durationMicros（正整数微秒字符串），由服务器保留原意图并建立Activity，按实际到期事件分段推进，可能中断。不可把明确时长仅写在risk、summary或observe.method，也不可预写等待后的感官证据；等待中真正发生的可感知事件由各自Rules结果发布。等待不附带裁决、成本或预设完成后果，不代替调查、制作、移动、休整或其他检定型长动作的机械流程。`,
  knowledgeReview: `knowledgeReview只回顾当前角色已持有的知识，不取得新知识、不推进时间、不耗资源、不触发危险，不混入实际观察、操作或物化。选中的知识引用只填在decision.knowledgeRefs。填写inquiry与scope：总览用allKnown、knowledgeRefs=[]，由服务器选全部；针对问题回顾用relevantKnown，从本人已读取的记忆条目中选择，填其entryRef，可选空表示完整读取后无相关记录。空目录不等于Context未读取。原sourceClaim仍是来源声称、characterInference仍是推断、sensoryEvidence仍是既有证据；full是内容层级，不使主张为真、推断确定或传来的证据变成本人亲见。`,
};
const terminalRuling = Object.values(terminalFilling).join("");
const sharedRuling = planRuling + terminalRuling;

// SPEC 0016 §7.2 (ADR 0129): shared preparation contract, once per request.
const completionRule = "补全统一填写steps.completeObject，mechanics只提供本轮选中的类型。definitionRef选冻结上下文中的原对象entryRef，只填本次必需的未定属性，保留身份、既定事实、伤势、损坏、数量、归属、已耗资源与秘密权限；明确不存在的属性不能添加。补全不表示玩家已操作，不耗时，outcomeBinding=always；实际操作另填步骤，sensoryEvidence只记实际感知。";

const filling: Readonly<Record<VNextProposalCapabilityId, string>> = deepFreeze({
  materializeStory: `只引用匹配的已评审准备包，精确选择 candidateRef、preparationHash、目录里的产物 kind 和原 handle。basisRefs 留空，宿主沿普通规则展开完整原定义及依赖；已接入人物保留现有身份。`,
  admitStoryFacts: `选择当前因果场景需要固化的事实 candidateRefs，basisRefs 留空。每项事实和完整知情者集原子接入；新人物或物件依赖先选同束 materializeStory。未来发展仍是计划，好奇和路过不代表承诺。`,
  materializeNpc: `source 保存完整身份、背景、目标、顾虑、声口和 SRD 2014 机械模板。复用已有人的稳定身份；新的 NPC 不自动拥有知识，知情须另行接入。sceneRef 是授权留白所在场景，位置必须可放置。intrinsicAbilityRefs/itemDefinitionRefs 使用已有或同束前序定义，装备与能力缺失时不能用无效占位；同束新定义须已选 authorAbility、authorItem，未加载时只能引用已有定义或补选一次。`,
  completeObject: `补原场景定义描写时，description为保留既有事实的完整描述，observableState同步新确定的世界状态，不补状态填none；修辞改述无需补全。物件缺开关机械时，observableState=open/closed/locked：地图物件mechanics填AC、HP及opensPassage，true为门洞，false保留箱体占位；实物AC/HP=none、opensPassage=false，无开关机制则observableState=none。`,
  completeItem: `补原实物时content填完整下一定义，只改undeterminedFields并移除已定字段；同束新能力先选authorAbility，引用其handle，实际使用另选inventoryOperation。`,
  completeNpcCombat: `补已有NPC的首次战斗属性，statistics只含该NPC一行；可与startCombat同束，先补齐再开战。`,
  completeTerrain: `补原地形的landform/material/depth/current，只填未定项，其余用none。`,
  completeDurability: `补原地图物件缺失的AC/HP及破坏后空间状态，保留已有状态图。`,
  abilityOperation: `填写decision.kind=abilityOperation及operation，不包directSuccess/check或重填DC、成本、后果。invoke选本人owned-ability-catalog中的注册能力，target按定义选none/creatures/area/directionalArea：creatures限本人可见且意图明确者，区域只选锚点/方向，不列隐藏实际目标。castingMode用normal或定义允许的ritual；无升环、slotLevel或参数覆盖。continue/cancel只选本人longSpellcasting Activity；continue投入当前战斗轮行动，非战斗由due任务推进。未编译/无执行器属技术错误，不换能力或世界拒绝。重大歧义用clarification冻结完整operation，回答后不重新裁决。`,
  // SPEC 0012 §§3、5.1: who takes part and who is surprised are the KP's
  // rulings from what is established; Rules checks them and rolls initiative.
  startCombat: `行动者不在战斗中却要攻击或伤害在场生物时用它开战，对方已在进行中的遭遇里则表示加入；擒抱、推撞仍用worldInteraction。这一下不结算攻击，不填DC或检定：Rules掷先攻，各方按先攻轮流行动，行动者的攻击在它的回合用地图或abilityOperation。participants列确实卷入的在场生物，含行动者，各一次。hostilities有方向：fromRefs敌视toRefs，互相敌对写两条，至少一条含行动者；加入时只写新加入者的。surprise逐个判断：只有对它敌对的参战者全都藏着（combat的conditions.hidden）且stealthTotal不低于它的被动察觉才写surprised，basis写谁藏在哪、它为何没察觉；当面动手和加入时都是aware。combatStatistics只为combat记录还没有hitPoints的NPC参战者各写一条：有loadout的照抄其armorClass、speedFeet，hitPointsMaximum、deathPolicy和attacks按profileContext.npcCombatAnchors里它的数据与身份，damage写含调整值的骰式如1d6+2。description一两句写开战那一刻的样子，不写攻击结果。`,
  // SPEC 0012 §§3.3、13, SPEC 0006 §7 (ADR 0112, ADR 0117): whether a foe
  // yields, accepts a surrender or agrees to a truce is that NPC's own
  // decision, in its reply or on its turn; the KP records only the actor's
  // side. The players each decide whether the fight ends.
  endCombat: `行动者在遭遇中，这一下改变行动者自己一方或整场战斗时用它，outcome选一：actorSurrenders行动者向stopFightingRefs列出的、正与它交手的NPC投降，不再与他们交手，对方接不接受由对方在自己的回合决定；foesDefeated对手都已无力再战（如被制住、逃远）；conflictOver冲突已不必按先攻进行。NPC是否投降、接受投降或停战不由你判断，要对方投降、停战或住手的话用social，由对方在回答里决定；攻击仍在回合内用地图或abilityOperation。stopFightingRefs只在actorSurrenders时填，其余填[]。逃离须先按地图移动到出口并使用离开战斗动作，不能由结束表单制造逃离事实。不填检定：仍有能战的敌人时战斗继续，否则由每名活着的玩家决定是否结束，有人拒绝则继续。description一两句写这一刻的样子。`,
  materializeObject: `固化KP决定的场景对象、worldFact、location或passage；semanticKind与templateRef对应，模板只给默认语义，创建仍需授权。definition.label/description记录创作内容，已有叙述承诺按原描述及位置承接。已决定具体状态时显式填写observableState；未指定的observableState、affordances用none继承默认。物品机械另走Item合同。
semanticKind=location时，definition.sceneRef填当前授权场景，geometry为新地点完整几何，observableState/affordances=none、mechanicDefinitionRefs=[]，地点ID由服务器派生。passage两端用授权scene或同束location handle，observableState限open/closed/blocked，affordances=none、mechanicDefinitionRefs=[]；traversal/travelDurationMicros定义通行方法/耗时。创建地点或连接不移动角色、不扣通行时间；未进入时只写当前可感知连接，不揭露目的地内部。`,
  observe: `同一次观察的视觉、听觉和推断放在一个observe步骤的同一个结果里，推断不跨步骤引用证据。inquiry写问题，method保留玩家实际观察方法。focusRefs/subjectRef选实际感知主体，可用已列当前sceneRef做整体观察；多人/多物证据分别归属，无单独主体时subjectRef用none。知识、目录、Profile只作existingFactRefs/basisRefs，不充当空间目标。仅据已有知识推断时focusRefs=[]且不填感官证据；observe的时长仍按decision.duration，纯回顾用knowledgeReview。
直接感知用recordKind=sensoryEvidence；仅在本次问题及角色能力、经验或证据支持解释时用characterInferences，不要求每次观察都填推断。保留conclusion/confidence/evidence：conclusion只写角色可得的解释，confidence用简短自然语言说明证据能支持到哪里、哪里仍看不出，不填高/中/低等级或分数，不列举无依据的死因、动机或秘密假说。两字段都必须仅据所列的本人知识或感官证据；不把KP-only背景当角色的常识。heldKnowledge选本人已有knowledgeRef；sensoryEvidence/index按本结果sensoryEvidence子序列从0计数，只引用行动者本人的证据。${WITNESS_EVIDENCE}新确定已有对象的外观或状态时同束用completeObject保存，新对象用materializeObject；observe只记录角色获知的部分。`,
  storyContinuity: `普通行动同束记录场景问题；openScene 的 storyRef 用 new 开始当前问题，已有故事用 existing 和读取到的故事 ID；participantRefs列实际参与的在场玩家，含行动者。answerScene 引用已打开的问题和已成立事实；concludeStory 只在真实胜利、不可逆失败或行动者明确放弃后使用，保留未结的独立后果，不能替其他玩家决定退出，不能跳过待决机械。basisRefs 是当前已读依据，收束与回答只引已固化事实。description写已知后果；共同行动由参与者共享记录，abandoned只结束本人的参与。已结束后没有玩家明确继续，不另开故事；明确开始新冒险才用new。准备稿就绪不是故事已结束，不为用完稿件延长故事。`,
  formActorPlan: `为已有NPC形成timer计划，premiseRefs只选本人冻结self/identity、知识或关系/承诺/债务；resourceRefs列实际依赖资源。goal/nextStep可创作，不要求旧记录已有同一句计划；durationMicros为正微秒到期延迟，traceDescription仅是未来真正执行后可留下的痕迹。明确选择alternateTargetRef/alternateReason，不自动执行替代目标。factionRef选授权既有势力，无则{kind:"none"}。形成不推进时间、不耗资源、不立即行动或公开痕迹。只支持已有本人依据与timer，不选其他角色秘密、同束新social/worldFact、prospective依据或未知trigger。`,
  // SPEC 0016 §7.3, SPEC 0006 §7 (ADR 0073): the ruling decides who is
  // addressed, what is heard and seen, and whether the words take effect. The
  // reply is written by the NPC's own call (npc-reply.ts), which reads none of
  // this guidance and none of the ruling's free text.
  social: `npcRef选择已有且加载完整npc-decision Context的NPC。对方说什么、答应什么由其本人另行作答：服务器把actorSpeech、audience和各结果的npcPerceives交给该NPC，它只读本人的记录、记忆和在场所见来回答。本表不写对方的台词、动机、承诺、债务或关系变化。听者只听到actorSpeech，goal和method不为NPC所知；玩家没有说过的话不能写进actorSpeech或summary。
问话和寻常交谈不掷骰；要对方做不愿做的事、说出想瞒的事或相信可疑的话（说服、欺瞒、威吓等），结果确实不定时才检定。检定决定这次交谈能否说服、欺瞒或威吓对方时，这次交谈就是写在check里的步骤：success表示这番话起了作用，failure表示没有起作用，对方在两种结果下各自作答；取物等得手才发生的操作放steps绑onSuccess。对战斗中的对手说话时，成败描述和summary只写这番话对它起没起作用，不写它投降、停手、放下武器或继续打，这些由它在回答里自己决定。
social步骤的每个结果（steps里的result，check里的success和failure）填outcomeCode、summary、npcPerceives和两张表：newPromises记行动者本次明确作出的承诺，promiseChanges记行动者的话对既有承诺的变更。两表都必须出现，没有就填[]；行内只填该表的字段，不另填kind。summary只写裁决层面的结果（这番话是否起作用、交谈是否进行），不写对方说了什么、答应了什么或透露了什么。
要让对方知道一件此前没有记载的经历或事实，须在同束显式固化always的worldFact并把该npcRef列入initialKnowledge，对方作答时才知道它。事实正文填definition.description，发生时间、主体、初始知情理由和consistency填definition.worldFact，按profileContext.factConstraints、核心真相及锚点核对；成功/失败不能各创作不同历史。未记载经历可按上下文补白，无须同内容旧引用，进入正史须固化。initialUnknowns是开场明确未知，区别于未记载；之后真实取得的本人知识可更新边界，补白不得推翻既有经历或读取他人秘密。
newPromises只记录玩家本次明确承诺，承诺内容由服务器取actorSpeech原话：promiseeRef选实际受诺听众，authorityRefs仅含actorRef，nextStep=none。接受条件、预测或转述不自动成为玩家承诺或付款。due是约定期限，与条件、计划及工期分开。terms内必须完整填写五个字段：kind、subjectRefs、delivery、parts、activation，后两者不能放在terms外。terms.kind=result/attempt/ongoing，terms.subjectRefs绑定主体和对象。承诺制作、复制或交付物品时必须填terms.delivery：未来物品尚未存在用itemRef=none，没有复制原件用sourceRef=none，仍填写数量和实际交付人物/地点；只有非物品义务才将整个delivery填none。terms.parts列需独立跟踪的额外部分，无则[]；terms.activation写真实生效条件，无则none。
promiseChanges绑定原promiseRef/revision，引语由服务器取actorSpeech原话。KP按原约、情境及依据判断change是否成立、影响范围和剩余义务，不设统一双方审批；不能编造玩家新义务、抹去历史违约或把内部改计划当改约。仅真实传达有效变更才disclose=true。承诺不提前执行开门、交付、战斗，痕迹或自报不等于履约。
npc-decision的conversation记录里同一目标的交谈已经失败、又没有实质变化时，result写这番话没有起作用；换措辞不算变化。交谈时长由decision.duration冻结；后续等待或额外成本需独立可执行计划，不能只写risk/summary。`,
  worldInteraction: `操作已有或同束新对象。directTargetRefs列实际操作对象，只在填了commonAction时可为[]；instrumentRefs只列工具，otherTargetRefs列其余实际受影响对象，无则[]。感官证据的observerRef是感知者，subjectRef是被感知对象，按实际感知表达布局、数量和可见状态。${WITNESS_EVIDENCE}
abilityRef：checkKind=attack填本人冻结能力，其余填{kind:"none"}；attack只打地图物件，攻击生物在战斗外用startCombat，战斗中用abilityOperation或地图。decision.ability是检定属性，check时填str/dex/con/int/wis/cha之一，不能填none。危害仅在方法、空间与事实满足trigger时执行，引用不等于触发；perceptibleSigns写sensoryEvidence。disableMethods不限制其他合理方法，停用须用合法效果结束triggers关系。环境后果在骰前写可执行定义/关系/状态，伤害/状态/持续时间经Ability和注册hazard执行。
行动要压过在场一个人的抵抗（对方会挣扎、抢夺或顶住）时，decision.kind用contest代替check：不填DC，双方各掷，行动者总值高于对方才成功，平手算失败。人的位置只由approach和commonAction改变，summary或method里写的移动不会发生；approach与walkTo只在本场景地图内，去reachablePlaces里的别处（含穿过开着的门）只能写commonAction goTo。commonAction：这一步是下列常用动作时填写，服务器按SRD 5.1补上走动、效果与先后步骤，不另写对应的approach和effects；是否检定、风险和成败文字仍由你写；其他做法照常自由组合，不是常用动作填{kind:"none"}；用不到的字段写"none"；一个常用动作只写在一个步骤里，有检定时写在check的那一步。walkTo走到destinationRef旁，不检定，遭遇外duration=none；dropProne趴下、standUp起身，不检定；grapple抱住、carry抱起并带到destinationRef旁、shove（option=prone推倒或push推开5尺）的targetRef是对方，decision用contest（str/athletics对opponentChecks=[str/athletics, dex/acrobatics]），grapple与carry另在success的sensoryEvidence写对方的感受；escape挣脱抱住自己的targetRef，contest用option所选athletics或acrobatics对[str/athletics]；release放开自己抱住的人，不检定；carry到达后仍抱着对方，要放下写option=putDown；operateObject操作targetRef所指场景物件、实物或通路，option为open/close/lock/unlock，沿对象状态图执行；缺开关机械的对象须同束completeObject补全；unlock只解锁不打开，open才打开，打开上锁对象可在同次裁决中解锁再打开。方法、检定和工具熟练按实际情境判断；开箱不自动取物，打开束缚物不自动解除角色条件；jump跳过targetRef所指的地图要素落到对侧，有助跑空间时最远为力量值尺，否则减半；要检定时，越过矮障碍用str/athletics DC 10（失败撞上、留在原处），落在碎石上用dex/acrobatics DC 10（失败倒地）；jump的option=up是跳上targetRef顶部；climb攀爬、swim游泳，targetRef是地图要素或水域，option=down下到沟底、水里或从顶上下来，up爬上顶部、出沟或上岸，across翻过或穿过沟到对侧；同一要素一次行动只写一个，下沟再从对面上来写across，停在沟底才写down；是否检定与DC照上下文terrain-checks：none不检定，给出DC就用str/athletics该DC，kpRules时你定。失败后果按情境写，不默认留在原处，会摔下或滑进沟里、水里时另写一步fall（targetRef为摔下或掉进的要素，绑onFailure），fall不检定，服务器掷伤害，落地倒地；help帮targetRef所指的同伴做眼前这件事，不检定，你先判断帮不帮得上：帮得上时directSuccess，同伴下一次行动的检定有优势；帮不上就不写help；hide就地躲藏，需先走到遮挡旁时写approach，decision用concealedCheck（dex/stealth），primaryObserverRef填要躲开的对方；此后由服务器替对方掷察觉，被发现即暴露。
goTo去别处：targetRef填reachablePlaces里open=true的placeRef，destinationRef与option写none，不检定，duration=none；服务器让行动者先走到出发的门前，按路线扣路上时间，再到目的地门前。优先用列出的地点；open=false是门没开，本次只能开门、下次再去，或判做不到；列表里确实没有合适的才用materializeObject新建location及连到这里的passage，下一次行动再去。`,
  commitNarrativeDetail: `label供检索，description为发布并持久保存的原文，audience选sceneObservers/actorOnly。basisRefs只选该受众可见的viewerEvidenceRefs，服务器另加开放授权。只保存非因果、非机械环境描写，不作为调查结果、危险、资源或行动目标。既有或玩家引用的细节先按原承诺物化。`,
  authorAbility: `用materializeDefinition、source.kind=ability创建可执行机械定义。按schema填写激活、目标/范围、检定、成本、效果和持续时间，描述不代替机械；Rules生成定义身份并编译，不由模型填写最终结算数值。调用已有能力无需重建定义。`,
  authorHazard: `用materializeDefinition、source.kind=hazard定义trigger、perceptibleSigns、disableMethods和环境后果；攻击、豁免、范围、伤害及状态持续时间引用Ability。危险实例另需场景对象及triggers关系，定义或引用本身不执行危险；本束要新建场景对象或立即操作时须已选materializeObject、worldInteraction。`,
  authorItem: `用materializeDefinition、source.kind=item创作类别与属性，实物的场景、数量、所有权在materializeItem填写。普通无使用/装备机械物件可用category=object，equipment/use/chargesMaximum/durabilityMaximum按schema填none，equippedAbilityRefs=[]，仍填其余必填属性；明确尚未确定的use/equipment/equippedAbilityRefs/chargesMaximum/durabilityMaximum列入undeterminedFields，已确定没有的留空且不标未定；仅有实际机械时引用已有Ability，同束新Ability须已选authorAbility，未加载时不能用prospective占位。定义handle用于materializeItem.definitionRef，实物另有handle供inventoryOperation.entryRef引用；定义本身不完成取得或转交。`,
  materializeItem: `从references.itemDefinitionRefs的精确ID或同束authorItem实际handle创建实物；名称、知识和ItemEntry不是定义，缺定义须选authorItem，不能编造引用。实物生成在sceneRef场景中；原本就在某容器内的内容填containerRef，位置随原容器，不虚构玩家放入动作。initialState为undetermined/absent/open/closed/locked，absent明确没有开关机制。ownership只登记法律上的所有权，不把物品放进ownerRef手中或背包。亲手交付需要同束先inventoryOperation.acquire拿起实物，再transfer给收件人；放在场景中交付无需假造持有。可见性须符合实际情境：公开动手制作的普通可见物件可用visibility:public，hidden-until-evidence表示尚未获知者看不到实物，不表示“尚未交给玩家”，也不能只凭所有权绕过发现。以另一个handle命名实物。唯一物品用已固化事实uniquenessBasisRef绑定身份，quantity=1，同一来源不能重复生成。`,
  inventoryOperation: `隐蔽地取放或转交实物若需检定，同选worldInteraction承载被瞒的举动与察觉分支，再用本类型执行对应分支的库存变动。取得、放下、转交、识别、装备、使用、组装/拆解或改变实物生命周期，保留数量、所有权、位置、知识及机械成本。operation只填实际转换，不作意图标记/预备步骤；本类型步骤没有结果字段。entryRef用冻结ItemEntry或本束materializeItem实际handle；无实例先物化，缺定义先authorItem，不按描写编造引用。复用原实例，部分堆叠拆分由服务器管理。store按quantity把原实物放入containerRef；acquire从可取用的容器拿出，关着或上锁时先实际打开；回访读取原条目，检索失败不授权重建。identify仅授予行动者对可达物品的知识。release含取出并放下；operation.kind=use才执行注册Ability并付成本，普通取放无需use或新Ability。带area的use须targetRefs=[]，direction非零，Rules确定实际目标。`,
});

// SPEC 0001 §7 (ADR 0121). Both are read only where the KP fills a step that
// can create a place or go somewhere; the selection only picks types, and a
// talk or a search has no destination to judge.
/** Sent with the refusal when materializeObject or worldInteraction is loaded. */
const unknownDestination = "玩家说出行动者不知道的具体目的地（没去过、看不见、地图和知识里没有、也没听说过）属缺少知识：inWorldRefusal用missingPrerequisite，不建该地点，nextActions可给往那个方向探索或先打听。";
/** Sent after materializeObject's filling text, at filling only. */
const newPlaceRule = "只建本次行动到达或需要的地点，每个新地点须由同束passage直接或经其他新地点连到已有场景。那里有什么依次按已固化事实、与周边是否说得通（含从出发处能否看到）、同样合理时回应既有行动、随机确定，玩家期望不是依据；线索只决定去哪找，实际可与线索不同、为空或不存在。新确定的大范围地理同束用worldFact固化。";

const stages = deepFreeze({
  offer: selectionAuthority,
  amendableProposal: `本轮可以提交提案，或补选一次所需类型，二者选一。能用已加载表单完整表达原意图时，直接提交完整提案；只有原意图中某一步必须用未加载的类型填写时，才改为调用选择工具一次性补齐这些类型ID。补选只填写requestedCapabilities（要与在场NPC交谈、或其反应与知识影响裁决时才填requestedNpcRefs，只记录其察觉不必加载；读取目录里带handle的记忆时填requestedKnowledgeRefs），不夹带提案、裁决、风险、成本或结果；服务器按并集重新提供表单，原意图与冻结上下文不变。补选只有一次，且只能新增不能删减；补选后的下一轮只允许提交提案。不得用补选改变玩家方法、换一个更容易填的方案或重开裁决。`,
  expandedProposal: `本轮只能使用已加载的完整表单提交提案，不能再次选择schema，也不能改变玩家方法。`,
  correction: `本条工具结果是对你上一条回复的诊断，同一冻结RequiredContext下修订，最多三轮；工单的round是当前轮次，roundsRemaining是之后还剩的轮次。每轮必须解决工单列出的全部diagnostics并且不引入新错误；一轮的诊断与之前某轮完全相同即视为没有进展，行动终止。两种回复二选一：改动小时调用correct_kp_proposal_bundle，sourceDraftVersion原样回填，revisionJson用mode=patch和operations（仅add/replace/remove，RFC6901路径，相对原稿）；改动多或要增删步骤时直接调用填表工具submit_kp_proposal_bundle提交完整的新提案，本请求的填表工具schema就是它必须遵守的表单。调用submit_kp_proposal_bundle时，工具参数本身就是含decision、check和steps的JSON对象；不要再套arguments、draft或revisionJson字段，不要把整个提案作为字符串放进参数。这些外层字段不属于填表工具。只有调用correct_kp_proposal_bundle时才使用sourceDraftVersion和revisionJson封装。原稿：sourceDraft为"asReplied"时就是你上一条回复的参数（补丁已合成进去）；为null时上一条回复没能解析，只准整稿替换；按填表工具schema重新写完整有效对象，修正诊断指出的嵌套结构，不能原样复制坏JSON或只给它增加字符串包装。本轮替换仍无效则终止。diagnostics里以revision:或tool-response:开头的条目说明你上一条回复没有构成修订（补丁路径无效、版本不符或用错工具），原稿未变，其余诊断仍待解决。只修改decision、check和steps，也可remove原稿根上的多余键；允许替换对象、数组、增删步骤；检定决定结果的步骤放在check里其类型的键下并写success和failure，其余步骤放在steps里其类型的键下并写result；补丁不局限于报错字段，可按诊断重新判断属性、DC、风险、成本、成败后果和操作组合，无须维持被拒绝草稿的错误裁决。必须完整保留玩家真实目标与做法，遵守授权范围、故事锚点和已固化事实；只能使用本轮已加载类型，不补选、不伪造引用、骰面或既成结果，不把技术错误改成世界拒绝。服务器从头校验整份修订稿并执行Rules预检。`,
});

const recoveryInstructions = deepFreeze({
  correction: `依据diagnostics修订原稿：简单修改用修正工具打补丁，复杂修改用填表工具提交完整新提案；同一冻结上下文和玩家意图不变，尚未生效的裁决可以调整，全部字段重新校验。`,
});

// SPEC 0001 §19, SPEC 0016 §7.2 (ADR 0081, ADR 0083): while the actor has a
// failed conversation, check or refusal not yet asked about, the selection may
// ask the player once what changed instead of selecting. The answer returns in
// the task of every later call of the same action.
const retryQuestion = deepFreeze({
  tool: `玩家为一次失败的交谈或检定、或被判定做不到的尝试再次争取同一目标（再试一次、坚持自己能成），却没有说出做法、条件、成本或局势有什么实质变化时，调用本工具问玩家一次，不选类型、不裁决。第一次尝试、玩家已经说出理由或改变（包括愿意再付出代价），或者规则内核与已固化事实明确不允许时，不调用本工具，照常选择类型。`,
  ref: "玩家这次争取所针对的那次裁决：npc-decision的conversation记录里失败交谈的threadRef，或adjudicationPrecedents里那条裁决的precedentId。",
  question: "直接给玩家看的一句话，像主持人那样问这次有什么不同、凭什么觉得能成；可以顺带提一两个有依据的方向，但不替玩家决定，只用玩家角色已经知道的内容。",
  answered: "这次行动开始时你问过玩家一次，玩家已经回答，本行动不能再问。ref是那次裁决，answer为null表示玩家没有补充、照原样进行：",
  rule: "据此判断做法、条件、成本或局势有没有实质变化：有就按补充重新裁决；没有就不再检定，交谈的result写这番话没有起作用，其他尝试用inWorldRefusal说明情况没有变化。补充里玩家说出口的话按actorSpeech的规则逐字保留。",
});
/** The question tool's texts and the block an answer adds to a task. */
export const VNEXT_RETRY_QUESTION_GUIDANCE = retryQuestion;

/** SPEC 0016 §7.2 (ADR 0089): the text that names completeObject, most of it
 * sending a newly settled look or state of an existing object there. Where
 * the frozen context offers no object to complete it is left out, and what
 * the actor perceives stays in its sensory evidence. */
const OBJECT_COMPLETION_SENTENCES = Object.freeze([
  "已有对象的必要未定属性选相应补全类型，",
  "补全须与锚点、固化事实和叙述承诺一致。",
  "为回答本次问题新确定的对象位置、朝向、构造或工作状态，须在同束completeObject写入原对象，不能只放sensoryEvidence。",
  "补全类型只确定原本是什么，",
  "KP补全原本状态写completeObject，",
  "新确定已有对象的外观或状态时同束用completeObject保存，新对象用materializeObject；",
  "，不另写completeObject",
  // SPEC 0015 §11.1: a correction cannot add a type, so the door step names it.
  "缺开关机械的对象须同束completeObject补全；",
  "startCombat/abilityOperation可在steps只放always的补全步骤，先补本次需要的缺项。",
]);

/** The text without the sentences above. */
export function withoutObjectCompletion(text: string): string {
  return OBJECT_COMPLETION_SENTENCES.reduce((rest, sentence) => rest.split(sentence).join(""), text);
}

/** All selectable guidance and defaults are pinned, including unloaded blocks.
 * Assembly uses the same typed closure as schema selection, never action text. */
export const VNEXT_PROPOSAL_GUIDANCE_POLICY = deepFreeze({
  version: "zhuwei.proposal-guidance/v102", selection: "flat-type-selection-refusal-ruled-at-filling-and-step-surface/v6",
  objectCompletionSentences: OBJECT_COMPLETION_SENTENCES,
  // Where each part is sent; vnextProposalRequestMessages builds it (ADR 0043).
  requestLayout: "system-message-is-context-guide-then-frozen-context-then-stage-rules-tools-follow-task-last/v1",
  storySelection: STORY_SELECTION_POLICY_HASH, selectionAuthority, contextUse, terminalSelectionDescriptions, terminalFilling, unknownDestination, newPlaceRule, authority, planRuling, concealedReply, sharedRuling, terminalRuling, approachRule, filling, stages, recoveryInstructions, retryQuestion, catalog: VNEXT_PROPOSAL_CAPABILITIES, producerContract: VNEXT_PROPOSAL_PRODUCER_CONTRACT,
  templates: VNEXT_SEMANTIC_TEMPLATE_CATALOG,
});
export const VNEXT_PROPOSAL_GUIDANCE_POLICY_HASH = canonicalHash(VNEXT_PROPOSAL_GUIDANCE_POLICY);

/** How to read the frozen context. Every stage sends it unchanged, so it
 * opens the system message and the frozen context follows it. */
export const VNEXT_PROPOSAL_CONTEXT_GUIDE = contextUse;
/** The guide where no object can be completed (ADR 0089). */
export const VNEXT_PROPOSAL_CONTEXT_GUIDE_WITHOUT_OBJECT_COMPLETION = withoutObjectCompletion(contextUse);

/** Everything this stage says that does not depend on the action: the KP's
 * authority, the filling rules for the loaded types, and the catalogs. It
 * follows the frozen context in the system message, so the selection and the
 * filling of one action share the guide and the context, and a correction
 * repeats its filling's whole system message. */
export function vnextProposalReferenceRules(stage: VNextProposalStage,
  capabilities: readonly VNextProposalCapabilityId[] = VNEXT_INITIAL_PROPOSAL_CAPABILITIES,
  terminalKinds: readonly string[] = [],
  /** Types the frozen context does not offer (SPEC 0016 §7.2). */
  unoffered: readonly string[] = [],
  /** A loaded type's filling text written for another caller than the
   * hosting KP: an NPC's own decision (ADR 0118). */
  fillingFor: Readonly<Partial<Record<VNextProposalCapabilityId, string>>> = {}): string {
  const rules = stageReferenceRules(stage, capabilities, terminalKinds, unoffered, fillingFor);
  return noObjectCompletionOffered(unoffered) ? withoutObjectCompletion(rules) : rules;
}

function stageReferenceRules(stage: VNextProposalStage, capabilities: readonly VNextProposalCapabilityId[],
  terminalKinds: readonly string[], unoffered: readonly string[],
  fillingFor: Readonly<Partial<Record<VNextProposalCapabilityId, string>>> = {}): string {
  // Keep complete filling boundaries visible before selection and preserve
  // typed dependencies. Their one-line descriptions would repeat them here.
  const offered = VNEXT_PROPOSAL_CAPABILITIES.filter(capability => !unoffered.includes(capability.id));
  if (stage === "offer") return [selectionAuthority,
    `类型目录（只选择ID，不填写提案）：${JSON.stringify([
      ...terminalKinds.flatMap(id => terminalSelectionDescriptions[id] === undefined ? [] : [{ id, description: terminalSelectionDescriptions[id] }]),
      ...STORY_SELECTION_CATALOG,
      ...offered.map(({ description: _description, ...identity }) => identity),
    ])}`,
    "以下是各类型的填写边界，供选择组合；本阶段只填写选择工具声明的字段，不能填写提案：",
    concealedReply,
    approachRule,
    ...(offered.some(entry => isObjectCompletionCapability(entry.id)) ? [completionRule] : []),
    ...offered.map(capability => `${capability.id}：${filling[capability.id]}`),
  ].join("\n");
  const loaded = closeVNextProposalCapabilities(capabilities);
  const hasSteps = loaded.some(id => !VNEXT_PROPOSAL_CAPABILITIES.some(entry => entry.id === id && "surface" in entry && entry.surface === "native"));
  return [authority,
    ...(hasSteps ? [planRuling] : []),
    ...(loaded.some(id => id === "observe" || id === "social" || id === "worldInteraction") ? [concealedReply] : []),
    ...(loaded.some(id => id === "observe" || id === "worldInteraction") ? [approachRule] : []),
    ...terminalKinds.flatMap(id => terminalFilling[id] === undefined ? [] : [terminalFilling[id]]),
    ...(terminalKinds.includes("inWorldRefusal") && loaded.some(id => id === "materializeObject" || id === "worldInteraction")
      ? [unknownDestination] : []),
    `本轮可用终结表单：${terminalKinds.join(",") || "无"}；已加载选表ID：${loaded.join(",") || "无"}。`,
    ...(loaded.some(isObjectCompletionCapability) ? [completionRule] : []),
    ...loaded.map(id => {
      const capability = VNEXT_PROPOSAL_CAPABILITIES.find(entry => entry.id === id)!;
      const title = "definitionKind" in capability
        ? `${capability.proposalKind}（选表ID=${id}，source.kind=${capability.definitionKind}）`
        : isObjectCompletionCapability(id) ? id : capability.proposalKind;
      return `${title}：${fillingFor[id] ?? filling[id]}${id === "materializeObject" ? newPlaceRule : ""}`;
    }),
    ...(loaded.includes("materializeObject") ? [`静态默认模板目录：${JSON.stringify({ templates: VNEXT_SEMANTIC_TEMPLATE_CATALOG.templates.map(({ templateRef, semanticKind, defaults }) => ({ templateRef, semanticKind, defaults })) })}`] : []),
  ].join("\n");
}

/** What this call must do, sent after the tools as the last message. The
 * same amendable flag selects the offered tools and Room's saved-stage proof;
 * the complete, mutually exclusive stage text stays in the hashed policy. */
export function vnextProposalTaskInstruction(stage: VNextProposalStage, amendable = false): string {
  if (stage === "offer") {
    return "提交前核对：requestedNpcRefs不是对话目标列表，只用于补充加载。references.npcRecall.shown里的NPC已经可用，不得再选；只与已加载NPC对话时填[]。每个非空值须逐字属于本次工具字段的enum；没有提供的字段不填写。requestedKnowledgeRefs同样只选本次enum里的handle。";
  }
  return stage === "correction" ? stages.correction : amendable ? stages.amendableProposal : stages.expandedProposal;
}

/** The two parts as one string, for callers that compare the whole surface. */
export function vnextProposalStageInstructions(stage: VNextProposalStage,
  capabilities: readonly VNextProposalCapabilityId[] = VNEXT_INITIAL_PROPOSAL_CAPABILITIES,
  terminalKinds: readonly string[] = [], amendable = false): string {
  return `${vnextProposalReferenceRules(stage, capabilities, terminalKinds)}\n${vnextProposalTaskInstruction(stage, amendable)}`;
}
