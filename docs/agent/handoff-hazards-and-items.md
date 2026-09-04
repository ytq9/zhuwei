# Handoff — KP-authored hazards, and the item slice after them

Written 2026-09-04 for the next agent picking this up. Branch `cloudflare`,
HEAD `0a86fc0`, pushed. Everything below is verified against the code as of
that commit, not remembered.

---

## 1. The standing rules you are working under

These came from the user during this session, twice as corrections. Read them
before designing anything; two of the commits below exist because I broke them.

1. **Generalize the system, not the example.** "在设计系统时要泛化能力，而不是硬
   编码，测试用例可以固定，但系统的功能要遵循 spec001 的泛化描述，而不是仅仅满足
   示例." A fixture may pin one save, one formula, one scene. The implementation
   may not. If the settlement only handles the combination your test happens to
   use, you have shipped a template with a wide type on it.
2. **A missing mechanism is work to do, not a boundary to report.** "没有的能力
   你要补足." When the general case needs something the kernel lacks, build it.
   Recording it in the refactor log as out of scope is the move being rejected.
3. **A capability the KP cannot reach is not delivered.** If no wire field,
   lowering, or form can produce the thing, it exists only as a Rules input.
4. **Design questions are answered from `docs/specs/0001-llm-kp-responsibility-contract.md`,
   not from a menu offered to the user.** Sequencing and priorities are theirs;
   the substance of a capability the specification defines is not.
5. **Before inventing fields for a mechanical concept, look for the general
   mechanism the kernel already has.** A narrow parallel vocabulary is the
   hard-coding rule 1 forbids. This is exactly what went wrong in `9066649`.

The overall goal is SPEC 0001 §21's fifteen acceptance scenarios A–O, reached by
continuing vNext-2 rather than patching V3. The user has said V3 is being
replaced and does not need further investment.

---

## 2. What landed this session

Twelve commits on `cloudflare` since `e065427`. The six that matter here:

| Commit | What |
|---|---|
| `dd98ca2` | Every A–O scenario's **mechanical half** now has a named assertion; the registry gate distinguishes mechanical from judgement halves |
| `869da50` | A refused attempt can spend fiction time and resources, not only an item |
| `9066649` | SPEC §8's hazard contract — **superseded in shape by `e190e74`, read that instead** |
| `20662f5` | vNext hazard damage comes from a KP-frozen definition, not only the shipped profile |
| `e190e74` | **A hazard's mechanics are an Ability**, not a bespoke schema (this is the design that stands) |
| `0a86fc0` | Every creature a hazard reaches rolls its own frozen save |

### The acceptance gate

`tests/spec-0001-acceptance.test.mjs` is the runnable A–O gate. It reads each
scenario as two halves:

- **mechanical** — what the kernel enforces whatever the model says. `covers`
  names the asserting tests. All fifteen are covered; the three counts are
  asserted so coverage cannot fall silently.
- **judgement** — what only a ruling settles (was the DC honest, was the roll
  worth asking for). Each judgement half must name a probe in
  `tools/spec-0001-behaviour-probes.mjs` **or** say why it has none. Exactly one
  of the two, asserted.

Two scenarios are worth reading twice before you "fix" them: **G's second layer
of trap** and **M's spotlight switch** take the KP as their subject, not the
kernel. A dungeon may legitimately hold two traps. Enforcing either in code
would reject correct content. They are judgement halves, and the gate says so.

---

## 3. Where the hazard capability actually stands

### The contract (`app/_runtime/lib/rules/v2/environment-hazards.ts`)

SPEC §8 requires nine properties. They split by nature:

- **Four stay in the hazard**, because nothing else in the kernel models them:
  `trigger`, `perceptibleSigns`, `disableMethods`, `environmentalConsequences`.
  Signs and disable methods are required **non-empty** — §10 requires a
  perceptible risk to be foreshadowed, and a danger with no sign and no answer
  is unfair by construction. Consequences may be an empty list; that is the KP
  saying "none", and the field is still required.
