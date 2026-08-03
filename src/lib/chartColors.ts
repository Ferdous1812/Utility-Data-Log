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

// Converts a palette hex color to an rgba() string at the given alpha (0-1).
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Shade for the Nth item (e.g. month) within a group of `total` items, all
// sharing one base color — oldest/first = lightest tint, most recent/last =
// full opacity. Used so each unit's month-over-month bars read as one
// color family instead of unrelated hues.
export function shadeForIndex(hex: string, index: number, total: number): string {
  const alpha = 0.3 + (index / Math.max(1, total - 1)) * 0.7;
  return hexToRgba(hex, alpha);
}
