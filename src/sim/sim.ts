import { Terrain } from './terrain';
import { SkierInput, SkierState, createSkier, stepSkier } from './skier';

// Fixed timestep: the simulation only ever advances in SIM_DT increments, so a
// given seed plus a given input sequence always produces the same run.
export const SIM_DT = 1 / 120;

export interface Sim {
  terrain: Terrain;
  skier: SkierState;
  time: number;
}

export function createSim(seed: number): Sim {
  return { terrain: new Terrain(seed), skier: createSkier(), time: 0 };
}

export function stepSim(sim: Sim, input: SkierInput): void {
  stepSkier(sim.skier, sim.terrain, input, SIM_DT);
  sim.time += SIM_DT;
}

export function distanceSkied(sim: Sim): number {
  return Math.max(0, -sim.skier.z);
}
