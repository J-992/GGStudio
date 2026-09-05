# Poki research → SQUISH!

Research date: September 4, 2026. Deliverable: an original, playable browser game plus an evidence-backed explanation of the design choices. Success for this implementation means a working, tested first release candidate for player testing. Viral distribution cannot be established by implementation or automated tests.

## What we know about the audience

**Documented platform claim:** Poki advertises 100 million monthly players and more than a billion monthly gameplays. It describes itself as operating across 100+ countries. These are Poki's own figures, not independently audited numbers. [Poki for Developers](https://developers.poki.com/)

**Documented device preference:** Poki explicitly says its audience is majority mobile. It prioritizes original ideas, an immediate playable opening, satisfying controls, fast loading, replayability, and a game that feels good on both touchscreens and computers. This makes a desktop-only control scheme a poor default for this brief. [What Poki looks for](https://developers.poki.com/guide/what-we-look-for)

**Useful wider-web evidence, with limits:** Poki commissioned Atomik Research to survey 2,000 weekly web gamers and 400 developers in the US and UK in May 2026. Among the consumer respondents, 37% play web games multiple times daily, 90% multitask while playing, and 54% frequently play with friends or family. The modal reported session was 11–20 minutes, involving two or three titles. These are self-reported behaviors of sampled web gamers, not a representative demographic census of all Poki users. They suggest short, readable, interruption-tolerant play. [Study and methodology](https://poki.com/blog/state-of-web-gaming-report-2026)

**Unknown:** A reliable current, global Poki age/gender distribution was not established from the primary sources inspected. Claims such as “Poki is mostly boys aged 8–14 playing at school” should not be used as facts. Likewise, adult-only traffic panels would not measure children adequately. The design target here is a broad casual/skill audience, including touch users and people who play with the sound off.

## Breakout games and transferable patterns

Public ratings are accumulated engagement signals, not unique-player counts, retention curves, current growth, or proof of social virality. The page snapshots below are not a complete top-games ranking.

| Game | Public evidence inspected | Observed design pattern | Transfer to SQUISH! |
| --- | --- | --- | --- |
| Drive Mad | Approximately 3.80 million ratings; Fancade's testimonial explicitly calls it a viral hit. | Two basic inputs create expressive physics, recoveries, and failures; levels vary the challenge. | A tiny control vocabulary with an immediately visible physical response. |
| Stickman Hook | Approximately 7.85 million ratings on its game page. | Hold/release timing, momentum, and quick retries make improvement easy to perceive. | Press/release maps directly to body shape and stored jump energy. |
| Level Devil | Approximately 4.04 million ratings. | Familiar platforming plus surprising traps creates memorable, easy-to-explain moments. | Add contrast between calm presentation and narrow escapes; introduce hazards gradually. Avoid copying its trap sequences. |
| Poor Bunny | Approximately 250,000 ratings. | Cute character versus rapidly escalating danger; collectibles and local social play extend the loop. | An expressive mascot, optional risky sweets, and a score challenge people can pass around. |

Sources: [Drive Mad](https://poki.com/en/g/drive-mad), [Fancade testimonial](https://developers.poki.com/), [Stickman Hook](https://poki.com/en/g/stickman-hook), [Level Devil](https://poki.com/en/g/level-devil), [Poor Bunny](https://poki.com/en/g/poor-bunny).

Blumgi's developer spotlight also connects a small independent practice to approachable games and iteration. The useful lesson is to invest in tactile feedback and test the core loop; the existence of successful solo developers does not establish a high success probability for any given new game. [Blumgi spotlight](https://poki.com/blog/developer-spotlight-blumgi-games-part-1)

## Interpretation and concept choice

**Plausible:** Success is helped by a mechanic that is legible in a silent, five-second clip; low entry friction; generous retry behavior; a character with recognizable expressions; and opportunities to visibly improve. These are design inferences from the examples, not controlled causal findings.

Three routes were considered:

1. Two-player physics chaos: strong social moments, but needs a partner or convincing AI and brings more control/network friction.
2. One-button movement with a fresh physical tradeoff: strongest scope fit for an original, polished first implementation across devices.
3. Meme/troll obstacle game: easy to explain, but crowded and vulnerable to arbitrary frustration and short-lived references.

Selected route: **SQUISH! — Small blob. Big escape.** A jelly automatically moves through a candy landscape. Holding flattens its body enough to slide beneath presses while charging a spring jump. Releasing restores its shape and launches it. Staying flat is safe under a press but fatal at a gap; releasing is correct for the gap but wrong while still under the press. That conflict gives one button multiple meaningful timing decisions.

Poki recommends focusing on the first session and quick repeatable loops, adding clear goals and satisfying celebration. The campaign uses short stages, instant retries, three-star collection targets, persistent progress, and small cosmetic goals. The daily course adds a shared challenge without requiring account or multiplayer infrastructure. [Engagement guidance](https://developers.poki.com/guide/engagement)

**Speculative:** This specific jelly mechanic, presentation, and daily challenge will produce enough replay and word of mouth to support breakout growth. No claim of proven demand, viral coefficient, retention, or revenue is justified yet.

## Adversarial review

- Survivorship bias: these examples show games that succeeded; many games with simple controls did not. Do not treat the shared properties as a recipe guaranteeing success.
- Familiarity risk: one-button jumping is established. The squish-under/launch-over conflict is the central differentiator, but players may still find it too familiar. Poki explicitly values originality and may reject crowded concepts. [Originality and content policy](https://developers.poki.com/guide/content-player-safety)
- Teaching risk: players may expect the press to jump rather than the release. The opening teaches flattening before gaps, shows charge feedback, and uses collectible arcs to indicate jumps. This remains the first human-test priority.
- Depth risk: three obstacle types and 18 courses are a compact first build, not an hour-long finished content library. Repetition may appear before the end. Expand only after the input loop demonstrates appeal.
- Social risk: a daily share text/link is a sharing affordance, not evidence that anyone will share. No fake multiplayer, live leaderboard, or fabricated player count is present.
- Technical validation cannot measure fun. Automated solvability reduces broken-course risk but does not represent human difficulty.

## First experiment to run

Invite 10–15 new players, including phone and computer users, without explaining the controls aloud. Observe whether they start, understand release-to-jump, clear the first three stages, retry a failure, and voluntarily play another course. Ask what caused the first failure and whether they would send a clip/challenge to a friend. Record first-input time, first-level completion, abandonment point, retry count, and unsolicited replay/share intent.

Suggested internal decision gates—not Poki benchmarks: at least 80% understand the control within 30 seconds; at least 70% clear the first three stages within five minutes; a majority voluntarily start another stage. If the control fails, revise the teaching before adding content. If comprehension is strong but voluntary replay is weak, revise challenge pacing and rewards. A small convenience sample is directional evidence, not a market forecast.

Use Poki's own testing/analytics after acceptance into its developer process to evaluate larger samples. Publishing requires their approval and final platform QA. Their current requirements include device support, lifecycle integration, small bundled assets, storage failure tolerance, and submission thumbnails. [Requirements](https://developers.poki.com/guide/requirements-quality)

## Reusable research prompt

“Research current Poki player behavior using primary sources, distinguish Poki-specific facts from wider browser-game surveys, compare four successful games without equating popularity with virality, and select an original mechanic suitable for a small browser build. Implement and test the first session, list unverified assumptions, and define the smallest human test that could invalidate the concept.”

Optional longer-run prompt: `/goal Improve SQUISH using observed player-test evidence; verify first-session comprehension and replay, implement only justified changes, and prepare a reviewed Poki submission package with documented remaining publisher requirements.` No goal was started for this task.

If parallel agents are explicitly requested in a future research pass, useful independent scopes are audience-source audit, competitor-loop analysis, and adversarial playtest review. This build used no subagents.
