# Poki release checklist

## Implemented and verified

- Desktop, tablet and mobile layouts; full-viewport canvas and scrolling prevention.
  Landscape only on phones, with a rotate prompt that fits any viewport.
- Plays solo or with a second person. Poki's traffic is overwhelmingly single
  player, so the title leads with solo — one hand per robot on the keyboard, one
  thumb cluster per robot on touch — and offers co-op as the alternative rather
  than the requirement.
- Same-computer two-player co-op: keyboard, two gamepads, and split touch controls.
- Online private two-player rooms using the official `@poki/netlib` WebRTC library.
  The host runs authoritative physics; the guest sends input and receives game state.
- PokiSDK `init`, `gameLoadingStart` / `gameLoadingFinished`, deduplicated
  `gameplayStart` / `gameplayStop`, pause-resume `commercialBreak`, and level
  funnel events. `gameplayStart` fires on the player's first input, never on
  load; `gameplayStop` fires on pause, death, level end and run end. Audio is
  suspended before a commercial break and resumed after it.
- Gameplay pauses and clears held input when focus/visibility is lost.
- No runtime fonts, images, analytics, accounts, chat, outgoing links, or third-party ads.
- Progress is saved (furthest level, fastest clear, acts opened for practice) and
  every storage call is wrapped: with localStorage unavailable the game plays
  identically and simply forgets between sessions. Verified by blocking the API
  outright — the game boots with no errors.
- The production build does not include or expose the QA bot/API; `?bot=1` is dev-only.
- `npm run build`, `npm run qa`, `npm run qa:online`, and `npm run qa:dist` pass.
- The build uses `base: "./"`, so assets resolve from the subdirectory a portal serves
  the game from. `npm run qa:dist` frames the real `dist/` at a nested path and fails
  the build if it does not reach the title screen — the check that would have caught
  the rejected upload.
- The Poki SDK script load and `init()` are capped at 5 s, so a blocked CDN cannot
  leave the game stuck on its own loading screen. A boot failure now prints a visible
  message instead of a permanent "BOOTING CONDUIT…".

## Before uploading a Poki version

1. Create the game in Poki for Developers and build with its assigned ID:
   `VITE_POKI_GAME_ID=<assigned-id> npm run build`.
2. Run `npm run qa:dist` against the fresh build before zipping.
3. Upload the **contents** of `dist/`, with `index.html` at the archive root.
4. Run every Poki Inspector QA module, especially SDK Events, Scaling Tests, mobile/tablet,
   incognito, ad-blocker, and external-resource warnings.
5. Confirm Poki's CSP permits the official Netlib signaling/WebRTC endpoints used by the
   library. If Poki requests a resource declaration, list Netlib as private two-player
   game networking and provide the required hosted privacy policy.
6. Test create/join from two real devices and two different networks. WebRTC may use TURN
   when a direct peer connection cannot be established.
7. Supply a static thumbnail for Player Fit testing. Supply the required animated square
   thumbnail before global release.

## Playtest notes

- A death resets the campaign to level 1 by design. The title screen tells players that
  there are no saved checkpoints.
- Online mode has no usernames or chat, avoiding moderation and personal-data collection.
- The bundled production payload is about 1.26 MB gzip, below Poki's 5 MB initial-download
  guidance. Rapier/Three.js make the uncompressed JavaScript chunk large, but the network
  transfer size is the relevant first-load figure.
