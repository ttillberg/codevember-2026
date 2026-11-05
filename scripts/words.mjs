// Prompt list by @thespite: https://x.com/thespite/status/2116974998212772095
export const WORDS = [
  'Fold', 'Shatter', 'Melt', 'Tangle', 'Moss', 'Orrery', 'Hollow', 'Tesseract',
  'Membrane', 'Caustic', 'Rust', 'Feather', 'Labyrinth', 'Tension', 'Mirage',
  'Spore', 'Kelp', 'Pendulum', 'Erosion', 'Cocoon', 'Bolt', 'Echo', 'Magma',
  'Nest', 'Veil', 'Anamorph', 'Burrow', 'Hive', 'Portal', 'Dissolve',
];

export const YEAR = 2026;
export const MONTH = 11;

export function wordFor(day) {
  return WORDS[day - 1];
}

export function dateFor(day) {
  return `${YEAR}-${String(MONTH).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
