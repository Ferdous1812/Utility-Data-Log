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
        bg-bg-surface border border-border rounded-[var(--radius-lg)] p-5
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
    <Card className="relative overflow-hidden">
      {/* Accent glow */}
      <div
        className="absolute top-0 right-0 w-24 h-24 rounded-full blur-3xl opacity-10"
        style={{ backgroundColor: accentColor }}
      />

      <div className="flex items-start justify-between relative z-10">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text-secondary">{label}</span>
          <span className="text-2xl font-bold text-text-primary tracking-tight">{value}</span>
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
          style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 15%, transparent)` }}
        >
          <div style={{ color: accentColor }}>{icon}</div>
        </div>
      </div>
    </Card>
  );
}
