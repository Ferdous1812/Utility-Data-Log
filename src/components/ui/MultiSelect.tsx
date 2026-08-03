'use client';

import React, { useEffect, useRef, useState } from 'react';

export interface MultiSelectOption {
  value: string;
  label: string;
  group?: string;
}

interface MultiSelectProps {
  label?: string;
  placeholder?: string;
  options: MultiSelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  className?: string;
}

export function MultiSelect({
  label,
  placeholder = 'All',
  options,
  values,
  onChange,
  className = '',
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const grouped = options.reduce<Record<string, MultiSelectOption[]>>((acc, opt) => {
    const g = opt.group || '__ungrouped__';
    if (!acc[g]) acc[g] = [];
    acc[g].push(opt);
    return acc;
  }, {});
  const hasGroups = Object.keys(grouped).some((k) => k !== '__ungrouped__');

  const toggle = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter((v) => v !== value));
    } else {
      onChange([...values, value]);
    }
  };

  const allValues = options.map((o) => o.value);
  const allSelected = allValues.length > 0 && allValues.every((v) => values.includes(v));

  const toggleAll = () => {
    onChange(allSelected ? [] : allValues);
  };

  const summary =
    values.length === 0
      ? placeholder
      : values.length === 1
      ? options.find((o) => o.value === values[0])?.label || '1 selected'
      : `${values.length} selected`;

  return (
    <div className="flex flex-col gap-1.5" ref={ref}>
      {label && <label className="text-sm font-medium text-text-secondary">{label}</label>}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`
            w-full bg-bg-surface border border-border rounded-[var(--radius-md)]
            text-left text-sm text-text-primary
            pl-4 pr-10 py-2.5
            transition-all duration-200 cursor-pointer
            hover:border-accent/50
            focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
            ${open ? 'border-accent ring-1 ring-accent/30' : ''}
            ${className}
          `}
        >
          <span className={values.length === 0 ? 'text-text-muted' : ''}>{summary}</span>
        </button>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        {open && (
          <div
            className="absolute z-30 mt-1.5 w-full min-w-[220px] max-h-72 overflow-y-auto
              bg-bg-surface border border-border rounded-[var(--radius-md)] shadow-lg py-1.5"
          >
            <button
              type="button"
              onClick={toggleAll}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-bg-surface-hover transition-colors cursor-pointer"
            >
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
            <div className="h-px bg-border my-1" />

            {hasGroups
              ? Object.entries(grouped).map(([group, opts]) => (
                  <div key={group}>
                    {group !== '__ungrouped__' && (
                      <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                        {group}
                      </div>
                    )}
                    {opts.map((opt) => (
                      <MultiSelectRow
                        key={opt.value}
                        opt={opt}
                        checked={values.includes(opt.value)}
                        onToggle={toggle}
                      />
                    ))}
                  </div>
                ))
              : options.map((opt) => (
                  <MultiSelectRow
                    key={opt.value}
                    opt={opt}
                    checked={values.includes(opt.value)}
                    onToggle={toggle}
                  />
                ))}

            {options.length === 0 && (
              <div className="px-3 py-2 text-xs text-text-muted">No options</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MultiSelectRow({
  opt,
  checked,
  onToggle,
}: {
  opt: MultiSelectOption;
  checked: boolean;
  onToggle: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 px-3 py-1.5 text-sm text-text-primary hover:bg-bg-surface-hover cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(opt.value)}
        className="w-4 h-4 rounded-[var(--radius-sm)] accent-accent cursor-pointer flex-shrink-0"
      />
      <span className="truncate">{opt.label}</span>
    </label>
  );
}
