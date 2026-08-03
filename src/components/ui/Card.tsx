import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
}

export function Card({ children, className = '', hover = false, glow = false }: CardProps) {
  return (
    <div
      className={`
        bg-bg-surface border border-border rounded-[var(--radius-lg)] p-4 sm:p-5
        transition-all duration-200
        ${hover ? 'hover:border-accent/40 hover:bg-bg-surface-hover cursor-pointer' : ''}
        ${glow ? 'animate-pulse-glow' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: {
    value: number;
    label: string;
  };
  accentColor?: string;
}

export function StatCard({ label, value, icon, trend, accentColor = 'var(--color-accent)' }: StatCardProps) {
  const isPositive = trend && trend.value >= 0;

  return (
    <Card className="relative overflow-hidden !p-0">
      {/* Flat accent stripe */}
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ backgroundColor: accentColor }} />

      <div className="flex items-start justify-between relative z-10 p-5 pt-[22px]">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wider text-text-secondary">{label}</span>
          <span className="text-2xl font-semibold text-text-primary tracking-tight tabular-nums">{value}</span>
          {trend && (
            <div className="flex items-center gap-1 mt-1">
              <span
                className={`text-xs font-semibold ${
                  isPositive ? 'text-danger' : 'text-success'
                }`}
              >
                {isPositive ? '▲' : '▼'} {Math.abs(trend.value).toFixed(1)}%
              </span>
              <span className="text-xs text-text-muted">{trend.label}</span>
            </div>
          )}
        </div>
        <div
          className="flex items-center justify-center w-11 h-11 rounded-[var(--radius-md)]"
          style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 12%, transparent)` }}
        >
          <div style={{ color: accentColor }}>{icon}</div>
        </div>
      </div>
    </Card>
  );
}
