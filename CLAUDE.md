# Schuss!

A 3D browser-based skiing game in the spirit of PS2-era SSX Tricky:
procedurally generated walled COURSES — banked ice channels floating in a
dusk sky above a city — with obstacles, jumps, and pickup lines. A course
is 3.2km ending at a checkered finish gate; Space on the ceremony panel
rolls the next course (seed+1, so course numbers are shareable; ?seed=N
picks the start). Static site, no server.

Design rules: punishment is light — obstacle hits cost a brief 0.7s tumble
and a little speed (you keep 60%), a wobble to recover from and never the
run; the walls contain you physically (rideable
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
burned into speed converts to points: tricks → fuel → speed → score. Every
star is COMPUTED onto a reference flight integrated against the real
heightfield (terrain.starOnArc): the gold x3 rides the human-pop-at-cruise
arc, the magenta x5 rides the superhuman-pop-at-boost-pace arc, 30-50m
downrange — so slower or unpopped flights pass meters beneath it, early
hops crest short, and placement survives physics changes because it IS the
physics. Plunge venues gate softly (speed is free downhill there); hips
carry only the x3 for now. Near misses celebrate (whoosh, puff) but pay
nothing. The mouse
is REQUIRED and never changes meaning (x steers / aims the landing, y is
stance, buttons brake/boost); WASD exists only for tricks: in real air (past
MIN_TRICK_AIR — never roller hops) A/D spins, W frontflips, S backflips, and
you can aim with the mouse mid-trick. Land within tolerance of whole
rotations for the payout; spinning WHILE flipping syncs the
spin to the flip's rate so combos land as one package, and a landed
spin+flip mix earns a 1.35x variety bonus, while repeating your own last
trick docks the base points to 70% before any star multiplies them (fuel
is never docked; the banner asks AGAIN?) — the praise ladder reserves
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
for jackpots); an armed star dyes the flow trail (its orbit-sparkle days
are over: orbiting dots are now a brief score AFTERGLOW in the payout's
color, absent when nothing is happening). In the AIR the continuous effects hold their
breath — nothing but the skier's own glow (emissive materials, hot cyan
skis) so the rotation stays readable — and the landing is the exhale: a
glitter release sized by the trick, rainbow-fanned for mixes. Kicker
approaches are lit like runways and every bonus star rides a
light beam up from the snow. The mix celebrates alongside: firework booms
with crackle mirror the fx layer's fuse rhythm, an airy whoosh climbs in
pitch as mid-air rotation accrues, an armed star shimmers (quicker and
higher for x5), multiplied tricks add a glissando run to the fanfare, and
each zone crossing lands a soft two-note swell. (An armed star used to
shimmer continuously — it read as a second, out-of-time music box over
the soundtrack and was cut; the grab fanfare and HUD/trail carry that
state.) Reward loop over penalty
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
its floor a little — and the physics honors it: gravity's cross-heading
component rotates a grounded skier's velocity (capped at 1 rad/s), so a
superelevated sweeper carries a hands-off rider around its S-turns at full
pace and a wall ride carves back down to the floor. Kickers come in S/M/L (ramp 10/14/19m, lip
1.5/2.2/3.2m), 30% of M/L are step-downs (the landing scooped out for
float and a soft catch), the first kicker of a run is always a flat M, and
the trick-bonus stars sit per-size on the popped-at-the-lip flight arc
(STAR_TABLE, tuned by simulated flights). HIP kickers ride the banking
physics for real: the pad tilts to 0.38 cross-slope over a 20m run-up,
its core (and lit runway) bends along the rider's measured ~7.5m drift
line, neutral steering follows the pad's line (hipAim bends the course
target the same way sweepers rotate trackHeading), and the launch leaves
the lip slung across the track — the x3 hangs on the slung line (ride it
at pace to collect); the hip x5 is WITHHELD until the popped-off-the-curve
flight is measured well enough to place it honestly. Hips spawn where
stepDowns don't (never both), throw toward the center, need a 13m+
channel, and never roll in plunges (mid-plunge grade swings bend flights
off any fixed sling line). Sweepers keep their first 5m of bank crud-free
(bermRoom): with gravity carrying riders along banks, the berm is a
line you choose. THE DRAINAGE GUARANTEE (drainage.test.ts): everywhere a
skier can stand, the fall line beats snow friction, so no stopped skier
stays stopped — rollers, moguls, bank flips (curvature on a ±20m
stencil, 12m BANK_ARM), carved step-down landings (CARVE_SLOPE), and
hip tilt releases all fit inside the grade's slope budget; only kicker
ramp faces are exempt (a lip that launches is necessarily near-flat to
a crawler — documented ⚠️ in PHYSICS.md). COURSES have an arc (COURSE_LENGTH = 8 sections): section 0 cruise, a
mixed middle, and a forced plunge FINALE into the gate; the outrun past
the line is clean cruise — no kickers, obstacles, coins, or crud patches
(Terrain takes a courseLength param; tests probe an endless mountain with
Infinity). Crossing the line locks the score (SimEvent 'finish'; the
outrun pays nothing), fires the grandest barrage + a victory fanfare, and
raises the ceremony panel ~1.8s later: score, time, per-course BEST
(localStorage key skigame-best-<seed>), Space = next course, R = retry.
The
section framework is where moving hazards will plug in.
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
idle self-play and synthetic debug events can never set it. `?debug` adds an
on-device input readout (timer-driven, so it survives a wedged rAF loop):
the orient/touch Δ columns are heartbeats — a Δ stuck at 0 while you tilt or
tap is the moment those events stop reaching the page (sensor vs touch vs
both), for chasing the mobile "controls go dead" bug.

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
- Touch: there is NO finger-steering scheme. The TILT is the only touch
  control; if motion access can't be granted the drop-in shows an error
  (#tilterror) and stays paused rather than dropping into an unsteerable
  run — a phone that can't tilt can't play.
- Mobile (landscape phone): the TILT is the mouse (src/tilt.ts, pure and
  unit-tested — everything works off the gravity direction in screen
  coordinates, alpha-free, so compass drift and chair-turning can't
  steer). Roll (steering-wheel twist) = steer, pitch = stance with
  top-edge-away = tuck; UNPAUSING calibrates the current grip as neutral
  (re-unpause to recalibrate; if permission resolves before the first
  orientation event, calibration completes on that event). The
  deviceorientation listener binds at GRANT time, not page load (iOS is
  flaky binding it at load — the silent dead-tilt run), and the drop-in
  WAITS for a real reading (input.waitForTilt) before entering the run: if
  the sensor never streams it stays on the guide with the error rather than
  stranding you in an unsteerable, unpausable run. The drop-in tap
  on the title panel requests iOS motion permission (must be in-gesture)
  and is UI, not game input (stopPropagation — otherwise tilt mode grabs
  it as a thumb touch; GameAudio.unlock() is public and called explicitly
  because that tap no longer reaches the window unlock listener; the tap
  also tries fullscreen — best-effort, iPhone Safari refuses). Thumbs are
  the buttons: the LEFT 38% of the screen is the trick pad (drag ~24px
  from touch-down and hold = W/S/A/D, up = frontflip; an EIGHT-way pad, so
  the four diagonals arm a spin+flip combo the way two held keys do on
  desktop — cardinal/diagonal split at 22.5 degrees, tilt.ts trickFromDrag),
  the RIGHT 38% is boost/charge (hold/release = Space), and the MIDDLE
  band is the pause button (tilt.ts THUMB_ZONE). There are no on-screen
  chips: the touch PAUSE SCREEN is the guide — a tricolor zone map
  (tricks/pause/boost in true proportion) plus a legend of the HUD,
  scrolling like a normal widget (the panel overrides the global
  touch-action: none with pan-y), with explicit DROP IN and RESTART
  buttons (restart routes through the Y/N confirm, which has its own tap
  buttons). Panel touches stopPropagation — they are UI, never game
  input. Past ~35 degrees off neutral a
  detuned warning dyad rises (engine.setTiltWarning); past ~60 degrees
  sustained 0.4s the game also pauses — putting the phone down IS a pause
  gesture. toScreen's rotation follows screen.orientation.angle as the
  device's CCW rotation from portrait — getting that backwards mirrors
  BOTH axes at once (found on-device). Tilt-only runs still set BEST:
  trusted orientation events >3 degrees off neutral mark the run as
  played (a phone flat on a table streams events but never deviates).
  Panels grow tap buttons on touch devices (body.touch + .touchonly);
  feel constants live at the top of tilt.ts for on-device tuning.
- WASD: trick keys ONLY (in real air: A/D spin, W frontflip, S backflip —
  push forward to flip forward, pull back to flip back).
  There is no keyboard steering — the mouse is required.
- Boost/jump is ONE button, SSX-style (Space, Shift, or right mouse): holding
  burns the tank (grounded only) and banks jump charge (skier crouches; the
  charge bar beside the tank appears while banked). The SIM owns the charge
  (sim-time, deterministic): a 6s bar with the strongest HUMAN jump (3.8
  m/s) at the halfway marker (~3s, always available) and the superhuman
  half (to 5.4 m/s) only filling while fuel burns. Energy is linear in hold
  time — vy = 5.4·sqrt(charge) — one law, no kink. Releasing pops as an
  IMPULSE on the glued velocity; a tap does nothing at all.
- Contact is a position tolerance, not a force: the body is ballistic
  (never pulled down harder than g) and the legs bridge up to 0.35m of
  daylight (skier.ts LEG_REACH virtual gap). Consequences by design: taps
  and mogul flutter are absorbed, rollers are rhythm not flight, and real
  air comes only from built edges (kicker lips, terraces, step-downs) and
  the charged pop.
- Esc or ? pauses (freezes the sim, suspends audio) and shows the key guide;
  the game starts paused, so the guide doubles as the title screen
- R pauses onto a Y/N confirm (Y restarts, N or Esc resumes) — a stray
  keypress never throws away a run
- M toggles sound (sound starts on the first input, per browser autoplay rules)
