# Elastic campaign implementation

## Play

Run `npm run dev:tether` (the default `dev` command belongs to Squish).

- P1: A/D move, W jump, **hold S to grip**.
- P2: arrows move, up jump, **hold down to grip**.
- Gamepad: stick move, A/Cross jump, **LB/L1 grip**.
- Touch: separate GRIP pad beside each robot's controls.

Only gold twin rails accept grip. The robot locks across the face but continues
forward along the powered rail. Release grip or jump to detach the boots; the
robots' tether never disconnects. Rails end visibly, and attachment ends there.

While a partner grips, the flyer uses lower spring damping and retains momentum
instead of automatically winching. Steer out, jump inward, and release the
anchor during the returning arc. The gold rope pulses and the HUD identifies
the anchor, both-locked condition, and a returning-spring release opportunity.
This cue describes the spring state, **not a guaranteed safe landing**.

If hanging, release jump and press/hold it again to request recovery. Automatic
rescue behavior remains outside intentional elastic flight. An anchored swing
gets a bounded seven-second air window; unanchored falls retain normal limits.

## Curriculum and scope

The campaign remains twenty courses. Four early elastic courses introduce
catching, swinging, slingshots, and alternating anchors. Five rigid rotating
drum courses teach real moving support and mandatory face changes. Familiar
belts, launch pads, ferries, shutters, and crumbles return with optional rails.
Learning courses retry the current level, without restarting the campaign or
respawning already-collected coins. Manual restart keeps the existing behavior.

The rail route is traversable without a mandatory input checklist. This first
pass makes elastic moves available and recoverable; it does **not** establish
that every new course requires or rewards them enough. Human playtesting must
measure use, comprehension, and route choice before treating this as final balance.

Current drums are **whole-course rigid assemblies**, with independent fixed
background scenery. Their colliders, magnetic surfaces, coins, local gravity,
camera roll, and network phase follow the same rotation. This is actual
kinematic geometry, not a camera-only effect. Missing-face stretches prevent
staying on the original face for the whole course.

Not implemented in this pass: seams between independently rotating drums and
static hubs, opposite-speed neighboring drums within one course, per-player
support frames across those seams, and dedicated
handoff scoring. Early elastic courses do include optional below-face coin
trails, but their human difficulty still needs playtesting. Do not author
mixed moving features inside a drum: the rigid-only authoring guard rejects
unsupported configurations. No rope wrapping, cutting, or new release impulse.

## Engineering contracts

- `M` is solid magnetic terrain. Twin rails/ties are one batched mesh per level.
- Grip constrains the anchor, so tether correction assigns movement to the flyer.
- Release preserves earned velocity; no synthetic slingshot kick is injected.
- Grip inputs clear on blur and propagate through bots, assist, touch and online.
- Assist will not replace an active rescue winch with a fresh swing attachment.
- The host synchronizes drum phase, feature clock, boot state and release cue.
- Collision shapes stay axis-aligned in drum-local space during gravity rolls.
- Collider and visual drum poses derive from the same fixed-step angle.
- Loading frees the previous Rapier world; level art disposes owned GPU assets.
- The other agent's Squish files are outside this change.

## Verification and remaining playtest gate

`node scripts/elastic-qa.mjs` exercises actual inputs, anchor stability, spring
acceleration, release continuity, kinematic support, network state, and visuals.
`node scripts/campaign-playthrough-qa.mjs all 3 2` checks collision-enabled
traversal and mandatory face coverage. `node scripts/campaign-art-qa.mjs` checks
authoring, safe phrase approaches, scene resource stability and screenshots.

Bots establish traversability, not fun. Before release, test with novice pairs
and solo assist: can they explain grip/release, perform an intentional catch,
choose an elastic route, see the landing, and recover without confusion? Track
deaths by encounter and separate an unreadable rule from a missed execution.
Adjust one difficulty dimension at a time. No claim of improved retention or
"addictiveness" is supported yet.

### Latest validation

- TypeScript and isolated production build passed (the existing large-bundle warning remains).
- Full twenty-course run passed with robot collisions enabled, speed 3, all on
  the first attempt; required four-face coverage passed on courses 10–12, 18, 20.
- Authoring checks, five visual environments, repeated-load resource stability,
  and mobile-landscape screenshots passed.
- Focused tests cover all grip input paths, stable anchors, spring acceleration,
  release, forward rail carry/endpoints, explicit recovery, assist handback,
  optional rewards, retry coin preservation, six seconds of real rotating
  support, and host/guest state serialization.
- Actual peer-to-peer matchmaking and human co-op balance were not playtested
  in this pass. Snapshot checks are not an end-to-end network session test.
