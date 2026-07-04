# Ski game

A 3D browser-based skiing game in the spirit of PS2-era SSX Tricky: an
endless procedurally generated walled track — a banked ice channel floating
in a dusk sky above a city — with obstacles, jumps, and pickup lines. Static
site, no server.

Design rules: punishment is light — obstacle hits cost a 1.3s tumble and most
of your speed, never the run; the walls contain you physically (rideable
banks that steepen), no fences or fail states. The economy is SSX Tricky's:
the run is measured in speed and distance (HUD is SI: m/s and m), and the
BOOST TANK (tall vertical bar, left edge; big and slow on both ends) fills
only from deliberate rewards — coins, gems, and above all TRICKS. The mouse
is REQUIRED and never changes meaning (x steers / aims the landing, y is
stance, buttons brake/boost); WASD exists only for tricks: in real air (past
MIN_TRICK_AIR — never roller hops) A/D spins, W frontflips, S backflips, and
you can aim with the mouse mid-trick. Land within tolerance of whole
rotations for big boost (flips pay more than spins); past commit still
mid-rotation and you tumble — spins commit at a half-turn, flips at ~70
degrees (a 90-degree-pitched landing is a faceplant, not a stumble); under
commit always bails safe. A live degree readout (green ✓ when lined up) plus
NICE!/SPUN OUT banners make it legible. Racing alone earns nothing. Burning
is hard acceleration with flames, rainbow trail, FOV slam, rumble. Reward
loop over penalty loop.

Terrain is a pure height function: a curving centerline (straight near the
start and uphill of it, for gentle run-ins and predictable physics tests)
plus a U-channel cross-section whose width breathes (10-20m half-width; wide
zones get obstacle slaloms and wider pickup weaves). Kickers are steerable
features with cyan gem arcs floating in their flight paths — jump off the
lip to collect (50 pts + flow surge vs 10 for floor coins). The render layer
draws the course as a ribbon clipped just past the bounce barrier, so the
walls stay low and the world beyond shows: neon edge poles, a city skyline
with beacon-topped towers, hot-air balloons, clouds below.

## Tech stack

- **TypeScript** + **Vite** — build tool and dev server
- **Three.js** — 3D rendering (procedural low-poly art, no binary assets)
- **Vitest** — simulation tests
- **pnpm** via **devenv/direnv** for the development environment

## Architecture

The hard rule: `src/sim/` is pure TypeScript with no Three.js or DOM imports.
It owns all game state and physics (kinematic skier on a heightfield — no
physics engine). The render layer reads sim state each frame and never writes
it.

```
src/
├── main.ts            - Entry point: fixed-timestep loop, HUD, wiring
├── input.ts           - Keyboard → SkierInput
├── sim/               - Pure simulation, fully deterministic
│   ├── rng.ts         - Seeded hash / PRNG
│   ├── terrain.ts     - Track heightfield: centerline, walls, obstacles,
│   │                    pickup lines (all seeded per chunk)
│   ├── skier.ts       - Kinematic skier physics: carving, air, tumbles
│   └── sim.ts         - World state, fixed SIM_DT stepping, flow/score,
│                        SimEvents (nearMiss/landing/tumble) for fx + audio
├── render/            - Three.js only
│   ├── scene.ts       - Lights, sky, fog, shadow-casting sun
│   ├── chunks.ts      - Track ribbon, bollards, arches, obstacles, pickups,
│   │                    skyline/clouds; created and disposed as you ski
│   ├── skierView.ts   - Articulated skier model (posable legs/torso)
│   ├── fx.ts          - Particles (spray/bursts) and the flow trail ribbon
│   └── camera.ts      - Third-person follow camera, speed/flow FOV kick
└── audio/             - Web Audio only, fully synthesized (no audio assets)
    ├── params.ts      - Pure state -> synth parameter curves (unit tested)
    └── engine.ts      - Noise/filter graph: wind, edge scrape, crash
```

Like the render layer, audio reads sim state each frame and never writes it.

Determinism: the world is a pure function of a seed (`?seed=N` URL param), and
the sim only advances in `SIM_DT` steps. Same seed + same inputs = same run.
Tests rely on this — keep `Date.now()`, `Math.random()`, and rendering state
out of `src/sim/`.

Debugging: `window.__game` exposes live sim state plus `poll()` (current
input), `renderFrame(dt)` (force a render while rAF is paused, e.g. hidden
tab), and `step(seconds)` (advance sim + render while paused). After mutating
state for verification, restart with R before handing the game back.

## Running

```bash
direnv allow   # First time only - sets up environment
devenv up      # Starts dev server via process-compose
```

Or manually: `devenv shell -- pnpm install`, then `devenv shell -- pnpm dev`.

## Commands

- `pnpm test` — run simulation tests (Vitest)
- `pnpm typecheck` — tsc, no emit
- `pnpm build` — typecheck + production build to `dist/`

## Controls

Both pointer axes are analog. Stance runs from -1 (tuck: half drag, higher top
speed, 40% less turn authority) through 0 (neutral) to +1 (snowplow: heavy
friction braking).

- Mouse: x position sets a TARGET direction relative to the course (center =
  follow the track, edges = ~66 degrees across it); heading eases toward it
  with no overshoot. Rate-based steering caused pilot-induced weaving.
  y sets stance (top = tuck, bottom = snowplow); hold button for full snowplow
- Touch: first finger works like the mouse position, second finger = full
  snowplow
- WASD: trick keys ONLY (in real air: A/D spin, W frontflip, S backflip —
  push forward to flip forward, pull back to flip back).
  There is no keyboard steering — the mouse is required.
- Boost/jump is ONE button, SSX-style (Space, Shift, or right mouse): holding
  burns the tank (grounded only) and preloads a jump (skier crouches);
  releasing pops — bigger with a longer hold (up to 0.8s).
- Esc or ? pauses (freezes the sim, suspends audio) and shows the key guide
- R starts a fresh run
- M toggles sound (sound starts on the first input, per browser autoplay rules)
