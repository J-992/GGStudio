# Merge Ninja — Core Gameplay Prototype (Historical Plan)

> This is the original prototype brief, retained for design history. The game
> has since expanded beyond it; use `README.md`, `DECISIONS.md`, and the tested
> data modules under `src/data/` for current playtest behavior.

Playtest prototype for kids 6–12. Inspiration: Merge Knights Battle (Poki). One question to answer: **is buy → merge → power spike → fight → earn fun enough to keep doing?** Spend effort on merge feel, visual progression, combat feedback, reward pacing, and the first 10 minutes. Build nothing else.

## Revisions vs. original draft (binding)

1. **Escalating buy tier.** Buying only Tier 1 makes Tier 9 cost 2^8 = 256 purchases — the pacing targets in §Pacing are unreachable. Rule: `buyTier = max(1, highestTierEverOwned - 4)`. The BUY button shows the tier it spawns (like Merge Knights' "Lv. 5" button). Buy price scales with buyTier: `cost = round(10 * 1.05^purchases) * 2^(buyTier-1)` — tune later.
2. **Trash/sell slot.** 12 slots + 12 tiers can deadlock (one of each tier = frozen board). Add a trash-can drop target next to the board: drag a ninja onto it → sells for 50% of its cumulative cost, small coin burst. Confirm nothing; it's low-stakes.
3. **Minimal autosave.** One localStorage function persisting coins, board contents, enemyIndex, totalPurchases, highestTierEverOwned. Save on merge/buy/kill (debounced 1s). Load on boot. Nothing else — no versioning, no cloud, no UI.
4. **Mobile-first.** Touch drag is the primary input; pointer events, no hover-dependent affordances. Responsive letterbox canvas; test at 390×844 portrait and desktop.
5. **Asset pipeline is sprite-sheet based** (see §Assets). Code must load characters from a texture atlas + JSON config so sheets can be re-sliced/replaced without touching logic. ASSET_LICENSES.md from day one. Initial download budget ≤20 MB (CrazyGames).
6. **Audio is procedural.** WebAudio-synthesized SFX (jsfxr-style: click, coin, pickup, merge, hit, strong hit, defeat, new-tier fanfare, boss defeat). No music track in v1; leave a mute toggle and a music hook.

## Tech

TypeScript + Phaser 3 + Vite. No backend, local assets, 60 FPS target, fast startup. Keep it simple.

## Layout (single screen, portrait-friendly)

- Top ~45%: arena — enemy (top) vs player ninja (bottom of arena), HP bars, stage indicator.
- Middle ~45%: merge board, **12 slots, 3 rows × 4 cols**, circular slot markers. Trash can at board edge.
- Bottom bar: coin count, BUY NINJA button (shows tier + cost).
- Understandable with zero instructions.

## Merge mechanic

Ninja: `{id, tier, boardSlot, attack, maxHealth, displayName, spriteKey}`. Tier X + Tier X → Tier X+1, identical tiers only. Drag feedback: valid target pulses + glow ring + slight scale-up; invalid → smooth return; empty slot → move; trash → sell. Deterministic, no ambiguous snapping. Dragging must feel instant.

## Merge animation (~0.55s total)

snap together → flash (100ms) → smoke puff + star burst (150–200ms) → new ninja pops in oversized → bounce-scale down (300–500ms) → tier badge. Slight screen shake for tier ≥5, bigger for tier ≥8. This is the most important moment in the game — do not ship a despawn/spawn swap.

## Tiers (12)

| # | Name | Look | Attack |
|---|------|------|--------|
| 1 | Ninja Trainee | wooden sword, tiny, clumsy | small swipe |
| 2 | Rookie Ninja | hood, metal sword | faster slash |
| 3 | Dual Blade Ninja | two swords, shoulder guards | double slash |
| 4 | Shadow Ninja | dark outfit, scarf, glowing eyes | dash slash |
| 5 | Fire Ninja | flaming sword, warm armor | fire slash |
| 6 | Lightning Ninja | electric weapon + markings | rapid strike |
| 7 | Wind Ninja | flowing robes, oversized blade | wind projectile |
| 8 | Dragon Ninja | dragon armor, horned helm | dragon energy slash |
| 9 | Spirit Ninja | spectral, floating, glowing symbols | spirit clone |
| 10 | Master Ninja | ornate armor, big weapon, aura | sweeping strike |
| 11 | Celestial Ninja | energy ribbons, floating symbols | screen-crossing strike |
| 12 | Legendary Shogun | ceremonial armor, oversized weapon, max VFX | dramatic impact |

Stats: `attack = 5 * 1.75^(tier-1)`, `health = 20 * 1.65^(tier-1)`. Each tier ≈ 1.6–2× effective power. All in balance config.

## Art direction

Chibi cartoon, chunky, high contrast, clean silhouettes, readable at 64–128 px tall. Big heads, exaggerated weapons. No blood — defeats are smoke/stars/cartoon poofs. Every tier distinguishable at a glance.

## Assets (Fable supplies — orchestrator uses placeholders until then)

Fable generates sprite sheets via Higgsfield and drops finished, sliced, transparent PNGs into `assets-staging/` with `assets-staging/MANIFEST.json` (`{file, key, kind, tier?, license}`). Until that lands: clean programmatic placeholders (colored circles with tier number + distinct accent shapes are fine). Architecture requirement: swapping placeholder→real art = editing the atlas/config only. When notified assets are staged, integrate them (Phase 5), downscale/pack if needed, update ASSET_LICENSES.md (all entries: "AI-generated via Higgsfield, original work, © Reaper8202").

## Combat

Interval-based, no AI/pathfinding/hitboxes: attack timers, damage, HP. Player's **highest-tier owned ninja** is the arena fighter (board copy NOT consumed); on new highest tier, arena fighter transforms immediately with VFX. Combat runs continuously while the player merges. Attack cadence 0.8–1.4s. Fight sequence: idle → dash forward → impact → enemy flash + damage number + knockback → return.

Every hit: damage number, impact particle, sprite flash, small knockback, HP bar tween. Strong hits add shake + 30–60ms hit-stop (sparingly).

## Enemies

5 regular + 1 boss, shared animation logic, escalating stats:
Training Dummy, Rival Trainee, Masked Bandit, Heavy Warrior, Elite Rival Ninja; boss = Dojo Master (3–5× HP, bigger sprite, obvious entrance, big reward). `enemyHealth = 15 * 1.12^enemyIndex`, `enemyDamage = 2 * 1.08^enemyIndex`. Boss every ~10 kills (config). Enemy defeat: knockback → smoke → coin burst flying to counter → next enemy in <1s. Boss defeat: coin shower, shake, victory text, ~1.5s max.

Rewards: enemies 1–5 give 5/6/8/10/12 base, boss 30; scale with stage. Player should regularly afford another ninja.

## Losing

No punishment. Ninja poofs → "Train More!" → battle pauses → player keeps merging → stronger fighter auto re-enters. No currency/board/progress loss.

## Economy

Coins only. Start 30. Base ninja cost 10, growth 1.05^purchases (see revision 1 for tier multiplier). Board full → button shakes + highlight mergeable pairs; no error text.

## Pacing targets (verify by playing)

- 0:00–0:15 first buys, first merge, Tier 2
- 0:45 Tier 3, first kills · 1:30 Tier 4 · 3:00 Tier 5 (Fire — big visual milestone)
- 3:00–5:00 Tier 6–7, first boss · 10:00 Tier 7–9
- New-tier discovery: ~0.8s celebration overlay ("NEW NINJA! FIRE NINJA"), no modal, auto-continue. Emphasize tiers 4, 5, 8, 10+.

## Onboarding (no tutorial screens)

Start with 30 coins, BUY pulses → after second identical ninja, both pulse + small animated hand shows the drag → disappears forever after first merge. Idle 4–6s with a valid merge available → pulse the pair (always-on hint, not just first time).

## Difficulty rhythm

Player strong → easy kills → enemies catch up → progress slows → merge → power spike → repeat. First 30s must feel powerful. Never fully blocked (coins keep trickling since even a weak ninja beats early stage enemies after re-entry; if ninja is dead and can't win, lower stage HP creep or grant small idle income — tune in Phase 6).

## Explicitly out of scope

Accounts, achievements, dailies, ads, IAP, skins, world map, story, quests, inventory, skill trees, multiplayer, leaderboards, settings screens, localization, multiple biomes. Do not build.

## Architecture

```
src/main.ts
src/scenes/{BootScene,GameScene}.ts
src/systems/{MergeSystem,CombatSystem,EconomySystem,EnemySystem,ProgressionSystem,SaveSystem}.ts
src/entities/{Ninja,Enemy}.ts
src/ui/{MergeBoard,BuyButton,HealthBar,CurrencyDisplay,TrashSlot}.ts
src/effects/{MergeFX,CombatFX,CoinFX}.ts
src/audio/Sfx.ts        (procedural WebAudio)
src/data/{ninjas,enemies,balance}.ts
assets/…
```

All balance numbers in `src/data/balance.ts` (starting coins, costs, growth rates, intervals, boss cadence, merge animation duration, tier stat curves). Game tunable without touching logic.

## Debug panel (backtick key, hidden by default)

+coins, spawn tier N, clear board, skip enemy, spawn boss, game speed, reset run. Also shows session metrics: time played, purchases, merges, highest tier, kills, boss attempts/defeats, board-full count, combat failures.

## Build order (do not reorder)

1. **Loop:** board, buy, spawn, drag/drop, merge, coins, trash, save. Merging must feel good before anything else.
2. **Combat:** strongest-ninja fighter, enemy, HP, attacks, kills, rewards, next enemy.
3. **Progression:** tier stats, enemy scaling, boss, failure/re-entry, buy-tier escalation.
4. **Juice:** merge anim, impact, coin flight, spawn anim, new-tier reveal, boss presentation, particles, SFX. Do not skip.
5. **Art:** integrate staged sheets, silhouette check per tier.
6. **Balance:** play 0:00→10:00 repeatedly against §Pacing; tune balance.ts only.

## Acceptance test

Fresh player, no explanation: buys in ~10s, understands merging by ~20s, first merge by ~30s, understands stronger-ninja=stronger-combat by ~60s, hits a real obstacle/boss by 2–3 min, has seen several distinct ninja forms by 5 min. Purchasing responsive, dragging smooth, merge targets obvious, progress never stalls. If not met: rebalance before adding anything.
