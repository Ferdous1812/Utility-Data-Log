// Shared categorical color palette used across dashboard charts to keep the
// page consistent between sections. Tuned for legibility (as fills, lines,
// and inline text color) against the light Industrial Enterprise background.

export const CHART_PALETTE = [
  '#1D4ED8', // engineering blue (accent)
  '#16A34A', // success green
  '#B45309', // amber
  '#7C3AED', // violet
  '#DB2777', // pink
  '#059669', // emerald
  '#C2410C', // orange
  '#0369A1', // sky blue
  '#A16207', // gold
  '#DC2626', // danger red
  '#0E7490', // teal
  '#9333EA', // purple
];

export function colorAt(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length];
}
