import type { Unit, UnitAllocation, UnitRemainderRule } from '@/lib/types';

/**
 * Computes a single Major Unit's consumption for one month index by
 * combining BOTH allocation engines at once — a unit is no longer locked
 * into a single mode:
 *
 *  - Direct Assignment:      SUM( meter_value * share% ) across every
 *                             unit_allocations row for this unit
 *  - Calculated Remainder:   SUM over every unit_remainder_rules row for
 *                             this unit of
 *                             ( base_source_value - SUM(deduction_values) ) * share%
 *
 * This lets a Unit like "Warehouse Unit" mix directly-metered members
 * (added via Direct Assignment) with unmetered members that share a feed
 * and are split out via one or more Calculated Remainder rules.
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

  // Direct Assignment contribution
  const uAllocs = allocations.filter((a) => a.unit_id === unit.id);
  const directTotal = uAllocs.reduce(
    (sum, a) => sum + valueFor(a.meter_id) * (Number(a.percentage) / 100),
    0
  );

  // Calculated Remainder contribution — every rule attached to this unit
  const uRules = remainderRules.filter((r) => r.unit_id === unit.id);
  const remainderTotal = uRules.reduce((sum, rule) => {
    const baseValue = valueFor(rule.base_source_meter_id);
    const deductionsTotal = (rule.deduction_meter_ids || []).reduce(
      (dSum, meterId) => dSum + valueFor(meterId),
      0
    );
    const remainder = Math.max(0, baseValue - deductionsTotal);
    return sum + remainder * (Number(rule.remainder_share_percent) / 100);
  }, 0);

  return directTotal + remainderTotal;
}
