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
  LabelList,
} from 'recharts';
import { colorAt } from '@/lib/chartColors';

// A stacked-bar item is built from segments instead of a single value —
// e.g. REB (Main) = Off-Peak + Peak combined into one bar with two colors.
export interface CategoryBarSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface CategoryBarItem {
  name: string;
  value?: number; // plain single-color bar
  color?: string;
  sublabel?: string;
  segments?: CategoryBarSegment[]; // if present, renders as a stacked bar instead
}

interface CategoryBarChartProps {
  data: CategoryBarItem[];
  unit?: string;
  emptyMessage?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, unit, segmentDefs }: any) {
  if (!active || !payload || !payload.length) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const relevant = payload.filter((e: any) => Number(e.value) > 0);
  if (!relevant.length) return null;
  const rowName = relevant[0].payload.name;

  return (
    <div className="bg-bg-elevated border border-border rounded-[var(--radius-md)] px-4 py-2.5 shadow-xl max-w-xs">
      <p className="text-sm font-semibold text-text-primary mb-1.5">{rowName}</p>
      <div className="space-y-1">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {relevant.map((entry: any, i: number) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const segDef = segmentDefs.find((s: any) => s.key === entry.dataKey);
          const swatch = segDef ? segDef.color : entry.payload.fillColor;
          const label = segDef ? segDef.label : null;
          return (
            <div key={i} className="flex items-center gap-2 text-sm">
              <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: swatch }} />
              {label && <span className="text-xs text-text-secondary">{label}:</span>}
              <span className="font-semibold text-text-primary tabular-nums">
                {Number(entry.value).toLocaleString(undefined, { maximumFractionDigits: 1 })} {unit}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CategoryBarChart({ data, unit = 'kWh', emptyMessage }: CategoryBarChartProps) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-40 text-text-muted">
        <p className="text-sm">{emptyMessage || 'No data available for this period'}</p>
      </div>
    );
  }

  const withColor = data.map((d, i) => ({ ...d, fillColor: d.color || colorAt(i) }));

  // Collect the distinct segment definitions across all items (preserving
  // first-seen order), so stacked items share one consistent set of Bars.
  const segmentDefs: CategoryBarSegment[] = [];
  withColor.forEach((item) => {
    item.segments?.forEach((seg) => {
      if (!segmentDefs.find((s) => s.key === seg.key)) segmentDefs.push(seg);
    });
  });

  // Flatten each item into one row: plain items get `value`, stacked items
  // get one field per segment key (e.g. row.offPeak, row.peak).
  const rows = withColor.map((item) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = { name: item.name, sublabel: item.sublabel, fillColor: item.fillColor };
    if (item.segments && item.segments.length) {
      item.segments.forEach((seg) => {
        row[seg.key] = seg.value;
      });
    } else {
      row.value = item.value ?? 0;
    }
    return row;
  });

  const height = Math.max(220, rows.length * 42);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 46, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
        <XAxis
          type="number"
          stroke="var(--color-text-muted)"
          fontSize={11}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-border)' }}
          tickFormatter={(v) => `${v.toLocaleString()}`}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={150}
          stroke="var(--color-text-secondary)"
          fontSize={12}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-border)' }}
        />
        <Tooltip content={<CustomTooltip unit={unit} segmentDefs={segmentDefs} />} cursor={{ fill: 'rgba(29,78,216,0.06)' }} />

        {segmentDefs.map((seg, i) => (
          <Bar
            key={seg.key}
            dataKey={seg.key}
            stackId="segments"
            fill={seg.color}
            radius={i === 0 ? [6, 0, 0, 6] : i === segmentDefs.length - 1 ? [0, 6, 6, 0] : [0, 0, 0, 0]}
            maxBarSize={22}
          />
        ))}

        <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={22}>
          {rows.map((d, i) => (
            <Cell key={i} fill={d.fillColor} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={((v: number) => (v ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '')) as any}
            style={{ fill: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
