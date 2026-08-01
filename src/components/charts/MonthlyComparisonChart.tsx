'use client';

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export interface MonthlyComparisonSeries {
  key: string;
  name: string;
  color: string;
}

export interface MonthlyComparisonRow {
  month: string;
  [seriesKey: string]: string | number;
}

interface MonthlyComparisonChartProps {
  data: MonthlyComparisonRow[];
  series: MonthlyComparisonSeries[];
  unit?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-bg-elevated border border-border rounded-[var(--radius-md)] px-4 py-3 shadow-xl max-w-xs">
      <p className="text-sm font-semibold text-text-primary mb-2">{label}</p>
      <div className="space-y-1">
        {payload
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((e: any) => Number(e.value) !== 0)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((entry: any, i: number) => (
            <div key={i} className="flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: entry.color }} />
                <span className="text-text-secondary">{entry.name}</span>
              </div>
              <span className="font-semibold text-text-primary tabular-nums">
                {Number(entry.value).toLocaleString(undefined, { maximumFractionDigits: 1 })} {unit}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

export function MonthlyComparisonChart({ data, series, unit = 'kWh' }: MonthlyComparisonChartProps) {
  if (!data.length || !series.length) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted">
        <p className="text-sm">No Major Units configured yet.</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={data} barGap={3} barCategoryGap="18%" margin={{ top: 10, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="month"
          stroke="var(--color-text-muted)"
          fontSize={12}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-border)' }}
        />
        <YAxis
          stroke="var(--color-text-muted)"
          fontSize={12}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-border)' }}
          tickFormatter={(v) => `${v.toLocaleString()}`}
        />
        <Tooltip content={<CustomTooltip unit={unit} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Legend wrapperStyle={{ fontSize: '12px', color: 'var(--color-text-secondary)' }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={40} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
