---
name: verify
description: Build Schuss! and drive it headless to observe a change working in the real game.
---

# Verifying Schuss! changes

Build and serve the real app, then drive it with Playwright against the
pre-installed Chromium and observe via screenshots plus `window.__game`.

```bash
pnpm install && pnpm build
npx vite preview --port 4173 --strictPort &   # serves dist/
```

Driver (playwright-core, installed in a scratch dir — never in this repo):

```js
import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium', // symlink to the real binary
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'], // WebGL headless
});
```

Flows worth driving:

- Load → paused title guide (`#pause.visible`). Esc unpauses → 3-2-1-GO
  countdown, `#coursecall` announces the course name.
- `window.__game.sim.terrain` — inspect `sectionType(s)`, `setpieces`,
  `courseLength` for generation claims.
- Teleport to the line to reach the ceremony fast (expect an absurd score:
  sector pace grades the teleported distance — artifact, not a bug):
  set `skier.z/x/y/speed/heading/headingRef` from terrain, then resume.
- S on the pause guide / ceremony restarts from the gate.

Gotchas: keyboard events only reach menu keys while paused/finished (S is
a backflip in a live run); the sim only rolls after GO (~3.2s); leave the
game clean after mutating state (reload or restart).
