import type { Meter } from '@/lib/types';

/** Derives a terse, formula-friendly token from a meter name, e.g. "Main Incoming 01" -> "MAIN_INCOMING_01" */
export function meterCode(meter: Meter | undefined | null): string {
  if (!meter) return 'UNKNOWN';
  return meter.name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Builds the human-readable "Formula: ( MAIN_01 - SUM(M_01, M_02) ) * 75%" preview string. */
export function buildRemainderFormula(
  baseMeter: Meter | undefined | null,
  deductionMeters: Meter[],
  remainderSharePercent: number
): string {
  const baseToken = baseMeter ? meterCode(baseMeter) : 'BASE_SOURCE';
  const share = Number.isFinite(remainderSharePercent) ? remainderSharePercent : 0;

  if (deductionMeters.length === 0) {
    return `Formula: ${baseToken} * ${share}%`;
  }

  const sumToken = `SUM(${deductionMeters.map((m) => meterCode(m)).join(', ')})`;
  return `Formula: ( ${baseToken} - ${sumToken} ) * ${share}%`;
}
