# Ninja Flow — agent rules

A 2.5D reaction-timing fighting game. Two inputs, both sides, timing is the
whole game. Read `README.md` for the architecture; this file is only the rules
that differ from the repo-wide ones in `../AGENTS.md`.

## Verification

```sh
npm run verify        # typecheck + unit tests + build, the whole gate
npm run test          # vitest only
```

There are no browser tests, and none should be added — see `../AGENTS.md`. What
the suite does instead is simulate whole runs headlessly against the real
systems (`src/tests/RunModel.ts`) and assert the balance targets, so a change
that makes the game unfair fails in CI rather than in a playtest.

**The two RNG streams in `RunModel` are not an accident.** The director rolls
from `rng`; the simulated player rolls from `playerRng`. Cosmetic work — a new
enemy style, a weapon rotation, a hat — must draw from a module cursor or
`Math.random`, never from the seeded gameplay stream, or every balance test
reshuffles and the failures mean nothing.

## Things that look like bugs and are not

- `src/config.ts` holds every tunable number. Balance work belongs there, not
  in the systems.
- Attack timing is scheduled **impact-time first**, then worked backwards. A
  threat is never allowed inside `MIN_ANSWER_GAP` of the previous one; that
  floor is what makes the game fair, and `src/tests/fairness.test.ts` guards it.
- The procedural pose layer is applied *additively on top* of the mixer's
  output, so authored idle clips and millisecond-accurate combat coexist. Do
  not replace one with the other.

## Poki

`poki.json` registers the game with the repo's deploy pipeline. `PLATFORM.ads`
in `src/config.ts` must stay `true` in anything that reaches the dashboard.
