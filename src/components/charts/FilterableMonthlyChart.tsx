'use client';

import React, { useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { MonthlyComparisonChart } from '@/components/charts/MonthlyComparisonChart';
import type {
  MonthlyComparisonMonth,
  MonthlyComparisonRow,
} from '@/components/charts/MonthlyComparisonChart';

interface FilterableChartCardProps {
  /** Graph name shown on the left of the header. */
  title: React.ReactNode;
  /** Optional extra header content (meter count, legend, ...) shown before the filter. */
  headerExtra?: React.ReactNode;
  months: MonthlyComparisonMonth[];
  rows: MonthlyComparisonRow[];
  unit?: string;
  emptyMessage?: string;
  yAxisWidth?: number;
}

/**
 * Dashboard graph card: title with a multi-select meter filter beside it,
 * followed by the monthly comparison chart. All meters are shown by default;
 * deselect/select meters to compare. Tracks *hidden* ids so newly loaded
 * meters are visible by default.
 */
export function FilterableChartCard({
  title,
  headerExtra,
  months,
  rows,
  unit,
  emptyMessage,
  yAxisWidth,
}: FilterableChartCardProps) {
  // Per-row overrides of the default visibility (rows may start hidden via defaultHidden)
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const options = useMemo(() => rows.map((r) => ({ value: r.id, label: r.name })), [rows]);
  const selected = useMemo(
    () => rows.filter((r) => overrides[r.id] ?? !r.defaultHidden).map((r) => r.id),
    [rows, overrides]
  );
  const visibleRows = useMemo(() => rows.filter((r) => selected.includes(r.id)), [rows, selected]);

  const handleChange = (values: string[]) => {
    const next: Record<string, boolean> = {};
    rows.forEach((r) => {
      next[r.id] = values.includes(r.id);
    });
    setOverrides(next);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
        <h3 className="font-semibold text-text-primary text-sm">{title}</h3>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {headerExtra}
          {rows.length > 1 && (
            <div className="w-56">
              <MultiSelect
                compact
                placeholder="No meters selected"
                options={options}
                values={selected}
                onChange={handleChange}
              />
            </div>
          )}
        </div>
      </div>
      <MonthlyComparisonChart
        months={months}
        rows={visibleRows}
        unit={unit}
        yAxisWidth={yAxisWidth}
        emptyMessage={rows.length > 0 ? 'No meters selected. Use the filter to choose meters.' : emptyMessage}
      />
    </Card>
  );
}
