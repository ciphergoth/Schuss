# Ski game

A 3D browser-based skiing game in the spirit of PS2-era SSX Tricky: an
endless procedurally generated walled track — a banked ice channel floating
in a dusk sky above a city — with obstacles, jumps, and pickup lines. Static
site, no server.

Design rules: punishment is light — obstacle hits cost a 1.3s tumble and most
of your speed, never the run; the walls contain you physically (rideable
banks that steepen), no fences or fail states. The economy is two ledgers
doing one loop. The BOOST TANK (tall vertical bar, left edge; big and slow
on both ends) is the mechanical loop: it fills only from deliberate rewards
— coins (off-plan detours) and above all TRICKS (flat, capped fuel: spin
0.15 < frontflip 0.20 < backflip 0.26 per rotation, matching their rotation
speeds) — and burning it is the speed. The SCORE (top right, big digits,
uncapped; localStorage BEST beneath) is the ledger of glory: tricks pay
points (500 spin / 800 frontflip / 1100 backflip per rotation), BONUS STARS
multiply the next trick's POINTS (never fuel; armed until a trick attempt
settles — spent by the landed trick it multiplied or by a blown-trick
tumble, kept through plain landings and crashes; a HUD ×N glows in the
star's color while armed), and every 250m a SECTOR popup grades average pace on a savage curve
(25·(avg−12)^2.2 — a full-boost sector outearns several tricks), so fuel
burned into speed converts to points: tricks → fuel → speed → score. Both
stars sit ON the arc of a jump popped at the kicker's lip, which flies
nearly flat past it — gold x3 at 13m out, magenta x5 at 24m (needs the lip
pop AND 21+ m/s to still be flying there); a hop before the ramp crests
early and is meters below them, so the reward is timing, never jumping
early. Near misses celebrate (whoosh, puff) but pay nothing. The mouse
is REQUIRED and never changes meaning (x steers / aims the landing, y is
stance, buttons brake/boost); WASD exists only for tricks: in real air (past
MIN_TRICK_AIR — never roller hops) A/D spins, W frontflips, S backflips, and
you can aim with the mouse mid-trick. Land within tolerance of whole
rotations for the payout; spinning WHILE flipping syncs the
spin to the flip's rate so combos land as one package, and a landed
spin+flip mix earns a 1.35x variety bonus — the praise ladder reserves
INCREDIBLE for mixes, OUTSTANDING for big same-type tricks, NICE for
singles. Land within tolerance of the correct facing on every rotated axis
(spin ~52 degrees, flip ~43 — ONE gate for payout and bail alike) or the
rotation doesn't count: past commit that's a tumble — spins commit just
past a half-turn, flips at ~80 degrees (a 90-degree-pitched landing is a
faceplant, not a stumble) — and under commit it's a safe bail that pays
nothing (never a round-up to a paid 360). A live degree readout (green ✓ when lined up) plus
NICE!/SPUN OUT banners make it legible. Racing alone never fills the tank —
but past the first sector line it does score. Burning
is hard acceleration with flames, rainbow trail, FOV slam, rumble. The
spectacle scales with play: the course crosses a new color world every
600m (dusk → neon night → rose dawn → emerald; palette.ts cross-fades
sky/fog/lights) under a waving aurora that blazes in the night zone; a
glowing neon arc spans the track at every 250m sector line; paid sectors
and star-multiplied tricks launch firework volleys over the course (grander
for jackpots); an armed star orbits the skier as sparkles in its own color
and dyes the flow trail; mid-air rotation streams a hue-cycling glitter
comet; kicker approaches are lit like runways and every bonus star rides a
light beam up from the snow. The mix celebrates alongside: firework booms
with crackle mirror the fx layer's fuse rhythm, an airy whoosh climbs in
pitch as mid-air rotation accrues, an armed star shimmers (quicker and
higher for x5), multiplied tricks add a glissando run to the fanfare, and
each zone crossing lands a soft two-note swell. Reward loop over penalty
loop.

Terrain is a pure height function with SECTION personalities: every 400m
the course becomes one of cruise / narrows (7m half-width squeeze, empty
and fast) / bowl (27m playground: obstacle slaloms, rich coins, kickers of
every size) / plunge (the grade breaks away mid-section, big L kickers
only) / steps (a staircase of launchable terraces) / sweeper (deliberate
sine S-turns with the floor superelevated into the bend — carving the bank
is the racing line). Sections never repeat back-to-back, blend over their
last 60m, and section 0 is always cruise (gentle openings, predictable
physics tests). Banking is curvature-driven everywhere, so any bend tilts
its floor a little. Kickers come in S/M/L (ramp 10/14/19m, lip
1.5/2.2/3.2m), 30% of M/L are step-downs (the landing scooped out for
float and a soft catch), the first kicker of a run is always a flat M, and
the trick-bonus stars sit per-size on the popped-at-the-lip flight arc
(STAR_TABLE, tuned by simulated flights). Hip kickers wait on a physics
addition — a heightfield yaw alone can't redirect a kinematic skier. The
section framework is where moving hazards and finish lines will plug in.
The render layer
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
│   ├── scene.ts       - Lights, dynamic sky/fog, aurora, shadow-casting sun
│   ├── palette.ts     - Color zones: palettes cross-fading every 600m of course
│   ├── chunks.ts      - Track ribbon, bollards, arches, sector gates, obstacles,
│   │                    pickups, star beams, skyline/clouds; created and
│   │                    disposed as you ski
│   ├── skierView.ts   - Articulated skier model (posable legs/torso)
│   ├── fx.ts          - Particles (spray/sparks/fireworks), auras, flow trail
│   └── camera.ts      - Third-person follow camera, speed/flow FOV kick
└── audio/             - Web Audio only, fully synthesized (no audio assets)
    ├── params.ts      - Pure state -> synth parameter curves (unit tested)
    └── engine.ts      - Noise/filter graph: wind, edge scrape, crash,
                         rotation whoosh, firework booms, armed-star
                         shimmer, zone-crossing swells
```

Like the render layer, audio reads sim state each frame and never writes it.

Determinism: the world is a pure function of a seed (`?seed=N` URL param), and
the sim only advances in `SIM_DT` steps. Same seed + same inputs = same run.
Tests rely on this — keep `Date.now()`, `Math.random()`, and rendering state
out of `src/sim/`.

Debugging: `window.__game` exposes live sim state plus `poll()` (current
input), `renderFrame(dt)` (force a render while rAF is paused, e.g. hidden
tab), and `step(seconds)` (advance sim + render while paused). After mutating
state for verification, restart with R before handing the game back. The
localStorage BEST only persists for runs with real (isTrusted) user input —
idle self-play and synthetic debug events can never set it.

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
  burns the tank (grounded only) and preloads a jump (skier crouches; a gold
  charge bar beside the tank appears while held); releasing pops. Jump ENERGY
  is linear in hold time — vy goes with sqrt(charge) — and a full charge
  takes 3s, so a tap does nearly nothing.
- Esc or ? pauses (freezes the sim, suspends audio) and shows the key guide;
  the game starts paused, so the guide doubles as the title screen
- R starts a fresh run
- M toggles sound (sound starts on the first input, per browser autoplay rules)
