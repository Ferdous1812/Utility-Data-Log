// Shared vivid color palette used across dashboard charts to keep the
// page colorful while staying consistent between sections.

export const CHART_PALETTE = [
  '#00D4FF', // accent cyan
  '#00E676', // success green
  '#FFB300', // warning amber
  '#A78BFA', // violet
  '#F472B6', // pink
  '#34D399', // emerald
  '#FB923C', // orange
  '#60A5FA', // blue
  '#FBBF24', // gold
  '#FF5252', // danger red
  '#22D3EE', // teal
  '#C084FC', // purple
];

export function colorAt(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length];
}
