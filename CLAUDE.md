# Ski game

A 3D browser-based skiing game: endless procedurally generated slope, steer
around trees, distance is the score. Static site, no server.

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
│   ├── terrain.ts     - Heightfield + per-chunk tree placement
│   ├── skier.ts       - Kinematic skier physics, tree collision
│   └── sim.ts         - World state, fixed SIM_DT stepping
└── render/            - Three.js only
    ├── scene.ts       - Lights, sky, fog
    ├── chunks.ts      - Ground/tree meshes, created and disposed as you ski
    ├── skierView.ts   - Skier model
    └── camera.ts      - Third-person follow camera
```

Determinism: the world is a pure function of a seed (`?seed=N` URL param), and
the sim only advances in `SIM_DT` steps. Same seed + same inputs = same run.
Tests rely on this — keep `Date.now()`, `Math.random()`, and rendering state
out of `src/sim/`.

Debugging: `window.__game.sim` exposes live sim state in the browser console.

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

- Arrow keys or A/D to steer
- Space, S, or down arrow to brake
- R to restart after a wipeout
