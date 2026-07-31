'use client';

import React from 'react';

interface SelectOption {
  value: string;
  label: string;
  group?: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  error?: string;
  helper?: string;
  options: SelectOption[];
  placeholder?: string;
  large?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, helper, options, placeholder, large = false, className = '', id, ...props }, ref) => {
    const selectId = id || label?.toLowerCase().replace(/\s+/g, '-');

    // Group options if they have group property
    const grouped = options.reduce<Record<string, SelectOption[]>>((acc, opt) => {
      const group = opt.group || '__ungrouped__';
      if (!acc[group]) acc[group] = [];
      acc[group].push(opt);
      return acc;
    }, {});

    const hasGroups = Object.keys(grouped).some((k) => k !== '__ungrouped__');

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className="text-sm font-medium text-text-secondary"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={`
              w-full bg-bg-surface border border-border rounded-[var(--radius-md)]
              text-text-primary appearance-none cursor-pointer
              transition-all duration-200
              focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
              disabled:opacity-50 disabled:cursor-not-allowed
              pl-4 pr-10
              ${large ? 'py-4 text-lg min-h-[56px]' : 'py-2.5 text-sm'}
              ${error ? 'border-danger focus:border-danger focus:ring-danger/30' : ''}
              ${className}
            `}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {hasGroups
              ? Object.entries(grouped).map(([group, opts]) =>
                  group === '__ungrouped__' ? (
                    opts.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))
                  ) : (
                    <optgroup key={group} label={group}>
                      {opts.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </optgroup>
                  )
                )
              : options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
          </select>
          {/* Dropdown arrow */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M4 6L8 10L12 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
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

Select.displayName = 'Select';