- **Five are named by reference**: `mechanicsRef` points at a registered Ability
  definition, which is where attack-or-save, area, damage, conditions and
  duration live. The Ability compiler already validates all of them against the
  2014 rules. **Do not add fields here for those five.** That mistake is
  `9066649` and it was reverted by `e190e74`.

The contract binds on `content.schema`, not on `definitionKind`, because
`environmentHazard` was free text before this existed and older Ability-shaped
definitions carrying that kind are still triggerable. Registration additionally
requires the referenced Ability to be **already registered** — §10 only lets a
danger take effect once frozen.

### The settlement (`app/_runtime/lib/rules/v2/world-interactions.ts`)

What works today, through the non-atomic `resolveWorldInteraction` path:

- Targets: every creature the zone's active `contains` relations reach
  (`registeredHazardTargets`).
- **Saves: each target rolls its own d20 against the frozen DC with its own
  proficiency**, and takes full, half or no damage per `halfOnSuccess`. The
  saves are frozen into the same randomness request as the actor's check
  (`hazardSaveRequests` → `WorldInteractionRandomnessRequest.hazardSaves`), so
  the face count is settled before the first die and no save can be requested
  after the check is known.
- Damage: the Ability's frozen **fixedDamage `Effect`** only.

What refuses rather than mis-settles:

- A hazard whose Ability rolls its damage (`damage` components) — `hazardDamage`
  returns undefined, the effect is refused.
- A save-carrying hazard on a `directSuccess` plan — refused by name
  (`invalidRulesInput`), because nothing was rolled.
- A save-carrying hazard in an **atomic multi-step bundle** — the atomic
  fulfillment validates the roll count as check-dice-only, so the extra faces
  make it reject. Clean, but it is a narrowing, not a design.
- Citing a hazard that was never frozen, or citing the bare mechanics Ability
  instead of the hazard.

### What is not settled at all

- **Conditions and duration.** The non-combat side has no event that applies a
  condition to an authoritative entity — `state.entities[id]` has no
  `conditions`; that lives in `combatRuntime`. This is a genuine kernel absence
  and, per rule 2, it is work to do.
- **KP reachability.** `registerDynamicDefinition` is lowered from exactly two
  sites in `app/_runtime/lib/rules/v2/causal-actions.ts` (~772 and ~3061), and
  they register compound dynamic facts and faction/ability definitions. Nothing
  in `app/_runtime/lib/kp/` emits a hazard. So today the answer to "can the KP
  dynamically generate a hazard" is **no** — it is reachable from a Rules input
  only.

---

## 4. The next pieces, in the order the user asked for

The user said: "按顺序来，这两个都要做" — finish hazards, then items.

### 4.1 Rolled damage

Freeze the Ability's `damage` components' dice into the same request beside the
saves. `WorldInteractionRandomnessRequest.diceExpression` is already a free
string with the convention "check dice first, then the extras in the order the
request froze them"; `DiceRolled` validation in `events.ts` recognises
`^(1d20|2d20kh1|2d20kl1)\+([1-9][0-9]*)d20$` and will need to learn the damage
dice too. `rolledDamageComponents` in `combat-actions.ts:2447` is the existing
logic for turning faces into damage components — it is private, and lifting it
somewhere shared is better than copying it.

### 4.2 Conditions and duration

Build the missing mechanism. A condition applied outside combat needs an event,
a fold, expiry against fiction time, and projection. Look at how
`combatRuntime.entities[id].conditions` is applied and expired first; the
non-combat version should not be a second vocabulary.

### 4.3 The atomic path

Route the shared check's frozen saves to the individual steps that carry the
hazards. `executeAtomicWorldInteractionBranch` (world-interactions.ts:1143)
replays each step through the ordinary interaction path, so the saves map has to
reach `applyBranchEffects` there the same way `settleCheckedWorldInteraction`
passes it today. Note `randomnessRequestForWorldInteraction` currently collects
saves from the **check plan's** branches only; for an atomic bundle it must
collect across every step's plan.

