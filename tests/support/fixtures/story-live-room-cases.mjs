// Player language refers only to the registered module's public opening.
// These are intentions, never injected truths or prescribed model outputs.
const LOCAL_INTENT = "今晚我先留在黑橡居酒屋，花些时间协助莉安理清近期日常经营中尚待解决的问题。我到炉边说明来意，请她挑一件今晚值得着手的小事，把经过和牵涉的人告诉我；若有人说法不同，我先分别核对，弄清各自的难处。等知道具体情况后，我再决定如何处理。";
export const STORY_ROOM_PROBE_CASES = Object.freeze([
  Object.freeze({
    caseId: "short-local-conflict", implemented: true,
    text: LOCAL_INTENT,
    expectedScale: "short", expectedConnection: "local", expectedMethod: "conflict",
  }),
  Object.freeze({ caseId: "narration-recovery", implemented: true, text: LOCAL_INTENT,
    expectedScale: "short", expectedConnection: "local",
    fault: "One synthetic reasoning-only generation failure leaves the world untouched with the reply pending (ADR 0026); recovery generation and review use the real provider, then the frozen result commits once. No synthetic success." }),
  Object.freeze({ caseId: "daily-investigation", implemented: true, dailyGroup: "investigation",
    text: "我仔细观察遗体口边露出的那片叶梗，想辨认它的颜色、形状和是否有新鲜折断痕迹，不移动遗体或叶片。" }),
  Object.freeze({ caseId: "daily-witnessed", implemented: true, dailyGroup: "witness",
    witnessAssertions: { observerRef: "npc:black-oak-will:lian" },
    actionAssertions: { itemDefinitionRef: "item-definition:module:black-oak-will:oak-leaf",
      itemFactRef: "fact:module:black-oak-will:oak-leaf", observerRef: "npc:black-oak-will:lian", acquisition: "always", sense: "sight" },
    text: "我当着莉安的面，把遗体嘴里那片黑橡叶取出来，凑到烛光下翻看。",
    nextText: "你好，莉安。",
    initialFixture: "Registered module opening; Lian is present in the wake scene. This case, including a custom action, requires a publicly perceptible act. Step 2 does not mention the leaf." }),
  // SPEC 0001 §14: Lian keeps what was said aloud or what she noticed, never
  // the thought or the "unnoticed" framing in the player's input.
  Object.freeze({ caseId: "daily-spoken-intent", implemented: true, dailyGroup: "listener",
    text: "我问莉安她父亲生前是做什么的，心里盘算着先摸清她的底细。",
    listenerForbidden: ["盘算", "摸清她的底细"], listenerRequired: [] }),
  Object.freeze({ caseId: "daily-hidden-act", implemented: true, dailyGroup: "listener",
    actionAssertions: { itemDefinitionRef: "item-definition:module:black-oak-will:oak-leaf",
      itemFactRef: "fact:module:black-oak-will:oak-leaf", observerRef: "npc:black-oak-will:lian", acquisition: "onConcealedSuccess" },
    text: "我装作替赫斯整理衣领，趁莉安不注意把他嘴里那片黑橡叶顺进袖子里，同时问她：“你父亲生前常来守灵厅吗？”",
    listenerForbidden: ["装作", "趁莉安不注意"], listenerRequired: ["你父亲生前常来守灵厅吗"] }),
  // SPEC 0006 §7: an NPC promises to go and look; the next request's NPC
  // work takes it out of the hall for real, before the player's own act.
  // Round138: Lian first asks who a stranger is, then will not leave her
  // father's wake for the yard. Round139: Naes will not be seen at the
  // cellar door tonight, and Varo will not nail it for a stranger. The
  // module's own route takes Lian out of the hall's eyes to talk upstairs.
  Object.freeze({ caseId: "daily-npc-leaves", implemented: true, dailyGroup: "npcMove",
    text: "我叫原团旅人，是来守灵的外乡人。莉安，关于酒窖和你父亲的事，我想私下问你几句，这里人多嘴杂。你先上楼去客房等我，我跟瓦罗先生打个招呼就上来。",
    nextText: "我走到账台前，向瓦罗先生点头致意，说今晚打扰了。",
    initialFixture: "Registered module opening; Lian, Varo and Naes are present in the wake scene." }),
  Object.freeze({ caseId: "daily-items", implemented: true, dailyGroup: "items",
    text: "我捡起脚边那瓶治疗药水，收进自己的背包。",
    nextText: "我取出刚才捡起的那瓶治疗药水，喝掉它来治疗自己的伤势。",
    initialFixture: "One publicly visible unowned SRD healing potion in the starting scene; actor begins with 1 HP." }),
  Object.freeze({ caseId: "daily-spell", implemented: true, dailyGroup: "spell",
    text: "我对自己施放一环疗伤术，治疗自己的伤势。",
    initialFixture: "A compiled level-3 cleric with the real cure catalog spell, available slots and 1 HP; no spell effects are injected." }),
  Object.freeze({ caseId: "daily-combat", implemented: true, dailyGroup: "combat",
    text: "我拔出长剑，冲向莉安并挥剑攻击她。" }),
  Object.freeze({ caseId: "daily-multiplayer", implemented: true, dailyGroup: "multiplayer",
    text: "我在心里回想自己刚到这里时已经知道的事情，不说话，也不向别人分享。",
    initialFixture: "Two authenticated players in the same initial scene; owner alone requests a private knowledge review." }),
  // SPEC 0001 §19 (ADR 0081, ADR 0083): a failed or refused attempt pressed
  // again without a reason may be asked about once; the answer continues the
  // same action, and the ruling made on it is final. Dice and rulings are
  // real: when an earlier ruling did not fail there is nothing to ask about,
  // and an answer step without a waiting question is skipped and recorded.
  // Round155: pushing the hearth (DC 20) and a blow at it (DC 18) were both
  // ruled checks that succeeded, so nothing failed. Lifting the whole hearth
  // overhead is refused or set beyond any roll; a press is sent only while no
  // question waits, so a lucky first roll still leads to a second attempt.
  Object.freeze({ caseId: "retry-refusal", implemented: true, dailyGroup: "retryQuestion",
    text: "我徒手抓住石砌炉台的边沿，想把整座炉台从地上拔起来，举过头顶。",
    steps: Object.freeze([
      Object.freeze({ press: "我再试一次，我觉得我能行。" }),
      Object.freeze({ press: "我再试一次。" }),
      // Round156's answer needed tongs nobody had placed, so the resumed
      // ruling loaded six forms; this one uses only the actor's own body.
      Object.freeze({ answer: "这次我不硬抬了。我蹲低身子，用肩膀抵住炉台一侧，双腿发力，一点点往外推。" }),
    ]),
    initialFixture: "Registered module opening in the wake scene; the stone hearth is a visible, intact feature." }),
  Object.freeze({ caseId: "retry-refusal-decline", implemented: true, dailyGroup: "retryQuestion",
    text: "我徒手抓住石砌炉台的边沿，想把整座炉台从地上拔起来，举过头顶。",
    steps: Object.freeze([
      Object.freeze({ press: "我再试一次，我觉得我能行。" }),
      Object.freeze({ press: "我再试一次。" }),
      Object.freeze({ answer: Object.freeze({ decline: true }) }),
    ]),
    initialFixture: "Registered module opening in the wake scene; the stone hearth is a visible, intact feature." }),
  // ADR 0085: the refusal is always offered; an act the intent can attempt,
  // against someone who may resist and after walking over, is still checked.
  // ADR 0087, ADR 0090: the actor walks to Naes; resisting, he is grabbed by a
  // contest, and if held he is carried along to the hearth.
  Object.freeze({ caseId: "contested-carry", implemented: true, dailyGroup: "contest",
    text: "我走到楼梯阴影里，一把将奈斯拦腰抱起，扛到炉边的烛光下。",
    contest: { opponentRef: "npc:black-oak-will:naes", carryTo: "feature:wake:hearth" },
    initialFixture: "Registered module opening (current version); Naes stands in the stair shadow of the wake hall, the actor at the west entrance." }),
  // SPEC 0014 §4 (ADR 0092): the jump script over a low table; Strength 15
  // clears the 36-inch tables with a run-up.
  Object.freeze({ caseId: "jump-tables", implemented: true, dailyGroup: "jump",
    text: "我退后几步助跑，从拼起的长桌上一跃而过，落到桌子另一边。", jumpOver: "feature:wake:joined-tables",
    initialFixture: "Registered module opening (current version); the actor at the west entrance, south of the joined tables." }),
  // SPEC 0004 §4 (ADR 0097): the hide script behind the joined tables; the
  // NPCs roll Perception against its Stealth total after the act.
  Object.freeze({ caseId: "hide-tables", implemented: true, dailyGroup: "hide",
    text: "我蹲到拼起的长桌后面躲起来，不让瓦罗他们看见我在哪。",
    initialFixture: "Registered module opening (current version); the actor at the west entrance, Lian, Varo and Naes in the wake hall." }),
  // ADR 0097: speaking from hiding ends it for everyone.
  Object.freeze({ caseId: "hide-then-speak", implemented: true, dailyGroup: "hide",
    text: "我蹲到拼起的长桌后面躲起来，不让瓦罗他们看见我在哪。",
    steps: Object.freeze([Object.freeze({ text: "我在桌子后面压低声音问：“瓦罗，第一份遗嘱是谁起草的？”" })]),
    initialFixture: "Registered module opening (current version); the actor at the west entrance, Lian, Varo and Naes in the wake hall." }),
  // SPEC 0004 §4 (ADR 0092): a shove that pushes 5 feet away.
  Object.freeze({ caseId: "shove-away-varo", implemented: true, dailyGroup: "shove",
    text: "我走到账台前，用肩膀把书记官瓦罗从账台边顶开几步。", shove: { opponentRef: "npc:black-oak-will:varo" },
    initialFixture: "Registered module opening (current version); Varo keeps his paper at the ledger counter, the actor at the west entrance." }),
  // Guidance v77: carry still holds on arrival; putting down is a release after it.
  Object.freeze({ caseId: "carry-put-down", implemented: true, dailyGroup: "contest",
    text: "我把奈斯拦腰抱起，扛到炉边，再把他放下。",
    contest: { opponentRef: "npc:black-oak-will:naes", carryTo: "feature:wake:hearth", putDown: true },
    initialFixture: "Registered module opening (current version); Naes stands in the stair shadow of the wake hall, the actor at the west entrance." }),
  // SPEC 0014 §4 (ADR 0092): lying down takes no roll.
  Object.freeze({ caseId: "prone-look", implemented: true, dailyGroup: "prone",
    text: "我趴到地上，贴着地面从长桌底下往楼梯那边看。",
    initialFixture: "Registered module opening (current version); the actor at the west entrance, the joined tables in the middle of the hall." }),
  // SPEC 0014 §4 (ADR 0098): out to the yard, then down into the muddy
  // drainage ditch and up its far side; and over the low stone wall.
  Object.freeze({ caseId: "climb-ditch", implemented: true, dailyGroup: "terrain",
    text: "我从后门出去，到后院。",
    steps: Object.freeze([Object.freeze({ text: "我爬下院子西边的排水沟，再从对面爬上去。" })]), terrain: { featureRef: "feature:yard:drainage-ditch" },
    initialFixture: "Registered module opening (terrain version); the actor in the wake hall, the yard one open passage away with a 3-foot muddy ditch in its west half." }),
  Object.freeze({ caseId: "climb-wall", implemented: true, dailyGroup: "terrain",
    text: "我从后门出去，到后院。",
    steps: Object.freeze([Object.freeze({ text: "我翻过院子东边那道矮石墙。" })]), terrain: { featureRef: "feature:yard:low-stone-wall" },
    initialFixture: "Registered module opening (terrain version); the actor in the wake hall, the yard one open passage away with a 3-foot stone wall in its east half." }),
  // SPEC 0004 §4 (ADR 0112): out to the yard, then the cellar door, locked
  // and nailed shut ("被新钉封死"): a rogue picks the lock with thieves'
  // tools and prizes the boards off with its crowbar (round 175-1: picking
  // alone left the boards, rightly); the default fighter forces it.
  Object.freeze({ caseId: "pick-cellar-lock", implemented: true, dailyGroup: "lock",
    text: "我从后门出去，到后院。",
    steps: Object.freeze([Object.freeze({ text: "我用盗贼工具撬开酒窖门上的锁，再用撬棍把钉门的木板撬下来，把门打开。" })]), lock: { featureRef: "feature:yard:cellar-door" },
    initialFixture: "Registered module opening (current version); a rogue of the criminal background with thieves' tools (Expertise) and a crowbar, in the wake hall; the yard's cellar door is locked and nailed shut." }),
  Object.freeze({ caseId: "force-cellar-door", implemented: true, dailyGroup: "lock",
    text: "我从后门出去，到后院。",
    steps: Object.freeze([Object.freeze({ text: "我用肩膀撞开钉死的酒窖门。" })]), lock: { featureRef: "feature:yard:cellar-door" },
    initialFixture: "Registered module opening (current version); the fighter in the wake hall; the yard's cellar door is locked." }),
  // SPEC 0014 §4 (ADR 0114): out the front door to a street the module does
  // not have, then a shop door there; a door the KP draws on the new map is
  // completed (state, AC, hit points) in the act that first opens it.
  Object.freeze({ caseId: "door-new-place", implemented: true, dailyGroup: "newDoor",
    text: "我推开前门，到门外的街上去。",
    steps: Object.freeze([Object.freeze({ text: "我走到街上。" }), Object.freeze({ text: "我推开街对面那间杂货铺关着的门。" })]),
    initialFixture: "Registered module opening (current version); the fighter in the wake hall; the street outside the front door is not in the module." }),
  // SPEC 0004 §4 (ADR 0099): the owner helps the second player, whose next
  // act rolls its checks with advantage and spends the help.
  Object.freeze({ caseId: "help-ally", implemented: true, dailyGroup: "help",
    text: "我走到同伴身边搭把手，帮他一起把拼起的长桌推到墙边，由他出主力。",
    steps: Object.freeze([Object.freeze({ peer: "我用力把拼起的长桌推到墙边。" })]),
    initialFixture: "Two authenticated players in the wake hall, the joined tables in the middle of the hall." }),
  // SPEC 0012 §§3、5 (ADR 0102): attacking Naes from play starts a fight.
  Object.freeze({ caseId: "combat-start-text", implemented: true, dailyGroup: "combatStart", opponentRef: "npc:black-oak-will:naes",
    text: "我拔出长剑，冲向奈斯并挥剑攻击他。",
    initialFixture: "Registered module opening (current version); Naes at the stair foot of the wake hall, the actor at the west entrance." }),
  // SPEC 0006 §§6、7 (ADR 0101): after the actor's turn the NPC in the fight
  // takes its own, planned from its own view. The room opens in the fight
  // (the actor first in initiative): vNext cannot start one from play yet.
  Object.freeze({ caseId: "combat-npc-turn", implemented: true, dailyGroup: "combatTurn",
    text: "（开局即与奈斯交战）", startsInCombat: Object.freeze({ opponentRef: "npc:black-oak-will:naes" }),
    steps: Object.freeze([Object.freeze({ map: Object.freeze({ command: "endTurn", data: Object.freeze({}) }) })]),
    initialFixture: "Registered module opening (current version); Rules starts a fight between the actor and Naes before any step, the actor first." }),
  // SPEC 0012 §7.2: walking out of Naes's reach offers him an opportunity
  // attack, which he answers himself.
  Object.freeze({ caseId: "combat-opportunity", implemented: true, dailyGroup: "combatOpportunity", opponentRef: "npc:black-oak-will:naes",
    text: "（开局在奈斯身边与他交战）", startsInCombat: Object.freeze({ opponentRef: "npc:black-oak-will:naes", besideOpponent: true }),
    steps: Object.freeze([Object.freeze({ map: Object.freeze({ command: "moveOnMap", awayFrom: "npc:black-oak-will:naes", feet: 15 }) })]),
    initialFixture: "The actor walks next to Naes on the map, then Rules starts a fight between them, the actor first." }),
  // SPEC 0004 §4 (ADR 0097): hidden on its own turn, the actor is looked for
  // by an opponent that can see it at the start of that one's turn.
  Object.freeze({ caseId: "combat-hide", implemented: true, dailyGroup: "combatHide",
    text: "（开局即与奈斯交战）", startsInCombat: Object.freeze({ opponentRef: "npc:black-oak-will:naes" }),
    steps: Object.freeze([
      Object.freeze({ map: Object.freeze({ command: "combatAbility", data: Object.freeze({ abilityRef: "action:hide", target: Object.freeze({ kind: "none" }) }) }) }),
      Object.freeze({ map: Object.freeze({ command: "endTurn", data: Object.freeze({}) }) }),
    ]),
    initialFixture: "Rules starts a fight between the actor and Naes before any step, the actor first." }),
  // SPEC 0012 §§6.3、12, SPEC 0016 §8.2 (ADR 0113): the actor, beside Naes,
  // attacks him with its sword from the map; the blow resolves (hit or miss
  // with its total), a hit deals its damage, the reply's material names the
  // sword, and after the actor's turn the fight goes on to Naes's. A blow that
  // drops him asks the actor first; the case knocks him out, so he lives, and
  // ending the turn with no foe left asks whether to end the fight, which the
  // actor accepts (ADR 0112).
  Object.freeze({ caseId: "combat-strike", implemented: true, dailyGroup: "combatStrike", opponentRef: "npc:black-oak-will:naes",
    text: "（开局在奈斯身边与他交战）", startsInCombat: Object.freeze({ opponentRef: "npc:black-oak-will:naes", besideOpponent: true }),
    steps: Object.freeze([
      Object.freeze({ map: Object.freeze({ command: "combatAbility", weaponAttack: "npc:black-oak-will:naes" }) }),
      Object.freeze({ choose: Object.freeze({ choiceKind: "knockOut", answer: Object.freeze({ kind: "knockOut" }) }) }),
      Object.freeze({ map: Object.freeze({ command: "endTurn", data: Object.freeze({}) }) }),
      Object.freeze({ choose: Object.freeze({ choiceKind: "encounterConclusion", answer: Object.freeze({ kind: "acceptEncounterConclusion" }) }) }),
    ]),
    initialFixture: "The actor walks next to Naes on the map, then Rules starts a fight between them, the actor first; Naes (9 HP, dies at 0) holds a mace." }),
  // SPEC 0012 §12 (ADR 0113): the same blow on a Naes who starts the fight
  // at 2 of 38 HP and, as an important NPC, makes death saves: a hit leaves
  // him dying; on the actor's next turn the bar offers first aid on him and
  // the actor gives it (DC 10 Medicine). With Naes down, ending the turn asks
  // whether to end the fight; the actor declines, to tend him in it (ADR
  // 0112). Steps that have nothing to answer or nobody dying are skipped and
  // recorded.
  Object.freeze({ caseId: "combat-strike-down", implemented: true, dailyGroup: "combatStrike", opponentRef: "npc:black-oak-will:naes",
    text: "（开局在重伤的奈斯身边与他交战）", startsInCombat: Object.freeze({ opponentRef: "npc:black-oak-will:naes", besideOpponent: true,
      opponent: Object.freeze({ hitPointsMaximum: 38, hitPoints: 2, deathSaves: true }) }),
    steps: Object.freeze([
      Object.freeze({ map: Object.freeze({ command: "combatAbility", weaponAttack: "npc:black-oak-will:naes" }) }),
      Object.freeze({ choose: Object.freeze({ choiceKind: "knockOut", answer: Object.freeze({ kind: "dealLethalDamage" }) }) }),
      Object.freeze({ map: Object.freeze({ command: "endTurn", data: Object.freeze({}) }) }),
      Object.freeze({ choose: Object.freeze({ choiceKind: "encounterConclusion", answer: Object.freeze({ kind: "rejectEncounterConclusion" }) }) }),
      Object.freeze({ map: Object.freeze({ command: "combatAbility", stabilize: "npc:black-oak-will:naes" }) }),
    ]),
    initialFixture: "The actor walks next to Naes on the map, then Rules starts a fight between them, the actor first; Naes starts at 2 of 38 HP, makes death saves at 0 HP and holds a mace." }),
  // SPEC 0006 §7, SPEC 0012 §§3.3、13 (ADR 0117): in the fight, the actor
  // gives up in words. The KP records only the actor's side (or lets Naes
  // answer the words); whether Naes accepts is Naes's own decision, in its
  // reply or on its turn after the actor ends its own. An end put to the
  // player is accepted. Either decision passes; the mechanics must follow it.
  Object.freeze({ caseId: "combat-surrender", implemented: true, dailyGroup: "combatEnd", opponentRef: "npc:black-oak-will:naes",
    text: "（开局在奈斯身边与他交战）", startsInCombat: Object.freeze({ opponentRef: "npc:black-oak-will:naes", besideOpponent: true }),
    steps: Object.freeze([
      Object.freeze({ text: "我把长剑扔到地上，举起双手对奈斯说：“我投降，别打了。”" }),
      Object.freeze({ choose: Object.freeze({ choiceKind: "encounterConclusion", answer: Object.freeze({ kind: "acceptEncounterConclusion" }) }) }),
      Object.freeze({ map: Object.freeze({ command: "endTurn", data: Object.freeze({}) }) }),
      Object.freeze({ choose: Object.freeze({ choiceKind: "encounterConclusion", answer: Object.freeze({ kind: "acceptEncounterConclusion" }) }) }),
    ]),
    initialFixture: "The actor walks next to Naes on the map, then Rules starts a fight between them, the actor first; Naes holds a mace." }),
  // SPEC 0006 §7 (ADR 0117): the actor demands that a badly hurt Naes
  // surrender. Naes answers from its own view, in its reply or on its turn:
  // it may yield (the end is put to the player, who accepts) or fight on.
  // Either passes; the mechanics must follow the decision, which is recorded.
  Object.freeze({ caseId: "combat-demand-surrender", implemented: true, dailyGroup: "combatEnd", opponentRef: "npc:black-oak-will:naes",
    text: "（开局在重伤的奈斯身边与他交战）", startsInCombat: Object.freeze({ opponentRef: "npc:black-oak-will:naes", besideOpponent: true,
      opponent: Object.freeze({ hitPointsMaximum: 38, hitPoints: 4, deathSaves: true }) }),
    steps: Object.freeze([
      Object.freeze({ text: "我用剑尖指着奈斯：“你已经站不稳了。放下钉头锤投降，我饶你一命。”" }),
      Object.freeze({ choose: Object.freeze({ choiceKind: "encounterConclusion", answer: Object.freeze({ kind: "acceptEncounterConclusion" }) }) }),
      Object.freeze({ map: Object.freeze({ command: "endTurn", data: Object.freeze({}) }) }),
      Object.freeze({ choose: Object.freeze({ choiceKind: "encounterConclusion", answer: Object.freeze({ kind: "acceptEncounterConclusion" }) }) }),
    ]),
    initialFixture: "The actor walks next to Naes on the map, then Rules starts a fight between them, the actor first; Naes starts at 4 of 38 HP, makes death saves at 0 HP and holds a mace." }),
  // SPEC 0012 §13, SPEC 0006 §7 (ADR 0118): the actor tells Naes to yield;
  // whether he does is the NPC's. When the fight ends he remembers it. Then
  // the actor turns its back on him to take the leaf; if he notices, he
  // decides from his own view and memory whether to let it go, speak, or
  // start a new fight, which would be a new encounter.
  Object.freeze({ caseId: "combat-spared-rebel", implemented: true, dailyGroup: "combatEnd", opponentRef: "npc:black-oak-will:naes",
    text: "（开局在奈斯身边与他交战）", startsInCombat: Object.freeze({ opponentRef: "npc:black-oak-will:naes", besideOpponent: true }),
    steps: Object.freeze([
      Object.freeze({ text: "我用剑指着奈斯：“放下锤子，投降，我就饶你一命。”" }),
      Object.freeze({ choose: Object.freeze({ choiceKind: "encounterConclusion", answer: Object.freeze({ kind: "acceptEncounterConclusion" }) }) }),
      // ADR 0117: he may answer on his own turn instead; the end is put then.
      Object.freeze({ map: Object.freeze({ command: "endTurn", data: Object.freeze({}) }) }),
      Object.freeze({ choose: Object.freeze({ choiceKind: "encounterConclusion", answer: Object.freeze({ kind: "acceptEncounterConclusion" }) }) }),
      Object.freeze({ text: "我转身背对奈斯，趁他不注意，从赫斯遗体嘴边取下那片黑橡叶藏进袖子里。" }),
    ]),
    initialFixture: "The actor walks next to Naes on the map, then Rules starts a fight between them, the actor first; Naes holds a mace." }),
  // ADR 0087: walking over to a mapped object before looking at it, and to a
  // person before talking to them (the walk is its own worldInteraction step).
  Object.freeze({ caseId: "approach-hearth", implemented: true, dailyGroup: "approach",
    text: "我走到石砌炉台旁边，蹲下看炉膛里的灰烬有没有烧剩的纸片。", approachTo: "feature:wake:hearth",
    initialFixture: "Registered module opening (current version); the actor at the west entrance, the stone hearth at the east wall." }),
  Object.freeze({ caseId: "approach-whisper", implemented: true, dailyGroup: "approach",
    text: "我走到书记官瓦罗身边，压低声音问他：“第一份遗嘱是谁起草的？”", approachTo: "npc:black-oak-will:varo",
    initialFixture: "Registered module opening (current version); Varo keeps his paper at the ledger counter, the actor at the west entrance." }),
  // SPEC 0006 §7 (ADR 0110): bystanders who hear a conversation said in front
  // of everyone may interject in the same request.
  Object.freeze({ caseId: "interject-heard", implemented: true, dailyGroup: "interject",
    text: "我当着大厅里所有人的面，提高声音对莉安说：“我看瓦罗先生急着把酒窖门钉死，八成心里有鬼。”",
    initialFixture: "Registered module opening; Lian, Naes and Varo are present in the wake scene." }),
  Object.freeze({ caseId: "retry-conversation", implemented: true, dailyGroup: "retryQuestion",
    text: "我劝莉安今晚就把酒窖的铁钥匙交给我保管，说这样她就不必再为酒窖的事睡不着。",
    steps: Object.freeze([
      Object.freeze({ text: "我再试一次。" }),
      Object.freeze({ answer: Object.freeze({ decline: true }) }),
    ]),
    initialFixture: "Registered module opening; Lian is present in the wake scene." }),
  Object.freeze({ caseId: "new-npc-investigation", implemented: false,
    extension: "Add a distinct natural player intention and acceptance of a genuinely authored new NPC through Rules, its knowledge, Viewer projection and retry." }),
  Object.freeze({ caseId: "long-personal", implemented: false,
    extension: "Add a natural personal goal grounded in an ordinary initial character, then accept a complete long preparation, stages and persistent consequences." }),
]);

// A two-step case whose second request first runs an NPC's promised work
// needs more than ten calls; the per-batch budget still bounds the total.
export const STORY_ROOM_PROBE_LIMITS = Object.freeze({
  maxCalls: 16, maxInputTokens: 960_000, maxOutputTokens: 64_000, callTimeoutMs: 45_000,
});

/** Default action assertions cannot be inherited by an arbitrary --action. */
export function selectStoryProbeCase(caseId, actionText) {
  const selected = STORY_ROOM_PROBE_CASES.find(item => item.caseId === caseId);
  if (!selected || actionText === undefined || actionText === selected.text) return selected;
  const { actionAssertions: _defaultAssertions, listenerRequired: _required, listenerForbidden: _forbidden, approachTo: _approach, contest: _contest, ...custom } = selected;
  return { ...custom, text: actionText, customAction: true };
}
