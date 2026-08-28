# Binary texture assets

The first committed binary assets (the old "no binary assets" rule is
repealed — see CLAUDE.md). All files here are **CC0 1.0** (public domain),
sourced from the [@pmndrs/assets](https://github.com/pmndrs/assets) surface
normal collection (drei-assets), and loaded at runtime by the render layer
only — nothing in `src/sim/` knows they exist.

- `snow-normal.webp` — fine wind-crusted grain; the track ribbon's normal
  map (replaces the generated bump map once loaded), tiled in world-space
  meters like every ribbon texture.
- `ice-normal.webp` — cracked crust plates; shared by the crystal pillars,
  glacier monoliths, and the grotto vault.
