'use client';

import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helper?: string;
  icon?: React.ReactNode;
  large?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helper, icon, large = false, className = '', id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-text-secondary"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={`
              w-full bg-bg-surface border border-border rounded-[var(--radius-md)]
              text-text-primary placeholder:text-text-muted
              transition-all duration-200
              focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
              disabled:opacity-50 disabled:cursor-not-allowed
              ${icon ? 'pl-10' : 'pl-4'} pr-4
              ${large ? 'py-4 text-lg min-h-[56px]' : 'py-2.5 text-sm'}
              ${error ? 'border-danger focus:border-danger focus:ring-danger/30' : ''}
              ${className}
            `}
            {...props}
          />
        </div>
        {error && (
          <p className="text-xs text-danger mt-0.5">{error}</p>
        )}
        {helper && !error && (
          <p className="text-xs text-text-muted mt-0.5">{helper}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