### 4.4 KP reachability

Wire + lowering so a KP proposal can freeze a hazard (and its mechanics Ability)
and cite it from a branch. Until this exists, none of the above is reachable by
the model. Do this **after** the settlement covers the range, or the KP will
author hazards the kernel refuses and the player sees a repair loop — which is
the production failure that started this whole line of work.

### 4.5 Then items

`materializeObject` on the vNext wire offers `sceneFeature`, `worldFact`, `npc`
and `worldRelation`. There is no `item`, so vNext cannot freeze something a
character picks up and carries; the item system (`rules/v2/items.ts`,
`ItemMaterialized`, `createInitialItemEntry`) exists and is used by V3. SPEC §8's
treasure paragraph and §21.E are what this serves. Same rule applies: reuse the
item system's vocabulary rather than restating it on the wire.

---

## 5. Operational notes that will cost you an hour if you miss them

- **Worktree.** Work in `/home/ubuntu/workspace/zhuwei/.claude/worktrees/fork-verify`.
  Never `cd` to the parent repo. Never use bare `git stash` — the stash stack is
  shared across worktrees.
- **Never touch `origin/main`.** It is the pre-V3 `src/` generation and unrelated
  to this tree. Pushes go to `cloudflare` as fast-forwards.
- **Worker tests need a build**: `npm run build` first, then
  `npx vitest run <file> --testTimeout=120000`. The 5000ms vitest default is too
  short for the Room tests on this machine and every one of them will time out
  and look broken.
- **`npm run test:unit` hangs.** `tests/combat-mechanics-v2.test.mjs` hangs during
  import (pre-existing, recorded in the refactor log). Run the node suite as
  `npx tsx --test $(ls tests/*.test.mjs | grep -v combat-mechanics-v2)`.
- **Known-failing, not yours**: `kp-v3-eval` ("KP V3 runner invokes production
  seams…"), `rendered-html` ("email session opens the hall…"),
  `stage4-world-campaign-vertical-v2` ("keeps two readers' knowledge…"),
  `combat-vertical-v2` ("enters one multiplayer Encounter…"). All four reproduce
  with the session's source changes reverted to HEAD. `combat-room-randomness-v2`
  fails only under full-suite load and passes alone.
- **eslint** reports one pre-existing error: an unused fixture
  `materializeAlcoveAloneBundleV2` in `tests/kp-vnext-stage3-room.test.ts`.
- **A guard will catch you**: `tests/kp-vnext-world-interaction-rules.test.mjs`
  asserts that world-interaction production sources contain no fixture or
  material names — including 陷阱. Quoting SPEC §8 verbatim in a comment in those
  files trips it. Paraphrase; do not relax the guard.
- **The DeepSeek key is a limited test credential.** Do not call the live API
  except for a genuine verification run such as the strict-tool handshake.
- Every change gets an entry appended to `docs/refactor-log.md` — goal, symptom
  and cause, files and their direct consumers, the targeted checks actually run
  with exit codes, and what is not covered. That is a repo convention, in
  `AGENTS.md`.

---

## 6. One thing worth not re-deriving

vNext is dormant in production on two independent axes, and neither is an
oversight to "fix" casually:

- The Workers runtime constructs `new RoomDurableObject(ctx, env)`, so the third
  and fourth constructor parameters — the vNext rules runtime and the
  adjudication bridge — cannot be injected at all. `tests/room-worker.ts` shows
  the wiring pattern: a subclass bound to its own Durable Object namespace.
- `WORLD_INTERACTION_PROFILE` is in no production manifest.
  `VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST` already exists and includes it, and its
  own document declares `productionDefault: false`.

Turning either on means a Durable Object namespace binding and a migration, and
existing rooms replay under the manifest their genesis pinned. That is a
deliberate deployment decision, not a loose end.
