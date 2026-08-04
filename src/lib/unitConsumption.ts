import type { Unit, UnitAllocation, UnitRemainderRule } from '@/lib/types';

/**
 * Computes a single Major Unit's consumption for one month index, honoring
 * whichever allocation engine that unit is currently configured for:
 *
 *  - Direct Assignment:      sum( meter_value * share% ) across unit_allocations rows
 *  - Calculated Remainder:   ( base_source_value - SUM(deduction_values) ) * share%
 *
 * `meterMonthlyConsumption` maps meter_id -> per-month usage array, indexed
 * the same way as the dashboard's monthsList/comparisonRange.
 */
export function computeUnitConsumption(
  unit: Unit,
  monthIdx: number,
  allocations: UnitAllocation[],
  remainderRules: UnitRemainderRule[],
  meterMonthlyConsumption: Map<string, number[]>
): number {
  if (monthIdx < 0) return 0;

  const valueFor = (meterId: string) => meterMonthlyConsumption.get(meterId)?.[monthIdx] || 0;

  if (unit.allocation_mode === 'calculated_remainder') {
    const rule = remainderRules.find((r) => r.unit_id === unit.id);
    if (!rule) return 0;

    const baseValue = valueFor(rule.base_source_meter_id);
    const deductionsTotal = (rule.deduction_meter_ids || []).reduce(
      (sum, meterId) => sum + valueFor(meterId),
      0
    );
    const remainder = Math.max(0, baseValue - deductionsTotal);
    return remainder * (Number(rule.remainder_share_percent) / 100);
  }

  // Direct Assignment (default)
  const uAllocs = allocations.filter((a) => a.unit_id === unit.id);
  return uAllocs.reduce((sum, a) => sum + valueFor(a.meter_id) * (Number(a.percentage) / 100), 0);
}
