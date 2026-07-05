# Schuss! physics scorecard

A living ledger of the simulation's physical laws: what force acts, where it
lives, and how honest it is. Update this file whenever the physics changes.
The standing bar, set on 2026-07-04: **no force ever pulls the skier down
harder than gravity, and every impulse is added to the velocity the skier
actually has** — the two lies (super-g terrain glue, pops that reset vy)
whose removal reshaped everything below.

Status legend: ✅ honest & spec-tested · 📐 tuned by measurement (probes/
simulated flights) · ⚠️ open item.

## Contact and gravity — `src/sim/skier.ts`

| Law                    | How it works                                                                                                                                                                                                                | Status                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Gravity                | `G = 9.81` on the ballistic body, always and only                                                                                                                                                                           | ✅                                                                  |
| Leg-reach contact      | The body is ballistic; a virtual gap integrates true separation from the snow, and the legs bridge up to `LEG_REACH = 0.35m` before air is real. Concave ground re-closes the gap (suspension absorbing, no landing event). | ✅ `a tap barely parts the skis…`, `a jump lands and stays landed…` |
| Consequences by design | Taps and mogul flutter are absorbed; **rollers are rhythm, not flight**; air comes only from built edges (lips, terraces, step-downs) and the charged pop.                                                                  | ✅ blessed 2026-07-04                                               |
| Separation cap         | Leaving the ground repartitions velocity, never adds it: upward vy at separation ≤ `speed × 0.35` (`LAUNCH_MAX_VY_RATIO`), total magnitude conserved. Kills wall-ride moon-shots.                                           | ✅ `wall rides cannot moon-shot`                                    |
| Landing                | Inelastic projection onto the slope: the into-surface component is absorbed, the along-surface component survives (fall converts to speed on descending faces). Impulsive, not sustained.                                   | ✅ `landing on a descending slope converts fall into speed`         |
| Known >g exceptions    | The tumble slide follows terrain unconditionally (you're down; comedy physics), and the landing projection is an impulse.                                                                                                   | accepted                                                            |

## The jump charge — `src/sim/sim.ts` + `src/sim/skier.ts`

| Law                    | How it works                                                                                                                                                                             | Status                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Ownership              | The SIM owns the meter (`sim.charge`), advanced per `SIM_DT` — deterministic; the input layer only reports held/released.                                                                | ✅                                                                             |
| One energy law         | Energy linear in hold time: `vy = 5.4 · √charge` (`JUMP_POP_MAX`), no kink anywhere on the curve.                                                                                        | ✅                                                                             |
| The human marker       | 6-second bar (`CHARGE_FULL_S`); the strongest human jump (3.8 m/s ≈ 74cm) sits at the halfway marker (~3s) and is always available.                                                      | ✅                                                                             |
| Superhuman is paid for | The half beyond the marker (to 5.4 m/s ≈ 1.5m) only fills while boost burns — the held button's tank drain (`BOOST_DRAIN = 0.15/s`) is the price. Empty tank pins the bar at the marker. | ✅ verified live: 4s dry hold pins at 0.50; the superhuman half cost 0.56 tank |
| The pop                | An impulse on the glued velocity (`vy += pop`), never a reset. A tap banks ~nothing and the leg band absorbs it: zero air.                                                               | ✅ `a released jump charge is an impulse on the glued velocity`                |
| Fumbles                | A crash zeroes the charge; releasing mid-air fizzles it.                                                                                                                                 | ✅                                                                             |

## Steering and the banked turn — `src/sim/skier.ts`

| Law                      | How it works                                                                                                                                                                                                                                                          | Status                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Position-target steering | The pointer sets a target heading relative to the course (`MAX_STEER_OFFSET = 1.15 rad`); heading eases toward it (gain 4/s, rate ≤ `2.6 × min(speed/4, 1)` rad/s). No rate control — that weaved.                                                                    | ✅                                                                                        |
| Cross-slope gravity turn | Gravity's component perpendicular to the skis rotates the velocity: `dHeading/dt = a⊥ / speed`, capped at 1 rad/s. Banked sweepers carry a hands-off rider at full pace (23→23.5 m/s where the old glue scrubbed to 15); wall rides carve back to the floor in ~1.5s. | ✅ `a banked sweeper carries a hands-off rider…`, `gravity carves a wall-parallel rider…` |
| Course-line bending      | Hip pads bend the steering target itself (`terrain.hipAim`), the same mechanism by which neutral steering follows a sweeper's rotating trackHeading; the banked surface supplies the matching physical force.                                                         | ✅                                                                                        |
| Air steering             | Same controller at `0.5×` authority; the mouse aims the landing and never changes meaning.                                                                                                                                                                            | ✅                                                                                        |
| Low-speed fall line      | Below 1 m/s the skier pivots toward the fall line (1.6 rad/s) so no state is a dead end.                                                                                                                                                                              | ✅                                                                                        |

## Speed forces — `src/sim/skier.ts`

| Force         | Value                                                                                                   | Status |
| ------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| Slope pull    | `−G·(∇h · dir)` along the heading                                                                       | ✅     |
| Snow friction | μ 0.05 neutral → 0.6 full snowplow; can stop you, never reverses you                                    | ✅     |
| Crud          | Viscous, not Coulomb: `0.33·v + 0.012·v²` at full stickiness (zero force at rest — gravity always wins) | ✅     |
| Air drag      | `0.0035·v²`; full tuck halves it (top speed ~29 → ~41 m/s)                                              | ✅     |
| Boost thrust  | +5.5 m/s² while burning, grounded only                                                                  | ✅     |
| Wall carom    | Invisible barrier past the rideable bank: reflect heading, ×0.7 speed, vy clamped ≤ 0                   | ✅     |

## Tricks and crashes — `src/sim/skier.ts`

| Law              | How it works                                                                                                                                                                                                                                              | Status |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Real air only    | Trick keys engage past `MIN_TRICK_AIR = 0.35s` — with leg-reach contact that now means genuinely launched, never a roller blip.                                                                                                                           | ✅     |
| Rotation rates   | Spin 6 rad/s > frontflip 5 > backflip 4.2 — pay scales inversely with rate. Spinning while flipping syncs the spin to the flip's rate so combos land as one package.                                                                                      | ✅     |
| One landing gate | Within tolerance of clean facing on every rotated axis — spin 0.9 rad (~52°), flip 0.75 rad (~43°) — for payout and bail alike. Past commit (spins ~206°, flips ~80°) and outside tolerance: tumble. Under commit: safe bail, zero pay, never a round-up. | ✅     |
| Tumbles          | 1.3s of no control, keep 25% of speed, heavy friction; obstacle hits carom you past the obstacle. Punishment is light by design — never the run.                                                                                                          | ✅     |

## Terrain features that ARE physics — `src/sim/terrain.ts`

| Feature            | How it works                                                                                                                                                                                                                                         | Status |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Banking everywhere | Floor cross-slope = `−9 × centerline curvature`, capped at 0.26 — any bend tilts its floor, and the gravity turn honors it. Sweepers add deliberate sine S-turns (amp 30, λ 200m).                                                                   | ✅     |
| Kickers            | S/M/L (ramp 10/14/19m, lip 1.5/2.2/3.2m); 30% of M/L are step-downs with a scooped landing (float + soft catch). First kicker of every run: flat M.                                                                                                  | ✅     |
| Hip pads           | Approach tilts to 0.38 cross-slope over a 20m run-up; the core, lip, and lit runway bend along the rider's measured ~7.5m drift line; the launch leaves the lip slung across the track. Never in plunges; throw toward center; needs a 13m+ channel. | 📐     |
| Sweeper berms      | First 5m of bank is clean racing snow (`bermRoom`) — with gravity carrying riders along banks, the berm is a line you choose.                                                                                                                        | ✅     |

## Bonus stars: placement IS the physics — `src/sim/terrain.ts`

| Law                     | How it works                                                                                                                                                                                                                                                                                                               | Status                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Computed, not tabulated | `starOnArc` integrates the reference flight against the real heightfield, under the sim's own guidance laws (air steering + hipAim), with the sim's pop model, moon-shot cap, and a measured leg-band launch delay (0.12s). Placement survives grade changes, section transitions, and future physics — it is the physics. | ✅                             |
| The ×3 arc              | Human pop (charge 0.5) at cruise (20 m/s), 1.5s downrange. Any honest pop collects; committed pace can too.                                                                                                                                                                                                                | 📐 spec-tested per kicker kind |
| The ×5 arc              | Superhuman pop (charge 1) at boost pace (25 m/s), 1.9s downrange (~40m+). Slower or unpopped flights pass meters beneath it; early hops crest short. Plunges gate softly — speed is free downhill there.                                                                                                                   | 📐 spec-tested per kicker kind |
| Hip ×5                  | **Withheld.** Where a popped flight leaves the curved hip core under leg-reach contact resisted four measurement attempts; rather than hang a star no flight can reach, hips pay only their ×3 (on the slung line, collected by riding it at pace) until the popped-off-the-curve flight is measured honestly.             | ⚠️ the open item               |

## Case history: would this file have saved us?

The scorecard exists because of a specific arc of bugs. Honest accounting of
which ones a written physics ledger would have caught — and which ones
nothing but measurement would have found.

### Where it would have saved us

- **The tap that flew (the founding bug).** `vy = max(vy, 0) + pop` — the
  pop silently discarded the −7 m/s terrain-following descent, a hidden
  upward impulse nearly twice the full charge, free with any tap. It
  survived _two_ rounds of charge-curve tuning because we tuned constants
  instead of auditing laws. A scorecard row reading "the pop is an impulse
  on the velocity the skier actually has" would have been falsified by one
  read of the line. (Paul's question — "is it possible you've glued him
  there?" — is exactly the audit this file formalizes.)
- **The wall-ride moon-shot.** Riding up a bank, the kinematic glue minted
  vy the skier's kinetic energy could never pay for; leaving the wall
  inherited it raw — 100m launches. "No transition ever adds energy" as a
  standing bar makes this a one-question review, and that bar is now at the
  top of this file.
- **The perpetual landing bounce.** Landing zeroed vy; the next step saw the
  ground descending and relaunched, forever. There was no stated landing
  law at all — being forced to write one ("inelastic projection onto the
  slope") _is_ the fix. Empty cells in this table are where those bugs live.
- **The super-g glue, eventually.** `LAUNCH_EXTRA_ACCEL = 6` was a declared,
  deliberate cheat that worked fine for a long time — until it compounded
  with the pop semantics and made roller air fake. A ⚠️ row wouldn't have
  _prevented_ it, but the day the jumps felt wrong, the suspect list would
  have had one name on it instead of requiring code archaeology.

### Where it wouldn't have

- **The pre-ramp hop exploit.** Jumping early converted the track's grade
  into altitude and beat timing the lip. Every law involved was honest; the
  exploit was emergent geometry, found only by simulating flights. No
  ledger of principles catches this — probes do.
- **The steering controller eating the hip throw.** The gravity turn pushed
  0.2 rad/s; the position-target controller treated it as an error and
  steered it out to a 0.05 rad equilibrium. Two individually-honest systems,
  one systemic failure. The fix (hipAim bends the course line itself) came
  from measuring the equilibrium, not from auditing either system.
- **Star tables dying with every physics change.** Three full re-probes in
  one day — not a lie anywhere, just hand-tuned constants downstream of
  laws that kept improving. The cure was architectural (stars computed on
  reference flights), and the general lesson is baked into the status
  column: 📐 rows are the ones that break when ✅ rows change; minimize 📐.
- **Measurement bugs measuring the physics.** Test labs that teleported with
  `vy = 0` onto a slope created step-function launches; probe triggers
  fired while the rider was already airborne and measured unpopped flights
  labeled as popped. The scorecard can't audit the instruments. Slope-
  matched setup and first-flight-only sampling are probe discipline, not
  physics.

**The moral:** this file catches _broken laws_ — hidden resets, minted
energy, undeclared super-g forces. It does not catch _emergent interactions_
or _tuning couplings_; those fall to the probe methodology below. The repo
needs both.

## House rules

- `src/sim/` is pure TypeScript: no Three.js, no DOM, no wall clock. Same
  seed + same inputs = same run, always.
- Constants that mirror the sim (`POP_MAX`, `POP_CAP_RATIO` in terrain.ts)
  say so in comments; if you change one side, change the other.
- Physics changes re-tune nothing by hand anymore: stars re-place
  themselves, and the probe methodology (temporary `debug.test.ts` flights,
  measured, then deleted) is how new constants get their values.
