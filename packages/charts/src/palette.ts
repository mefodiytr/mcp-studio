/** A small default palette used when a series / item doesn't carry an explicit
 *  `color`. Picked for legibility against both light and dark themes. */
export const DEFAULT_PALETTE: readonly string[] = [
  '#2563eb', // blue-600
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#84cc16', // lime-500
  '#ec4899', // pink-500
];

export function paletteColor(index: number): string {
  return DEFAULT_PALETTE[index % DEFAULT_PALETTE.length]!;
}
