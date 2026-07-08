# Schuss!

A 3D browser-based skiing game in the spirit of PS2-era SSX Tricky: a
procedurally generated walled COURSE — a banked ice channel floating in a
dusk sky above a city — with obstacles, jumps, and pickup lines. There is
ONE course: "The Grand Tour" (COURSE_NAME in terrain.ts), 3.6km to a
checkered finish gate — nine sections, nine DIFFERENT personalities,
every idea the mountain has exactly once, so every segment justifies
itself with something new. (It replaced nine named archetype courses —
nine menu entries reweighting one shared deck, not nine ideas — and then
an 8km double-deck mega course whose second helping of everything was
padding, not variety.) ?seed=N still forces an arbitrary reshuffle of the
deal. Static site, no server.

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
deal CONTRACTS: grabbing one (even on a trickless arc ride) is the feat,
and at TOUCHDOWN the deal is revealed — the ×3/×5 pays on the NEXT trick,
only if it delivers the star's seeded demand (gold names one thing:
spin-left/right, front, back, 720 spin; magenta demands composition: mix,
parallel, double flip — the bigger multiplier priced in difficulty), so
the jackpot is always attached to a real showpiece and a lazy 360 through
a star pays nothing extra (the old always-multiply star made
star + trivial trick outearn every starless masterpiece). Never fuel. The
trick done WHILE grabbing pays base; the armed contract settles on the
next attempt — paid by the matching trick, killed by a mismatch (banner
notes ★ MISSED, trick still pays base) or a blown-trick tumble, kept
through plain landings, bails, and crashes; a newer grab replaces it; a
HUD "×N DEMAND" line glows in the star's color while armed (sim.contract;
demandMet in sim.ts is the judge, demand pools + seeding live in
terrain.ts). Because a contract needs a FOLLOWING trick to cash, the
course's LAST jump carries no star — there is no next lip before the line
locks the score (terrain.hasJumpDownrange gates bonusesForChunk). And a
trick that CASHES a contract is never docked as a repeat: the star DEMANDED
that exact showpiece, so obeying it can't earn the AGAIN? dock (sim.ts —
a paid contract clears the repeat flag; a missed one still docks a genuine
repeat). At every SECTION BOUNDARY (400m) a SECTOR popup grades average pace on a savage curve
(25·(avg−12)^2.2 — a full-boost sector outearns several tricks; SECTOR_LENGTH
= SECTION_LENGTH, so the graded line, the section change, and the glowing arc
all coincide), so fuel
burned into speed converts to points: tricks → fuel → speed → score. The
narrows adds its own score line: SLALOM GATES ride the section's bend
apexes (one per ess extreme, centered on the swinging centerline —
terrain.gatesForChunk), and threading one pays GATE_POINTS × the running
chain (150/300/450..., score only, NEVER fuel; sim.gateChain, each thread
chimes a step higher); a miss — wide, over the poles, or tumbling
through — just resets the chain, the forgone escalation being the whole
punishment. Every
star is COMPUTED onto a reference flight integrated against the real
heightfield (terrain.starOnArc): the gold x3 rides the human-pop-at-cruise
arc, the magenta x5 rides the superhuman-pop-at-boost-pace arc, 30-50m
downrange — so slower or unpopped flights pass meters beneath it, early
hops crest short, and placement survives physics changes because it IS the
physics. Plunge venues gate softly (speed is free downhill there); hips
carry only the x3 for now. Near misses celebrate (whoosh, puff) but pay
nothing. The mouse
is REQUIRED and never changes meaning (x steers / aims the landing, y is
stance, buttons boost); WASD exists only for tricks: in real air (past
MIN_TRICK_AIR — never roller hops) A/D spins, W frontflips, S backflips, and
you can aim with the mouse mid-trick. A flight is a SEQUENCE OF TRICK
SEGMENTS, split at direction reversals (skier.ts banks a segment's whole
turns when an axis reverses; the running NET facing still gates the
landing). So a 360 one way then a 360 the other counts BOTH — the old
signed accumulator cancelled them to nothing — while a lazy 180-each-way
wiggle banks zero (per-segment tolerance: 350°→1, 180°→0). Each segment's
turns pay at its type (500/800/1100). VARIETY — two or more DIFFERENT
tricks in the sequence, where spin-left, spin-right, frontflip, backflip
ALL count as different — is the showpiece: the plain sum ×1.35. A PARALLEL
combo (spin AND flip AT ONCE, locked to the flip's rate and slowed by
PARALLEL_SLOWDOWN so it's harder) is instead sub-additive
(sim.parallelCombine: bigger axis + 0.6·smaller — more than either alone,
less than their sum; a simultaneous combo isn't a sequence, so no variety).
Repeating the EXACT same segment sequence as the previous flight docks the
base points to 70% before any star multiplies them (fuel is never docked;
the banner asks AGAIN?) — UNLESS the repeat is what CASHED an armed star
contract, which demanded that exact trick (no dock, no AGAIN?) — the praise
ladder reserves INCREDIBLE for
variety, COMBO for parallel, OUTSTANDING for big same-type tricks, NICE for
singles. Land within tolerance of the correct facing on every rotated axis
(spin ~52 degrees, flip ~43 — ONE gate for payout and bail alike) or the
rotation doesn't count: past commit that's a tumble — spins commit just
past a half-turn, flips at ~80 degrees (a 90-degree-pitched landing is a
faceplant, not a stumble) — and under commit it's a safe bail that pays
nothing (never a round-up to a paid 360). Nothing is drawn in the AIR — the
skier's own rotation is the only readout, kept clean and legible — and the
landing banner NAMES the tricks it was (SPIN ↺ / BACKFLIP / 2× ..., no
degree counts, a + between segments) with the NICE!/SPUN OUT verdict.
Racing alone never fills the tank —
but past the first sector line it does score. Burning
is hard acceleration with flames, rainbow trail, FOV slam, rumble. The
spectacle scales with play: the course crosses a new color world every
450m — the WHOLE eight-palette library in a seeded order, each world
EXACTLY ONCE per run (the classic dusk / neon night / rose dawn / emerald
plus golden hour / blizzard white / violet storm / ice blue;
palette.courseZones — ZONE_LENGTH is paced so 8 zones = COURSE_LENGTH and
the eighth carries you across the line) and
carries its own WEATHER (courseWeather:
seeded snowfall — clear/flurries/heavy, a deterministic flake box riding
with the skier — and drifting fog banks that swell on a seeded rhythm in
z), under a waving aurora that blazes in the night zone — and FLARES to
full blaze anywhere for a jackpot (sceneSetup.flare: star-multiplied
tricks, jackpot sectors, the finish line; a ~2.5s decay on sim time, so a
pause holds the bloom) — while seeded SHOOTING STARS streak the high sky
on a quiet deterministic schedule (scene.ShootingStars, ~one every ~9s;
both hold their breath in the grotto); a
glowing neon arc spans the track at every SECTION BOUNDARY (400m, where one
section personality gives way to the next); paid sectors
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
and fast, its own snapping slalom — slalom GATES on the apexes, each
flying its own pennant string between the pole tips) / bowl (27m playground: obstacle
slaloms, rich coins, kickers of every size) / plunge (the grade breaks
away mid-section, big L kickers only) / steps (a staircase of launchable
terraces) / sweeper (deliberate sine S-turns with the floor superelevated
into the bend — carving the bank is the racing line; extraDrop 30 pays
the bank-transient drainage bill) / canyon (a 10m-half gorge whose esses
bank at the cap — wall to wall is the only line; sweeper's extraDrop for
the same reason) / glacier (blue ice on the GRIP channel: grip scales
friction AND turn authority in skier.ts — speed nearly free, turns
arrive late; stickiness is drag-only and can't express faster-than-snow)
/ powder (deep drifts, one groomed ribbon: crudThreshold 0 buries all
but the clean golden-path corridor; powder is drag, never a trap).
WHICH sections the course deals is THE TOUR (terrain.ts sectionType /
tourDeal): the mixed middle (sections 1..7) is one seeded shuffle of the
seven types not already pinned to the arc (cruise opens, plunge closes),
so every section of the run is a personality you haven't ridden yet —
nothing repeats, and a shuffle of distinct cards needs no joint patching.
The endless test mountain (courseLength Infinity) continues past the tour
with shuffled FULL nine-type decks (blockDeal, heads patched against the
previous tail) so every type stays reachable at any depth. The
course name is announced over the start gate, on the HUD clock line, and
at the ceremony. The course carries BOTH SETPIECES (terrain.setpieces):
the WATERFALL (10m dive over a 16m face) and the CASCADES (three 5m
falls, 30m rhythm), one seeded into each half of the run (25-40% and
55-70% in, seeded order) — pure added downhill on the spine, so
walls/banking/star arcs/drainage inherit them for free; the falls are the
feature (no kickers or obstacles compete, and the max-gap counter treats
them as featured). The THIRD landmark is the GROTTO (terrain.grotto /
caveAt): 90m of channel under a vaulted ice roof, seeded between the
falls (44-50% in). The heightfield is UNTOUCHED — a cave is atmosphere,
not terrain, so physics and drainage can't tell — but the interior keeps
itself clear: no kickers throw into the dark (the keep-clear reaches
KICKER_THROW uphill of the mouth), no obstacles lurk in it, coins stay.
caveAt(z) (0 outside, easing to 1 through each 14m portal) is the render
layer's dimmer: sky falls to blue-black, fog closes, snowfall and aurora
hold their breath, and the vault (chunks.addGrotto — roof grid, icicles,
glow crystals, cyan runway studs along the floor edges) carries the line
to the far portal; stepping back out is the exhale. Hips and step-down
scoops never roll on banked-ess ground (sweeper/canyon) — a tilted pad
or carved scoop there is two banks fighting.
Sections never repeat back-to-back, blend over their
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
a crawler — documented ⚠️ in PHYSICS.md). THE COURSE has an arc (COURSE_LENGTH = 9 sections, 3.6km): section 0
cruise, the seven-type tour, and a forced plunge FINALE into the gate;
the outrun past the line is clean cruise — no kickers, obstacles, coins,
or crud patches (Terrain takes a courseLength param; tests probe an
endless mountain with Infinity). Crossing the line locks the score
(SimEvent 'finish'; the outrun pays nothing), fires the grandest barrage
plus a victory fanfare, and raises the ceremony panel ~1.8s later: score,
time, BEST (localStorage key skigame-best-<seed>), and one action — S /
Ski again — that restarts from the gate (with one course there is no
picker and no separate retry button; the restart IS the menu).
Moving
hazards are a MENAGERIE, one creature kind per section personality
(terrain.hazardsForChunk deals them; terrain.hazardCircles(h, sim.time)
is the collision truth — time-varying circles, each with a vertical band
[bottom, top] above its own snow, all pure functions of seed and time,
so the choreography you watch IS the choreography that hits, including
what ISN'T there). PATROL DRONES (bowl, glacier) sweep laterally on
seeded sines. The POWDER WYRM (powder) is a segmented serpent swimming
the drifts (wyrmSegment: beads trailing a figure-eight head by WYRM_LAG,
strung out — a short lag read as a pile of shrubs), humps surfacing and
diving on an emergence wave; only emerged arcs collide, so the dive
rhythm IS the dodge, and there is never a moment the whole body blocks.
The AURORA JELLY (cruise, and drifting over the bowl) is a pulsing
additive-light medusa whose tentacles hang to a breathing clearance line
(jellyPose): the contracted bell lifts them to 2.7m — high enough that
the pass-under survives the grade (a skier enters from uphill standing
~half a meter above the bell's snow) — so you dodge around or time a
pass beneath, and a clean pass-under pays the near-miss whoosh. The ICE
TUMBLER (steps) bounces down a fixed TUMBLER_SPAN patrol of the
staircase in parabolic hops (tumblerPose), squashing on impact,
dissolving into the snow at the seam and reforming at the top —
presence < 1 spawns NO circle, so the respawn can never ambush. Shared
rules: at most one creature per chunk and never in adjacent chunks, kind
set by section, never sharing a chunk with a kicker's ramp or the uphill
lip's landing, never on a setpiece or in the grotto, never in the
opening stretch, activity always inside the floor (clean snow to dodge
onto), and no static obstacles in a creature's chunk. A hit is an
ordinary obstacle hit (hitSkier in skier.ts — same brief tumble, same
60% speed kept; the skier's body spans SKIER_HEIGHT for the vertical
check); a close shave past any live circle pays the same near-miss
celebration.
The render layer
draws the course as a ribbon clipped just past the bounce barrier, so the
walls stay low and the world beyond shows: neon edge poles, a city skyline
with beacon-topped towers, hot-air balloons, clouds below. Every section
also DRESSES its own stretch (chunks.addSectionProps — pure decoration
on the banks, edges, and overhead, never on the racing floor, and the
finish apron stays clean): snow-capped pines in the powder, carved
crystal pillars up the canyon walls, tilted ice monoliths on the glacier
(whose floor also tints blue with the GRIP channel), lit terrace brinks
on the steps, gold studs tracing the inside of a sweeper's esses,
amber speed chevrons down the plunge, and the odd floodlight rig over
the bowl. The narrows' dressing is its own flagged gates: the pennants
hang from the gate line itself, never from separate bunting — the thing
with the flags on must BE the thing to thread (a first cut hung them
overhead as scenery, and the bare gates read as bollards).

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
│   ├── palette.ts     - Color zones: palettes cross-fading every 450m of course
│   ├── chunks.ts      - Track ribbon, bollards, section-boundary gates, obstacles,
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
state for verification, leave the game clean (reload, or pause → S to
restart) before handing it back. The
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
  with no overshoot. Rate-based steering caused pilot-induced weaving. The
  "follow the track" reference is LAGGED (skier.ts HEADING_LAG_TAU, an
  exponential decay of ~a couple seconds): "forward" trails the course's bends,
  so a slalom has to be actively steered instead of auto-following — center the
  mouse through a bend and you drift onto the banks. The lag applies on the
  ground AND in the air (one reference, so steering doesn't lurch across the
  ground/air transition); the trade is that the computed stars now have to be
  STEERED into on a curved approach or flight, not hit hands-off. y sets stance
  (top = tuck, bottom = snowplow)
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
  touch-action: none with pan-y), with explicit SKI ON and START OVER
  buttons (the latter restarts from the gate). Panel touches
  stopPropagation — they are UI, never game
  input. Past ~35 degrees off neutral a
  detuned warning dyad rises (engine.setTiltWarning); past ~60 degrees
  sustained 0.4s the game also pauses — putting the phone down IS a pause
  gesture. toScreen's rotation follows screen.orientation.angle as the
  device's CCW rotation from portrait — getting that backwards mirrors
  BOTH axes at once (found on-device). Tilt-only runs still set BEST:
  trusted orientation events >3 degrees off neutral mark the run as
  played (a phone flat on a table streams events but never deviates).
  The tap buttons (Ski on / Start over / Ski again) show on DESKTOP too,
  not just touch — clickable UI
  alongside the keyboard shortcuts; only the touch-specific guide (zone map,
  tilt legend, tilterror) stays .touchonly. feel constants live at the top of
  tilt.ts for on-device tuning.
- WASD: trick keys ONLY (in real air: A/D spin, W frontflip, S backflip —
  push forward to flip forward, pull back to flip back).
  There is no keyboard steering — the mouse is required.
- Boost/jump is ONE button, SSX-style (Space, Shift, or any mouse button): holding
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
  the game starts paused, so the guide doubles as the title screen. Two
  actions off the pause: Esc / SKI ON resumes, and S / START OVER restarts
  the course from the gate (with one course that IS the whole menu — no
  picker, no separate Y/N restart screen, no R key; the ceremony's S / SKI
  AGAIN is the same restart). Every
  route back into a run funnels through dropIntoRun (main.ts), which on touch
  re-verifies live tilt.
- Every fresh run (first drop-in, a restart — NOT a mid-run
  resume) opens with a 3-2-1-GO race countdown: the sim is held at the gate
  and the clock (sim.time) doesn't start until GO, so the timed run begins
  on GO. Purely a main-loop/render concern — the deterministic sim is
  untouched (armed in startCourse, run by the frame loop, tones in engine)
- M toggles sound (sound starts on the first input, per browser autoplay rules)
