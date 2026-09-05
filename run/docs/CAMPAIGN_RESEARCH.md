# Tether Run: campaign improvement research

## Objective and evidence

Make each run worth another attempt through visible improvement, readable hazards,
new applications of familiar controls, and memorable places. This is a design and
engineering task; retention improvements remain hypotheses until tested with players.

The research-agent workflow separated four routes: mechanic curriculum, challenge
timing, visual readability, and an adversarial pass on unfair or avoidable challenges.
No additional agents were spawned because another agent owns gameplay and UI work.

Sources consulted:

- [Maddy Thorson, Celeste & Forgiveness](https://www.maddymakesgames.com/articles/celeste_and_forgiveness/index.html):
  generous input/position windows support difficult execution. Run already has coyote
  time and jump buffering; design around those existing controls.
- [Nintendo, New Super Mario Bros. U developer interview](https://iwataasks.nintendo.com/interviews/wiiu/nsmbu/0/0/):
  intuitive interaction and satisfying both beginners and skilled players are explicit
  development concerns. Use geometry and symbols to teach before relying on text.
- [Ryan, Rigby & Przybylski (2006)](https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MandE.pdf):
  four studies associate perceived competence and autonomy with enjoyment; multiplayer
  findings also support relatedness. This supports mastery, choices and cooperation,
  but does not establish a universal novelty interval or prove retention for Run.
- [GDC: Designing Celeste](https://www.gdcvault.com/play/1024307/Level-Design-Workshop-Designing-Celeste):
  relevant further viewing; only the session overview was inspected, not the full talk.
- [Michael Booth / Valve, The AI Systems of Left 4 Dead](https://cdn.akamai.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf),
  slides 77–91: build intensity, sustain it, then allow recovery. Valve distinguishes
  encounter frequency from difficulty. The transferable idea is contrasting phrases;
  its combat timing and adaptive director are not directly applicable to this runner.

## Authoring rules

Use introduce → develop → twist → resolve as an authoring heuristic, not a scientific
formula. Introductions have broad support; variations change one demand; combinations
arrive after practice. Endings give space to enjoy the success. An act-ending test can
be harder; the next act temporarily reduces precision while teaching its new rule.

At 9 units/second and 2 units/slice, a slice lasts about 0.222 seconds. A six-slice
warning is about 1.33 seconds, while a two-slice warning is only 0.44 seconds (less
after the hint trigger offset). Initial hints should arrive several slices before the
action. Aim for roughly 4–8 seconds between distinct challenge phrases, then playtest;
these timings are starting assumptions, not research results.

Preserve broad landing zones after launches. A launch gap is not a precision landing
lesson until the character actually descends onto the narrow surface. Check both
robots with physical collision enabled. Never infer human fairness from bot success.

## Curriculum

| Levels | Environment | New understanding | Escalation |
| --- | --- | --- | --- |
| 1–4 | Service dock | steering, short/held jumps, crumble, lanes, sweepers | floor fundamentals → first exam |
| 5–8 | Orbital gantry | wall roll, ceiling, hazards on other faces | one turn → complete circuit |
| 9–12 | Induction plant | automatic launch, air steering, conveyor drift | safe pad → wall launch; drift → counterflow |
| 13–16 | Transit array | moving support, opposite phases, shutter timing | broad ferry → divided ferries; broad bypass → tighter gates |
| 17–20 | Reactor core | combinations of known mechanics | belt + gate; orbit + ferry; multi-stage final exam |

Introductions should feel different from exams. Do not add new buttons during the
finale. New applications (counterflow, opposite-phase support, crumble on a wall)
extend the vocabulary without adding input complexity.

## Visual language

Five environments use distinct panel finishes, structural silhouettes and accent
lighting. Gameplay meanings stay constant: amber cracked panels crumble, green
chevrons launch, blue arrows carry, violet striped decks move, red grilles threaten.
Shapes must carry meaning as well as color. Ledge strips belong only to existing
support immediately before missing support; never draw a decorative false platform.
Background machinery stays outside the collision envelope and is deterministic.

## Findings and limitations

### Candidate next mechanic: rotating tunnel drums

User suggestion: continuously rotating level pieces that encourage use of all faces.
Keep this candidate. It has a stronger visual identity and traversal demand than
another hazard tile. It is not implemented in this pass.

Prototype a short cylindrical support band with a broad missing sector, between two
stationary square landing collars. The opening moves visibly around the band, so the
pair follows supported faces. Teach with one slow drum and full-width entry/exit;
develop with longer unsupported sectors; twist with two drums turning in opposite
directions; test with a previously learned hazard after a stable landing. Introduce
after the four-face circuit, before mixing drums into finale content. Do not add it
to the current finale without its own practice stages.

Engineering gate: Run currently uses four discrete gravity frames and axis-aligned
level patterns. A continuously moving floor requires moving collider transforms,
contact velocity transfer, a clear rule for gravity between faces, swept collision
checks, and support prediction shared by the assist player and QA bot. Rotating only
the artwork would misrepresent walkable ground. An indexed 90-degree rotating collar
could be an intermediate prototype, but is a different mechanic and should be named
accordingly. Test the continuous version at low angular speed with two colliding
robots before committing to its campaign slot.

### Current evidence

Implemented: eight stages rebuilt into four named phrases; ten other stages adjusted
for warning timing, mandatory traversal or landing space. All twenty receive the five
environment styles. Level 10 now ends on the right wall, with wall crumble after the
launch; level 11 adds counterflow; level 14 develops opposite-phase moving decks.
Levels 8, 18 and 20 now remove the unused faces in their circuits. Previously, leaving
the left wall solid let players skip the intended right-wall and ceiling traversal.
The playthrough checker now requires all four gravity orientations in those stages.

The main failures in testing were narrow ferry boarding, simultaneous robots crossing
lanes into a wall barrier, insufficient recovery after a ceiling ferry, and the final
launch/landing while robots were staggered. Revisions add approach alignment and
landing space. They do not change the other agent's controls, assist player, physics,
networking, save data, menu or HUD.

Verification commands:

```sh
npx tsc --noEmit
node scripts/campaign-art-qa.mjs
node scripts/campaign-playthrough-qa.mjs all 3 2
node scripts/campaign-playthrough-qa.mjs 8,18,20 3 2
```

The playthrough tool runs a private server with hot reload disabled, reports each
attempt, and keeps per-slice context on failure. Checks start each level separately;
they do not demonstrate a continuous deathless campaign or model a new human player.
The art check validates authored patterns, approach runways, hints, required faces,
resource cleanup, and desktop/narrow-landscape screenshots. It does not measure FPS
on low-end phones. Existing late-game draw-call counts remain a performance concern.

Validation outcome (2026-09-05): every current level cleared in collision-enabled
checks, combining the campaign run with targeted reruns after revisions. The final
versions of 14, 18 and 20 cleared on their first standard-speed attempt. Levels 8,
18 and 20 recorded Floor → RightWall → Ceiling → LeftWall. TypeScript, production
build, pattern/route assertions, resource disposal and browser exception checks pass.
This is not a claim of a single continuous 20-level clear or a human-tested curve.
Builds and screenshots were written to temporary directories; the shared dist and
other agent's gameplay/UI files were left alone. No commits or publishing performed.

Verified in the starting code: level 13 repeated the same width despite announcing a
narrower platform; level 14 promised opposite ferries without using the opposite-phase
character; several hints arrived too close to the event. Floor-only obstacles also
permit wall bypasses. Keep creative bypasses unless a lesson requires a true void.

Plausible: an authored difficulty rhythm and clearer assets will improve understanding
and replay interest. Unproven: player retention, exact challenge targets, and whether
the full-run death penalty supports learning for this audience. Existing act practice
helps, but its visibility and restart rules belong to the concurrent gameplay/UI work.

Do not promise that the game is addictive based on automated checks. Test with at
least five new pairs and five experienced pairs: record first death location, whether
they can explain the introduced mechanic, attempts to clear each act, voluntary
retry, and where they stop. Separate solo-with-assist from two-human runs. If first
deaths cluster before understanding, improve the demonstration; if a learned phrase
is repeatedly effortless, increase one precision or coordination demand.

Reusable research prompt: Audit Run's real traversal constraints, compare primary
developer/research sources, and propose falsifiable improvements to novelty cadence,
visual readability and challenge. Distinguish tested facts from design hypotheses.

Optional long-run prompt (not started): `/goal Playtest and tune the 20-level Tether
Run campaign until all stages pass collision-enabled traversal checks, every mechanic
has a readable introduction and meaningful remix, and human playtest observations
support the intended difficulty curve; preserve concurrent work.`
