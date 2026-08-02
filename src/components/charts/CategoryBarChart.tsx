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

export interface CategoryBarItem {
  name: string;
  value: number;
  color?: string;
  sublabel?: string;
}

interface CategoryBarChartProps {
  data: CategoryBarItem[];
  unit?: string;
  emptyMessage?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, unit }: any) {
  if (!active || !payload || !payload.length) return null;
  const item = payload[0];
  return (
    <div className="bg-bg-elevated border border-border rounded-[var(--radius-md)] px-4 py-2.5 shadow-xl">
      <p className="text-sm font-semibold text-text-primary mb-1">{item.payload.name}</p>
      {item.payload.sublabel && (
        <p className="text-[11px] text-text-muted mb-1">{item.payload.sublabel}</p>
      )}
      <div className="flex items-center gap-2 text-sm">
        <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: item.payload.fillColor }} />
        <span className="font-semibold text-text-primary tabular-nums">
          {Number(item.value).toLocaleString(undefined, { maximumFractionDigits: 1 })} {unit}
        </span>
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

  const horizontal = data.length > 6 || data.some((d) => d.name.length > 14);
  const height = horizontal ? Math.max(220, data.length * 42) : 300;

  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={withColor} layout="vertical" margin={{ top: 4, right: 46, left: 4, bottom: 4 }}>
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
          <Tooltip content={<CustomTooltip unit={unit} />} cursor={{ fill: 'rgba(29,78,216,0.06)' }} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={22}>
            {withColor.map((d, i) => (
              <Cell key={i} fill={d.fillColor} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={((v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })) as any}
              style={{ fill: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={withColor} margin={{ top: 20, right: 8, left: 0, bottom: 4 }} barCategoryGap="24%">
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="name"
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
        />
        <Tooltip content={<CustomTooltip unit={unit} />} cursor={{ fill: 'rgba(29,78,216,0.06)' }} />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
          {withColor.map((d, i) => (
            <Cell key={i} fill={d.fillColor} />
          ))}
          <LabelList
            dataKey="value"
            position="top"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={((v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })) as any}
            style={{ fill: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
