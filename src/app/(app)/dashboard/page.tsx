'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, StatCard } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { CategoryBarChart, type CategoryBarItem } from '@/components/charts/CategoryBarChart';
import {
  MonthlyComparisonChart,
  type MonthlyComparisonRow,
} from '@/components/charts/MonthlyComparisonChart';
import { colorAt } from '@/lib/chartColors';
import { format, subMonths, endOfMonth, subDays, addDays } from 'date-fns';
import type { Meter, MeterSection, Unit, UnitAllocation } from '@/lib/types';

type ComparisonRange = 3 | 6 | 12;

interface ReadingLite {
  id: string;
  reading_value: number;
  reading_date: string;
  created_at: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Find the reading nearest to a target date (before or after, whichever is closer).
function findNearestReading(list: ReadingLite[] | undefined, targetDate: string): ReadingLite | null {
  if (!list || list.length === 0) return null;

  let before: ReadingLite | null = null;
  let after: ReadingLite | null = null;

  for (const r of list) {
    if (r.reading_date <= targetDate) {
      if (
        !before ||
        r.reading_date > before.reading_date ||
        (r.reading_date === before.reading_date && r.created_at > before.created_at)
      ) {
        before = r;
      }
    } else if (!after) {
      after = r;
    }
  }

  if (before && after) {
    const target = new Date(targetDate).getTime();
    const beforeDiff = target - new Date(before.reading_date).getTime();
    const afterDiff = new Date(after.reading_date).getTime() - target;
    return afterDiff < beforeDiff ? after : before;
  }

  return before || after;
}

export default function DashboardPage() {
  const supabase = createClient();
  const now = useMemo(() => new Date(), []);

  // Default reference month = the month before the current month.
  const defaultRef = useMemo(() => subMonths(now, 1), [now]);

  const [refMonth, setRefMonth] = useState(defaultRef.getMonth() + 1);
  const [refYear, setRefYear] = useState(defaultRef.getFullYear());
  const [comparisonRange, setComparisonRange] = useState<ComparisonRange>(3);

  const [meters, setMeters] = useState<Meter[]>([]);
  const [sections, setSections] = useState<MeterSection[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [allocations, setAllocations] = useState<UnitAllocation[]>([]);
  const [readingsByMeter, setReadingsByMeter] = useState<Map<string, ReadingLite[]>>(new Map());
  const [loading, setLoading] = useState(true);

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = now.getFullYear() - 3; y <= now.getFullYear() + 1; y++) years.push(y);
    return years;
  }, [now]);

  const refDate = useMemo(() => new Date(refYear, refMonth - 1, 1), [refYear, refMonth]);

  // Chronological list of months covered by the comparison range, ending at refDate.
  const monthsList = useMemo(() => {
    const arr: { key: string; label: string }[] = [];
    for (let i = comparisonRange - 1; i >= 0; i--) {
      const d = subMonths(refDate, i);
      arr.push({ key: format(d, 'yyyy-MM'), label: format(d, 'MMM yyyy') });
    }
    return arr;
  }, [refDate, comparisonRange]);

  // Month-end boundary dates: comparisonRange + 1 dates, used to compute
  // comparisonRange monthly differences (each month needs its own + prior month-end).
  const boundaries = useMemo(() => {
    const arr: string[] = [];
    for (let j = 0; j <= comparisonRange; j++) {
      const d = endOfMonth(subMonths(refDate, comparisonRange - j));
      arr.push(format(d, 'yyyy-MM-dd'));
    }
    return arr;
  }, [refDate, comparisonRange]);

  const fetchData = useCallback(async () => {
    setLoading(true);

    const [metersRes, sectionsRes, unitsRes, allocRes] = await Promise.all([
      supabase
        .from('meters')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('type')
        .order('name'),
      supabase.from('meter_sections').select('*').order('sort_order', { ascending: true }),
      supabase.from('units').select('*').order('sort_order', { ascending: true }),
      supabase.from('unit_allocations').select('*'),
    ]);

    const fetchedMeters = (metersRes.data || []) as Meter[];
    setMeters(fetchedMeters);
    setSections((sectionsRes.data || []) as MeterSection[]);
    setUnits((unitsRes.data || []) as Unit[]);
    setAllocations((allocRes.data || []) as UnitAllocation[]);

    if (fetchedMeters.length === 0 || boundaries.length === 0) {
      setReadingsByMeter(new Map());
      setLoading(false);
      return;
    }

    const meterIds = fetchedMeters.map((m) => m.id);
    const windowStart = format(subDays(new Date(boundaries[0]), 20), 'yyyy-MM-dd');
    const windowEnd = format(addDays(new Date(boundaries[boundaries.length - 1]), 20), 'yyyy-MM-dd');

    const { data: readingsData } = await supabase
      .from('readings')
      .select('id, meter_id, reading_value, reading_date, created_at')
      .in('meter_id', meterIds)
      .gte('reading_date', windowStart)
      .lte('reading_date', windowEnd)
      .order('reading_date', { ascending: true })
      .order('created_at', { ascending: true });

    const grouped = new Map<string, ReadingLite[]>();
    (readingsData || []).forEach((r) => {
      const arr = grouped.get(r.meter_id) || [];
      arr.push({
        id: r.id,
        reading_value: Number(r.reading_value),
        reading_date: r.reading_date,
        created_at: r.created_at,
      });
      grouped.set(r.meter_id, arr);
    });

    setReadingsByMeter(grouped);
    setLoading(false);
  }, [supabase, boundaries]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Per-meter consumption for each month in the comparison range.
  const meterMonthlyConsumption = useMemo(() => {
    const map = new Map<string, number[]>();
    meters.forEach((m) => {
      const list = readingsByMeter.get(m.id);
      const mf = Number(m.multiplication_factor) || 1;
      const values: number[] = [];
      for (let i = 0; i < comparisonRange; i++) {
        const prevReading = findNearestReading(list, boundaries[i]);
        const currReading = findNearestReading(list, boundaries[i + 1]);
        if (!prevReading || !currReading || prevReading.id === currReading.id) {
          values.push(0);
          continue;
        }
        values.push((currReading.reading_value - prevReading.reading_value) * mf);
      }
      map.set(m.id, values);
    });
    return map;
  }, [meters, readingsByMeter, boundaries, comparisonRange]);

  const sectionMap = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);

  const isKwSection = useCallback(
    (m: Meter) => {
      const sec = sectionMap.get(m.section_id || '');
      // A meter with no section assigned is treated as a standard KW/Energy meter.
      if (!sec) return true;
      return !!sec.unit?.trim().toLowerCase().startsWith('kw');
    },
    [sectionMap]
  );

  const isGasSection = useCallback(
    (m: Meter) => {
      const sec = sectionMap.get(m.section_id || '');
      const u = sec?.unit?.trim().toLowerCase() || '';
      return u.includes('m³') || u.includes('m3') || !!sec?.name?.toLowerCase().includes('gas');
    },
    [sectionMap]
  );

  const isHourSection = useCallback(
    (m: Meter) => {
      const sec = sectionMap.get(m.section_id || '');
      const u = sec?.unit?.trim().toLowerCase() || '';
      return u.includes('hr') || !!sec?.name?.toLowerCase().includes('hour');
    },
    [sectionMap]
  );

  const refIdx = comparisonRange - 1;
  const prevIdx = comparisonRange - 2;

  const sumFor = useCallback(
    (list: Meter[], idx: number) => {
      if (idx < 0) return 0;
      return list.reduce((sum, m) => sum + (meterMonthlyConsumption.get(m.id)?.[idx] || 0), 0);
    },
    [meterMonthlyConsumption]
  );

  const kwMeters = useMemo(() => meters.filter(isKwSection), [meters, isKwSection]);
  const incomingMeters = useMemo(
    () => kwMeters.filter((m) => m.type === 'incoming' || m.type === 'main'),
    [kwMeters]
  );
  const outgoingMainMeters = useMemo(
    () => kwMeters.filter((m) => m.type === 'outgoing_main' || m.type === 'outgoing'),
    [kwMeters]
  );
  const outgoingSubMeters = useMemo(
    () => kwMeters.filter((m) => m.type === 'outgoing_sub' || m.type === 'submeter'),
    [kwMeters]
  );
  const outgoingSubSubMeters = useMemo(
    () => kwMeters.filter((m) => m.type === 'outgoing_sub_sub'),
    [kwMeters]
  );

  // Named-meter lookups for the specific plant formulas below.
  // Total Incoming    = REB Off-Peak (Main) + REB Peak (Main) + Gas Gen. + Diesel Gen.
  // Outgoing (Main)   = REB (LT) reading only
  // Outgoing (Sub)    = sum of all "Outgoing Main"-type meters
  // Distribution Loss = (REB Off-Peak (Main) + REB Peak (Main)) - REB (LT)
  const findMeterByName = useCallback(
    (name: string) =>
      meters.find((m) => m.name.trim().toLowerCase() === name.trim().toLowerCase()),
    [meters]
  );
  const consumptionForName = useCallback(
    (name: string, idx: number) => {
      if (idx < 0) return 0;
      const m = findMeterByName(name);
      if (!m) return 0;
      return meterMonthlyConsumption.get(m.id)?.[idx] || 0;
    },
    [findMeterByName, meterMonthlyConsumption]
  );

  const NAMED_INCOMING_METERS = ['REB Off-Peak (Main)', 'REB Peak (Main)', 'Gas Gen.', 'Diesel Gen.'];
  const namedIncomingMeters = useMemo(
    () => NAMED_INCOMING_METERS.map(findMeterByName).filter((m): m is Meter => !!m),
    [findMeterByName]
  );
  // Flags any configured meter name that doesn't match a real meter, so a typo/rename
  // in Settings surfaces as a visible warning instead of silently showing 0.
  const missingNamedMeters = useMemo(
    () =>
      [...NAMED_INCOMING_METERS, 'REB (LT)'].filter((name) => !findMeterByName(name)),
    [findMeterByName]
  );

  const totalIncoming = sumFor(namedIncomingMeters, refIdx);
  const totalIncomingPrev = sumFor(namedIncomingMeters, prevIdx);
  const percentChange =
    totalIncomingPrev > 0 ? ((totalIncoming - totalIncomingPrev) / totalIncomingPrev) * 100 : 0;

  const rebOffPeak = consumptionForName('REB Off-Peak (Main)', refIdx);
  const rebPeak = consumptionForName('REB Peak (Main)', refIdx);
  const rebLT = consumptionForName('REB (LT)', refIdx);

  const totalOutgoingMain = rebLT; // Outgoing Power (Main) card = REB (LT) reading only
  const totalOutgoingSub = sumFor(outgoingMainMeters, refIdx); // Outgoing Power (Sub) card = sum of all Outgoing Main-type meters
  const difference = (rebOffPeak + rebPeak) - rebLT; // Distribution Loss / Variance

  // ─── Unit-wise Consumption (reference month) ───
  const unitBreakdown = useMemo(() => {
    return units.map((u, i) => {
      const uAllocs = allocations.filter((a) => a.unit_id === u.id);
      let consumption = 0;
      uAllocs.forEach((a) => {
        const v = meterMonthlyConsumption.get(a.meter_id)?.[refIdx] || 0;
        consumption += v * (Number(a.percentage) / 100);
      });
      return { id: u.id, name: u.name, consumption, color: colorAt(i) };
    });
  }, [units, allocations, meterMonthlyConsumption, refIdx]);

  // ─── Monthly Comparison Chart data (Units) ───
  // One row per Major Unit; each row carries its own base color plus a
  // month-keyed values map, so the chart can group each unit's months
  // together and shade them from that unit's color.
  const unitMonthlyRows: MonthlyComparisonRow[] = useMemo(() => {
    return units.map((u, i) => {
      const values: Record<string, number> = {};
      monthsList.forEach((m, idx) => {
        const uAllocs = allocations.filter((a) => a.unit_id === u.id);
        let val = 0;
        uAllocs.forEach((a) => {
          const v = meterMonthlyConsumption.get(a.meter_id)?.[idx] || 0;
          val += v * (Number(a.percentage) / 100);
        });
        values[m.key] = Math.round(val * 10) / 10;
      });
      return { id: u.id, name: u.name, color: colorAt(i), values };
    });
  }, [units, allocations, meterMonthlyConsumption, monthsList]);

  // ─── Meter-wise Consumption charts (reference month, KW meters only) ───
  const buildCategoryItems = useCallback(
    (list: Meter[]): CategoryBarItem[] =>
      list
        .map((m) => ({
          name: m.name,
          value: Math.round((meterMonthlyConsumption.get(m.id)?.[refIdx] || 0) * 10) / 10,
        }))
        .sort((a, b) => b.value - a.value),
    [meterMonthlyConsumption, refIdx]
  );

  const incomingItems = useMemo(() => buildCategoryItems(incomingMeters), [buildCategoryItems, incomingMeters]);
  const outgoingMainItems = useMemo(
    () => buildCategoryItems(outgoingMainMeters),
    [buildCategoryItems, outgoingMainMeters]
  );
  const outgoingSubItems = useMemo(
    () => buildCategoryItems(outgoingSubMeters),
    [buildCategoryItems, outgoingSubMeters]
  );
  const outgoingSubSubItems = useMemo(
    () => buildCategoryItems(outgoingSubSubMeters),
    [buildCategoryItems, outgoingSubSubMeters]
  );

  // ─── Gas Meter & Hour Meter charts (Incoming vs Outgoing) ───
  const buildDirectionalItems = useCallback(
    (list: Meter[]): CategoryBarItem[] =>
      list
        .map((m) => {
          const isIncoming = m.type === 'incoming' || m.type === 'main';
          return {
            name: m.name,
            value: Math.round((meterMonthlyConsumption.get(m.id)?.[refIdx] || 0) * 10) / 10,
            color: isIncoming ? '#D97706' : '#1D4ED8',
            sublabel: isIncoming ? 'Incoming' : 'Outgoing',
          };
        })
        .sort((a, b) => b.value - a.value),
    [meterMonthlyConsumption, refIdx]
  );

  const gasMeters = useMemo(() => meters.filter(isGasSection), [meters, isGasSection]);
  const hourMeters = useMemo(() => meters.filter(isHourSection), [meters, isHourSection]);
  const gasItems = useMemo(() => buildDirectionalItems(gasMeters), [buildDirectionalItems, gasMeters]);
  const hourItems = useMemo(() => buildDirectionalItems(hourMeters), [buildDirectionalItems, hourMeters]);

  const gasUnit = sections.find((s) => s.name.toLowerCase().includes('gas'))?.unit || 'm³';
  const hourUnit = sections.find((s) => s.name.toLowerCase().includes('hour'))?.unit || 'hrs';

  const refLabel = `${MONTH_NAMES[refMonth - 1]} ${refYear}`;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
          <p className="text-sm text-text-secondary mt-1">
            Factory energy consumption overview — <span className="text-accent font-semibold">{refLabel}</span>
          </p>
        </div>

        {/* Global Controls — shared by every chart on this page */}
        <Card className="px-3 py-2 w-fit max-w-full flex-shrink-0 overflow-x-auto">
          <div className="flex flex-nowrap items-center gap-2 w-max">
            <div className="w-[104px]">
              <Select
                value={refMonth}
                onChange={(e) => setRefMonth(Number(e.target.value))}
                options={MONTH_NAMES.map((name, idx) => ({ value: String(idx + 1), label: name }))}
                className="!py-1.5 !text-xs !pl-2.5 !pr-7"
              />
            </div>
            <div className="w-[82px]">
              <Select
                value={refYear}
                onChange={(e) => setRefYear(Number(e.target.value))}
                options={yearOptions.map((y) => ({ value: String(y), label: String(y) }))}
                className="!py-1.5 !text-xs !pl-2.5 !pr-7"
              />
            </div>
            <div className="w-px h-6 bg-border mx-0.5 flex-shrink-0" />
            <div className="flex items-center gap-1 flex-shrink-0">
              {([3, 6, 12] as ComparisonRange[]).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setComparisonRange(n)}
                  className={`px-2.5 py-1.5 rounded-[var(--radius-sm)] text-xs font-semibold transition-all whitespace-nowrap ${
                    comparisonRange === n
                      ? 'bg-accent text-white'
                      : 'bg-bg-elevated text-text-secondary hover:text-text-primary border border-border'
                  }`}
                >
                  {n}M
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {missingNamedMeters.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>
                <strong>Incoming/Loss totals may be incomplete.</strong> No meter found matching:{' '}
                {missingNamedMeters.map((n) => `"${n}"`).join(', ')}. Check meter names in Settings.
              </span>
            </div>
          )}

          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
            <StatCard
              label="Total Incoming Power"
              value={`${totalIncoming.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`}
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              }
              trend={totalIncomingPrev > 0 ? { value: percentChange, label: 'vs previous month' } : undefined}
              accentColor="var(--color-warning)"
            />

            <StatCard
              label="Outgoing Power (Main)"
              value={`${totalOutgoingMain.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`}
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              }
              accentColor="var(--color-accent)"
            />

            <StatCard
              label="Outgoing Power (Sub)"
              value={`${totalOutgoingSub.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`}
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                </svg>
              }
              accentColor="var(--color-success)"
            />

            <StatCard
              label="Distribution Loss / Variance"
              value={`${difference > 0 ? '+' : ''}${difference.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`}
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
              }
              accentColor={difference >= 0 ? 'var(--color-accent)' : 'var(--color-danger)'}
            />
          </div>

          {/* Unit-wise Consumption Table */}
          <Card className="p-0 overflow-hidden">
            <div className="p-4 border-b border-border bg-bg-elevated">
              <h2 className="text-lg font-semibold text-text-primary">Unit-wise Consumption</h2>
              <p className="text-xs text-text-secondary mt-0.5">
                Allocated energy per Major Unit for {refLabel} · % relative to total incoming power
              </p>
            </div>

            {units.length === 0 ? (
              <div className="text-center py-10 text-text-muted">
                <p className="text-sm">No Major Units configured.</p>
                <p className="text-xs mt-1">Configure units and allocations in Settings.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-fixed">
                  <thead>
                    <tr className="sticky top-0 z-10 bg-bg-elevated">
                      <th className="px-3 py-2.5 text-left font-bold text-[11px] uppercase tracking-wider text-text-secondary w-[25%] border-b-2 border-table-header-border">Unit Name</th>
                      <th className="px-3 py-2.5 text-right font-bold text-[11px] uppercase tracking-wider text-text-secondary w-[22%] border-b-2 border-table-header-border">kWh</th>
                      <th className="px-3 py-2.5 text-right font-bold text-[11px] uppercase tracking-wider text-text-secondary w-[53%] border-b-2 border-table-header-border">
                        Relative %
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {unitBreakdown.map((u, idx) => {
                      const pct = totalIncoming > 0 ? (u.consumption / totalIncoming) * 100 : 0;
                      return (
                        <tr
                          key={u.id}
                          className={`border-b border-border transition-colors hover:bg-bg-surface-hover ${
                            idx % 2 === 0 ? 'bg-bg-surface' : 'bg-bg-primary/50'
                          }`}
                        >
                          <td className="px-4 py-3 font-medium text-text-primary">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: u.color }} />
                              <span className="truncate" title={u.name}>{u.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-bold tabular-nums" style={{ color: u.color }}>
                            {u.consumption.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-3">
                              <div className="h-2 flex-1 bg-bg-elevated rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{ width: `${Math.min(100, pct)}%`, backgroundColor: u.color }}
                                />
                              </div>
                              <span className="text-xs font-semibold text-text-secondary tabular-nums w-12 text-right shrink-0">
                                {pct.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Monthly Comparison Bar Chart — Units */}
          <Card>
            <div className="mb-2">
              <h2 className="text-lg font-semibold text-text-primary">Monthly Comparison — Major Units</h2>
              <p className="text-xs text-text-secondary mt-0.5">
                Last {comparisonRange} months of allocated consumption, ending {refLabel}
              </p>
            </div>
            <MonthlyComparisonChart months={monthsList} rows={unitMonthlyRows} unit="kWh" />
          </Card>

          {/* Meter-wise Consumption */}
          <div>
            <h2 className="text-lg font-semibold text-text-primary mb-1">Meter-wise Consumption</h2>
            <p className="text-xs text-text-secondary mb-4">
              Energy (kWh) meters for {refLabel}, grouped by hierarchy tier
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">⚡</span>
                  <h3 className="font-semibold text-text-primary text-sm">Incoming Meters</h3>
                  <span className="text-xs text-text-muted ml-auto">{incomingItems.length} meters</span>
                </div>
                <CategoryBarChart data={incomingItems} unit="kWh" emptyMessage="No incoming meters configured." />
              </Card>

              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">⚡</span>
                  <h3 className="font-semibold text-text-primary text-sm">Outgoing Meters (Main)</h3>
                  <span className="text-xs text-text-muted ml-auto">{outgoingMainItems.length} meters</span>
                </div>
                <CategoryBarChart
                  data={outgoingMainItems}
                  unit="kWh"
                  emptyMessage="No main outgoing meters configured."
                />
              </Card>

              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">📊</span>
                  <h3 className="font-semibold text-text-primary text-sm">Outgoing Meters (Sub)</h3>
                  <span className="text-xs text-text-muted ml-auto">{outgoingSubItems.length} meters</span>
                </div>
                <CategoryBarChart data={outgoingSubItems} unit="kWh" emptyMessage="No sub outgoing meters configured." />
              </Card>

              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">📊</span>
                  <h3 className="font-semibold text-text-primary text-sm">Outgoing Meters (Sub of Sub)</h3>
                  <span className="text-xs text-text-muted ml-auto">{outgoingSubSubItems.length} meters</span>
                </div>
                <CategoryBarChart
                  data={outgoingSubSubItems}
                  unit="kWh"
                  emptyMessage="No sub-of-sub outgoing meters configured."
                />
              </Card>
            </div>
          </div>

          {/* Gas Meter & Hour Meter */}
          <div>
            <h2 className="text-lg font-semibold text-text-primary mb-1">Gas &amp; Hour Meters</h2>
            <p className="text-xs text-text-secondary mb-4">
              Incoming vs. Outgoing consumption for {refLabel}
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🔥</span>
                    <h3 className="font-semibold text-text-primary text-sm">Gas Meter</h3>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-text-secondary">
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#D97706' }} />
                      Incoming
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#1D4ED8' }} />
                      Outgoing
                    </span>
                  </div>
                </div>
                <CategoryBarChart data={gasItems} unit={gasUnit} emptyMessage="No gas meters configured." />
              </Card>

              <Card>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">⏱️</span>
                    <h3 className="font-semibold text-text-primary text-sm">Hour Meter</h3>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-text-secondary">
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#D97706' }} />
                      Incoming
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#1D4ED8' }} />
                      Outgoing
                    </span>
                  </div>
                </div>
                <CategoryBarChart data={hourItems} unit={hourUnit} emptyMessage="No hour meters configured." />
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
