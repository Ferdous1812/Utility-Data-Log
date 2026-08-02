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

interface ChartData {
  meterName: string;
  currentMonth: number;
  previousMonth: number;
}

interface DashboardChartProps {
  data: ChartData[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload) return null;

  return (
    <div className="bg-bg-elevated border border-border rounded-[var(--radius-md)] px-4 py-3 shadow-xl">
      <p className="text-sm font-semibold text-text-primary mb-2">{label}</p>
      {payload.map((entry: { color: string; name: string; value: number }, i: number) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-text-secondary">{entry.name}:</span>
          <span className="font-semibold text-text-primary">
            {entry.value.toLocaleString()} kWh
          </span>
        </div>
      ))}
    </div>
  );
}

export function DashboardChart({ data }: DashboardChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted">
        <div className="text-center">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="mx-auto mb-3 opacity-40"
          >
            <path d="M18 20V10" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12 20V4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6 20v-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="text-sm">No usage data available yet</p>
          <p className="text-xs mt-1">Start logging readings to see the chart</p>
        </div>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} barGap={4} barCategoryGap="20%">
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--color-border)"
          vertical={false}
        />
        <XAxis
          dataKey="meterName"
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
          tickFormatter={(v) => `${v} kWh`}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(29,78,216,0.06)' }} />
        <Legend
          wrapperStyle={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}
        />
        <Bar
          dataKey="currentMonth"
          name="This Month"
          fill="var(--color-accent)"
          radius={[4, 4, 0, 0]}
          maxBarSize={48}
        />
        <Bar
          dataKey="previousMonth"
          name="Last Month"
          fill="var(--color-text-muted)"
          radius={[4, 4, 0, 0]}
          maxBarSize={48}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
