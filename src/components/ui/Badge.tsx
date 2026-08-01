import React from 'react';

type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-border/50 text-text-secondary',
  accent: 'bg-accent/15 text-accent',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
};

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold
        ${variantClasses[variant]}
        ${className}
      `}
    >
      {children}
    </span>
  );
}

export function RoleBadge({ role }: { role: 'admin' | 'operator' }) {
  return (
    <Badge variant={role === 'admin' ? 'accent' : 'default'}>
      {role === 'admin' ? 'Admin' : 'Operator'}
    </Badge>
  );
}

export function MeterTypeBadge({ type }: { type: 'incoming' | 'outgoing_main' | 'outgoing_sub' | 'outgoing_sub_sub' | 'main' | 'submeter' | 'outgoing' }) {
  if (type === 'incoming' || type === 'main') {
    return <Badge variant="warning">Incoming</Badge>;
  }
  if (type === 'outgoing_main' || type === 'outgoing') {
    return <Badge variant="accent">Outgoing (Main)</Badge>;
  }
  if (type === 'outgoing_sub_sub') {
    return <Badge variant="danger">Sub of Sub</Badge>;
  }
  return <Badge variant="success">Outgoing (Sub)</Badge>;
}
