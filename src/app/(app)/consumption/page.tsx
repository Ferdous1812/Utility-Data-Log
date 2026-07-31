'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { format, subMonths, endOfMonth, subDays } from 'date-fns';
import type { Meter, Reading, MeterSection } from '@/lib/types';

interface ConsumptionRow {
  meter: Meter;
  previousDate: string | null;
  previousReading: number | null;
  currentDate: string | null;
  currentReading: number | null;
  difference: number;
  multiplicationFactor: number;
  actualConsumption: number;
}

type DateMode = 'month' | 'custom';

export default function ConsumptionPage() {
  const supabase = createClient();

  const now = new Date();
  const [dateMode, setDateMode] = useState<DateMode>('month');
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());

  // Custom date range
  const [customStartDate, setCustomStartDate] = useState(
    format(subDays(now, 30), 'yyyy-MM-dd')
  );
  const [customEndDate, setCustomEndDate] = useState(
    format(now, 'yyyy-MM-dd')
  );

  const [meters, setMeters] = useState<Meter[]>([]);
  const [sections, setSections] = useState<MeterSection[]>([]);
  const [loading, setLoading] = useState(true);

  // Per-meter reading pairs: { meterId -> { prev, curr } }
  const [meterReadingPairs, setMeterReadingPairs] = useState<
    Map<string, { prevReading: Reading | null; currReading: Reading | null }>
  >(new Map());

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 1; y++) {
      years.push(y);
    }
    return years;
  }, []);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  // Compute the target dates based on mode
  const { prevTargetDate, currTargetDate } = useMemo(() => {
    if (dateMode === 'custom') {
      return {
        prevTargetDate: customStartDate,
        currTargetDate: customEndDate,
      };
    }

    // Month mode: current month 30th and previous month 30th
    const selectedDate = new Date(selectedYear, selectedMonth - 1, 1);
    const prevMonth = subMonths(selectedDate, 1);

    // Use 30th of selected month (or end of month if fewer days)
    const currMonthEnd = endOfMonth(selectedDate);
    const currDay30 = new Date(selectedYear, selectedMonth - 1, 30);
    const currTarget = currDay30 > currMonthEnd ? currMonthEnd : currDay30;

    // Use 30th of previous month (or end of month if fewer days, e.g. Feb)
    const prevMonthEnd = endOfMonth(prevMonth);
    const prevDay30 = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 30);
    const prevTarget = prevDay30 > prevMonthEnd ? prevMonthEnd : prevDay30;

    return {
      prevTargetDate: format(prevTarget, 'yyyy-MM-dd'),
      currTargetDate: format(currTarget, 'yyyy-MM-dd'),
    };
  }, [dateMode, selectedMonth, selectedYear, customStartDate, customEndDate]);

  // Fetch meters, sections, and then the nearest reading for each meter at both target dates
  const fetchData = useCallback(async () => {
    setLoading(true);

    const [metersRes, sectionsRes] = await Promise.all([
      supabase
        .from('meters')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('type')
        .order('name'),
      supabase
        .from('meter_sections')
        .select('*')
        .order('sort_order', { ascending: true }),
    ]);

    const fetchedMeters = (metersRes.data || []) as Meter[];
    setSections((sectionsRes.data || []) as MeterSection[]);
    setMeters(fetchedMeters);

    // For each meter, find the nearest reading to both target dates
    const pairs = new Map<
      string,
      { prevReading: Reading | null; currReading: Reading | null }
    >();

    for (const meter of fetchedMeters) {
      // Find nearest reading on or before the previous target date
      const { data: prevData } = await supabase
        .from('readings')
        .select('*')
        .eq('meter_id', meter.id)
        .lte('reading_date', prevTargetDate)
        .order('reading_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Find nearest reading on or before the current target date
      const { data: currData } = await supabase
        .from('readings')
        .select('*')
        .eq('meter_id', meter.id)
        .lte('reading_date', currTargetDate)
        .order('reading_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      pairs.set(meter.id, {
        prevReading: (prevData as Reading | null),
        currReading: (currData as Reading | null),
      });
    }

    setMeterReadingPairs(pairs);
    setLoading(false);
  }, [prevTargetDate, currTargetDate, supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build consumption rows
  const consumptionRows = useMemo(() => {
    const rows: ConsumptionRow[] = [];

    for (const meter of meters) {
      const pair = meterReadingPairs.get(meter.id);
      if (!pair) continue;

      const { prevReading, currReading } = pair;

      // Need both readings to calculate difference
      if (!prevReading || !currReading) continue;

      // Skip if both readings are the same reading (same date)
      if (prevReading.id === currReading.id) continue;

      const prevVal = Number(prevReading.reading_value);
      const currVal = Number(currReading.reading_value);
      const difference = currVal - prevVal;
      const mf = meter.multiplication_factor ?? 1;

      rows.push({
        meter,
        previousDate: prevReading.reading_date,
        previousReading: prevVal,
        currentDate: currReading.reading_date,
        currentReading: currVal,
        difference,
        multiplicationFactor: mf,
        actualConsumption: difference * mf,
      });
    }

    return rows;
  }, [meters, meterReadingPairs]);

  // Build meter hierarchy map
  const meterMap = useMemo(
    () => new Map<string, Meter>(meters.map((m) => [m.id, m])),
    [meters]
  );

  const motherMeters = useMemo(
    () => meters.filter((m) => m.type === 'outgoing_main' || m.type === 'outgoing'),
    [meters]
  );

  const incomingMeters = useMemo(
    () => meters.filter((m) => m.type === 'incoming' || m.type === 'main'),
    [meters]
  );

  const getRowForMeter = (meterId: string) =>
    consumptionRows.find((r) => r.meter.id === meterId);

  const getSubMetersForParent = useCallback(
    (parentId: string) =>
      meters.filter(
        (m) =>
          (m.type === 'outgoing_sub' || m.type === 'submeter') &&
          m.parent_meter_id === parentId
      ),
    [meters]
  );

  const getSubSubMetersForParent = useCallback(
    (parentId: string) =>
      meters.filter(
        (m) =>
          m.type === 'outgoing_sub_sub' &&
          m.parent_meter_id === parentId
      ),
    [meters]
  );

  const unassignedSubMeters = useMemo(
    () =>
      meters.filter(
        (m) =>
          (m.type === 'outgoing_sub' || m.type === 'submeter') &&
          (!m.parent_meter_id || !meterMap.has(m.parent_meter_id))
      ),
    [meters, meterMap]
  );

  const unassignedSubSubMeters = useMemo(
    () =>
      meters.filter(
        (m) =>
          m.type === 'outgoing_sub_sub' &&
          (!m.parent_meter_id || !meterMap.has(m.parent_meter_id))
      ),
    [meters, meterMap]
  );

  // Totals
  const grandTotal = consumptionRows.reduce(
    (sum, r) => sum + r.actualConsumption,
    0
  );
  const incomingTotal = consumptionRows
    .filter(
      (r) => r.meter.type === 'incoming' || r.meter.type === 'main'
    )
    .reduce((sum, r) => sum + r.actualConsumption, 0);
  const outgoingTotal = consumptionRows
    .filter(
      (r) =>
        r.meter.type === 'outgoing_main' ||
        r.meter.type === 'outgoing' ||
        r.meter.type === 'outgoing_sub' ||
        r.meter.type === 'submeter' ||
        r.meter.type === 'outgoing_sub_sub'
    )
    .reduce((sum, r) => sum + r.actualConsumption, 0);

  // Period label
  const periodLabel = dateMode === 'month'
    ? `${monthNames[selectedMonth - 1]} ${selectedYear}`
    : `${format(new Date(customStartDate), 'dd MMM yyyy')} → ${format(new Date(customEndDate), 'dd MMM yyyy')}`;

  function getSectionUnit(sec?: MeterSection | null, meterSectionId?: string | null): string {
    const foundSec = sec || sections.find((s) => s.id === meterSectionId);
    if (foundSec?.unit) return foundSec.unit;
    if (foundSec?.name?.toLowerCase().includes('gas')) return 'm³';
    if (foundSec?.name?.toLowerCase().includes('hour')) return 'hrs';
    return 'kWh';
  }

  function renderRow(row: ConsumptionRow | undefined, isChild = false, isGrandchild = false, customUnit?: string) {
    if (!row) return null;
    const unitLabel = customUnit || getSectionUnit(null, row.meter.section_id);

    return (
      <tr
        key={row.meter.id}
        className={`h-14 border-b border-border/50 transition-colors hover:bg-bg-surface-hover ${
          isGrandchild ? 'bg-bg-primary/60' : isChild ? 'bg-bg-primary/70' : 'bg-bg-surface'
        }`}
      >
        <td
          className={`px-4 py-2.5 text-sm font-medium ${
            isGrandchild ? 'pl-14 text-text-muted' : isChild ? 'pl-9 text-text-secondary' : 'text-text-primary'
          }`}
        >
          <div className="flex items-center gap-2">
            {isGrandchild && (
              <span className="text-danger/70 font-mono text-xs">└─</span>
            )}
            {isChild && !isGrandchild && (
              <span className="text-accent/70 font-mono text-xs">└─</span>
            )}
            <div>
              <div className="leading-tight">{row.meter.name}</div>
              <div className="mt-0.5 text-[11px] text-text-muted">
                {row.meter.location}
              </div>
            </div>
          </div>
        </td>
        <td className="px-4 py-2.5 text-right text-sm tabular-nums text-text-muted">
          {row.previousReading != null
            ? row.previousReading.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : '—'}
        </td>
        <td className="px-4 py-2.5 text-center text-sm text-text-muted whitespace-nowrap">
          {row.previousDate
            ? format(new Date(row.previousDate), 'dd MMM yyyy')
            : '—'}
        </td>
        <td className="px-4 py-2.5 text-right text-sm tabular-nums text-text-primary font-medium">
          {row.currentReading != null
            ? row.currentReading.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : '—'}
        </td>
        <td className="px-4 py-2.5 text-center text-sm text-text-muted whitespace-nowrap">
          {row.currentDate
            ? format(new Date(row.currentDate), 'dd MMM yyyy')
            : '—'}
        </td>
        <td className="px-4 py-2.5 text-right text-sm tabular-nums font-medium text-text-primary">
          {row.difference.toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })}
        </td>
        <td className="px-4 py-2.5 text-center text-sm tabular-nums font-bold text-accent">
          {row.multiplicationFactor}×
        </td>
        <td className="px-4 py-2.5 text-right text-sm tabular-nums font-bold text-warning">
          {row.actualConsumption.toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })}{' '}
          <span className="text-text-muted font-normal">{unitLabel}</span>
        </td>
      </tr>
    );
  }

  function renderGroupSubtotal(
    label: string,
    total: number,
    color: string,
    unit = 'kWh'
  ) {
    return (
      <tr className="bg-bg-elevated/70 font-semibold border-b border-border">
        <td colSpan={7} className={`px-4 py-2 ${color} text-xs`}>
          Subtotal — {label}
        </td>
        <td className={`px-4 py-2 text-right ${color} font-bold tabular-nums`}>
          {total.toLocaleString(undefined, { maximumFractionDigits: 2 })} {unit}
        </td>
      </tr>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">
          Consumption Data
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Monthly consumption = Current Reading (≈30th) − Previous Reading (≈30th of last month) × M.F
        </p>
      </div>

      {/* Date Mode Selector & Filters */}
      <Card className="py-3.5 px-4">
        {/* Mode Toggle */}
        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={() => setDateMode('month')}
            className={`px-4 py-2 rounded-[var(--radius-md)] text-sm font-semibold transition-all ${
              dateMode === 'month'
                ? 'bg-accent text-white shadow-sm'
                : 'bg-bg-elevated text-text-secondary hover:text-text-primary border border-border'
            }`}
          >
            📅 Monthly (30th → 30th)
          </button>
          <button
            type="button"
            onClick={() => setDateMode('custom')}
            className={`px-4 py-2 rounded-[var(--radius-md)] text-sm font-semibold transition-all ${
              dateMode === 'custom'
                ? 'bg-accent text-white shadow-sm'
                : 'bg-bg-elevated text-text-secondary hover:text-text-primary border border-border'
            }`}
          >
            📆 Custom Date Range
          </button>
        </div>

        {dateMode === 'month' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">
                Month
              </label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="w-full bg-bg-surface border border-border rounded-[var(--radius-md)] text-text-primary py-2.5 px-4 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 cursor-pointer"
              >
                {monthNames.map((name, idx) => (
                  <option key={idx} value={idx + 1}>
                    {name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-text-muted mt-0.5">
                Consumption = reading on 30th {monthNames[selectedMonth - 1]} − reading on 30th {monthNames[selectedMonth - 2 >= 0 ? selectedMonth - 2 : 11]}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">
                Year
              </label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="w-full bg-bg-surface border border-border rounded-[var(--radius-md)] text-text-primary py-2.5 px-4 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 cursor-pointer"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Start Date (Previous Reading)"
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
            />
            <Input
              label="End Date (Current Reading)"
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
            />
          </div>
        )}

        {/* Active range indicator */}
        <div className="mt-3 pt-3 border-t border-border/50 flex flex-wrap items-center gap-3 text-xs text-text-muted">
          <span className="font-medium text-text-secondary">Active Range:</span>
          <span className="px-2.5 py-1 rounded-full bg-accent/10 text-accent font-semibold border border-accent/20">
            {format(new Date(prevTargetDate), 'dd MMM yyyy')}
          </span>
          <span className="text-text-muted">→</span>
          <span className="px-2.5 py-1 rounded-full bg-warning/10 text-warning font-semibold border border-warning/20">
            {format(new Date(currTargetDate), 'dd MMM yyyy')}
          </span>
          <span className="text-text-muted/60 italic ml-1">
            (nearest available readings on or before these dates are used)
          </span>
        </div>
      </Card>

      {/* Consumption Table Cards per Section */}
      {loading ? (
        <Card className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-sm text-text-muted">
            Loading consumption data...
          </span>
        </Card>
      ) : consumptionRows.length === 0 ? (
        <Card className="text-center py-16 text-text-muted">
          <p className="text-sm font-medium">
            No consumption data for {periodLabel}
          </p>
          <p className="text-xs mt-1">
            Make sure readings exist near the target dates. Log readings on the Meter Log page first.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {sections.map((sec) => {
            const secRows = consumptionRows.filter((r) => r.meter.section_id === sec.id);
            if (secRows.length === 0) return null;

            const secIncoming = incomingMeters.filter((m) => m.section_id === sec.id);
            const secMothers = motherMeters.filter((m) => m.section_id === sec.id);
            const secUnassignedSub = unassignedSubMeters.filter((m) => m.section_id === sec.id);
            const secUnassignedSubSub = unassignedSubSubMeters.filter((m) => m.section_id === sec.id);

            const secTotal = secRows.reduce((sum, r) => sum + r.actualConsumption, 0);
            const unitStr = getSectionUnit(sec);

            return (
              <Card key={sec.id} className="p-0 overflow-hidden border border-border/80 shadow-sm">
                {/* Section Title Bar */}
                <div className="px-5 py-3.5 bg-bg-elevated border-b border-border flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xl">{sec.icon}</span>
                    <h2 className="text-base font-bold text-text-primary">{sec.name}</h2>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-accent/15 text-accent border border-accent/20">
                      {secRows.length} {secRows.length === 1 ? 'Meter' : 'Meters'}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-warning">
                    Total: {secTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} {unitStr}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-bg-elevated/40 border-b border-border text-xs text-text-secondary">
                        <th className="px-4 py-2.5 text-left font-semibold">Meter Name</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Previous Reading</th>
                        <th className="px-4 py-2.5 text-center font-semibold">Previous Date</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Current Reading</th>
                        <th className="px-4 py-2.5 text-center font-semibold">Current Date</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Difference</th>
                        <th className="px-4 py-2.5 text-center font-semibold">M.F</th>
                        <th className="px-4 py-2.5 text-right font-semibold text-warning">Actual Consumption</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Incoming */}
                      {secIncoming.some((m) => getRowForMeter(m.id)) && (
                        <>
                          <tr className="bg-warning/10 border-y border-warning/20">
                            <td colSpan={8} className="px-4 py-2 font-bold text-warning text-xs uppercase tracking-wider">
                              ⚡ Incoming Meters
                            </td>
                          </tr>
                          {secIncoming.map((m) => renderRow(getRowForMeter(m.id), false, false, unitStr))}
                        </>
                      )}

                      {/* Mothers + Submeters */}
                      {secMothers.length > 0 && (
                        <>
                          <tr className="bg-accent/10 border-y border-accent/20">
                            <td colSpan={8} className="px-4 py-2 font-bold text-accent text-xs uppercase tracking-wider">
                              ⚡ Mother Meters &amp; Submeters
                            </td>
                          </tr>
                          {secMothers.map((mother) => {
                            const children = getSubMetersForParent(mother.id);
                            return (
                              <React.Fragment key={mother.id}>
                                {renderRow(getRowForMeter(mother.id), false, false, unitStr)}
                                {children.map((child) => {
                                  const grandchildren = getSubSubMetersForParent(child.id);
                                  return (
                                    <React.Fragment key={child.id}>
                                      {renderRow(getRowForMeter(child.id), true, false, unitStr)}
                                      {grandchildren.map((gc) =>
                                        renderRow(getRowForMeter(gc.id), false, true, unitStr)
                                      )}
                                    </React.Fragment>
                                  );
                                })}
                              </React.Fragment>
                            );
                          })}
                        </>
                      )}

                      {/* Unassigned Sub */}
                      {secUnassignedSub.some((m) => getRowForMeter(m.id)) && (
                        <>
                          <tr className="bg-success/10 border-y border-success/20">
                            <td colSpan={8} className="px-4 py-2 font-bold text-success text-xs uppercase tracking-wider">
                              📊 Unassigned Submeters
                            </td>
                          </tr>
                          {secUnassignedSub.map((m) => renderRow(getRowForMeter(m.id), false, false, unitStr))}
                        </>
                      )}

                      {/* Unassigned Sub of Sub */}
                      {secUnassignedSubSub.some((m) => getRowForMeter(m.id)) && (
                        <>
                          <tr className="bg-danger/10 border-y border-danger/20">
                            <td colSpan={8} className="px-4 py-2 font-bold text-danger text-xs uppercase tracking-wider">
                              📊 Unassigned Sub of Sub
                            </td>
                          </tr>
                          {secUnassignedSubSub.map((m) => renderRow(getRowForMeter(m.id), false, false, unitStr))}
                        </>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="bg-bg-elevated border-t-2 border-border font-bold">
                        <td colSpan={7} className="px-4 py-2.5 text-text-primary">
                          Section Total — {sec.name} ({periodLabel})
                        </td>
                        <td className="px-4 py-2.5 text-right text-warning tabular-nums">
                          {secTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} {unitStr}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            );
          })}

          {/* Uncategorized Meters Card */}
          {consumptionRows.some((r) => !r.meter.section_id) && (
            <Card className="p-0 overflow-hidden border border-border/80 shadow-sm">
              <div className="px-5 py-3.5 bg-bg-elevated border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">📦</span>
                  <h2 className="text-base font-bold text-text-primary">Uncategorized Meters</h2>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-bg-elevated/40 border-b border-border text-xs text-text-secondary">
                      <th className="px-4 py-2.5 text-left font-semibold">Meter Name</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Previous Reading</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Previous Date</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Current Reading</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Current Date</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Difference</th>
                      <th className="px-4 py-2.5 text-center font-semibold">M.F</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-warning">Actual Consumption</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consumptionRows.filter((r) => !r.meter.section_id).map((r) => renderRow(r, false, false, 'units'))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Summary Cards per Section */}
      {consumptionRows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {sections.map((sec) => {
            const secRows = consumptionRows.filter((r) => r.meter.section_id === sec.id);
            const total = secRows.reduce((sum, r) => sum + r.actualConsumption, 0);
            const unitStr = getSectionUnit(sec);
            return (
              <Card key={sec.id} className="py-4 px-5">
                <div className="flex items-center gap-2 text-xs text-text-muted uppercase tracking-wider font-semibold">
                  <span>{sec.icon}</span>
                  <span>{sec.name}</span>
                </div>
                <div className="text-xl font-bold text-accent tabular-nums mt-1.5">
                  {total.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                  <span className="text-sm font-medium text-text-secondary">{unitStr}</span>
                </div>
                <div className="text-xs text-text-muted mt-1">
                  {secRows.length} active meter{secRows.length !== 1 ? 's' : ''} logged
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
