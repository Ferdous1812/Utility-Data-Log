'use client';

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { shadeForIndex } from '@/lib/chartColors';

export interface MonthlyComparisonMonth {
  key: string;
  label: string;
}

export interface MonthlyComparisonRow {
  id: string;
  name: string;
  color: string;
  values: Record<string, number>;
}

interface MonthlyComparisonChartProps {
  months: MonthlyComparisonMonth[];
  rows: MonthlyComparisonRow[];
  unit?: string;
  emptyMessage?: string;
  /** Width (px) reserved for the Y-axis category labels. Increase this when
   *  meter/row names are long and get clipped. Defaults to 110. */
  yAxisWidth?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ColoredAxisTick({ x, y, payload, colorMap }: any) {
  const color = colorMap[payload.value] || 'var(--color-text-secondary)';
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={12} fontWeight={600} fill={color}>
      {payload.value}
    </text>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label, unit, months }: any) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="bg-bg-elevated border border-border rounded-[var(--radius-md)] px-4 py-3 shadow-xl max-w-xs">
      <p className="text-sm font-semibold text-text-primary mb-2">{label}</p>
      <div className="space-y-1">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {months.map((m: MonthlyComparisonMonth, idx: number) => {
          const value = row?.[m.key];
          if (!value) return null;
          const swatch = shadeForIndex(row.baseColor, idx, months.length);
          return (
            <div key={m.key} className="flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: swatch }} />
                <span className="text-text-secondary">{m.label}</span>
              </div>
              <span className="font-semibold text-text-primary tabular-nums">
                {Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} {unit}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MonthlyComparisonChart({ months, rows, unit = 'kWh', emptyMessage, yAxisWidth = 110 }: MonthlyComparisonChartProps) {
  if (!rows.length || !months.length) {
    return (
      <div className="flex items-center justify-center h-40 text-text-muted">
        <p className="text-sm">{emptyMessage || 'No data available for this period'}</p>
      </div>
    );
  }

  // Flatten each row's per-month values plus a `baseColor` field the
  // tooltip/cells use to derive the correct shade.
  const data = rows.map((r) => ({ name: r.name, baseColor: r.color, ...r.values }));
  const colorMap = Object.fromEntries(rows.map((r) => [r.name, r.color]));
  const height = Math.max(280, rows.length * months.length * 20 + rows.length * 16);

  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" barGap={3} barCategoryGap="22%" margin={{ top: 10, right: 40, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
          <XAxis
            type="number"
            stroke="var(--color-text-muted)"
            fontSize={12}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-border)' }}
            tickFormatter={(v) => `${v.toLocaleString()}`}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={yAxisWidth}
            tick={<ColoredAxisTick colorMap={colorMap} />}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-border)' }}
          />
          <Tooltip content={<CustomTooltip unit={unit} months={months} />} cursor={{ fill: 'rgba(29,78,216,0.06)' }} />
          {months.map((m, monthIdx) => (
            <Bar key={m.key} dataKey={m.key} name={m.label} radius={[0, 4, 4, 0]} maxBarSize={18}>
              {data.map((row, rowIdx) => (
                <Cell key={rowIdx} fill={shadeForIndex(row.baseColor, monthIdx, months.length)} />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}
