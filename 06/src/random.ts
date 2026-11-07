// Small seeded random (Park–Miller), so every load scatters things the same way.
export function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}
