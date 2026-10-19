'use client';

import React, { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/MultiSelect';
import type { Meter, MeterSection } from '@/lib/types';

interface HistoryFiltersProps {
  meters: Meter[];
  sections: MeterSection[];
  activeSectionId?: string;
  currentMeterIds: string[];
  currentFrom?: string;
  currentTo?: string;
}

const TYPE_LABELS: Record<string, string> = {
  incoming: 'Incoming',
  main: 'Incoming',
  outgoing_main: 'Outgoing (Main)',
  outgoing: 'Outgoing (Main)',
  outgoing_sub: 'Outgoing (Sub)',
  submeter: 'Outgoing (Sub)',
  outgoing_sub_sub: 'Sub of Sub',
};

export function HistoryFilters({
  meters,
  sections,
  activeSectionId,
  currentMeterIds,
  currentFrom,
  currentTo,
}: HistoryFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParams = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    router.push(`/history?${params.toString()}`);
  };

  const setMeterIds = (ids: string[]) => updateParams({ meters: ids.join(',') });
  const setFrom = (v: string) => updateParams({ from: v });
  const setTo = (v: string) => updateParams({ to: v });

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('meters');
    params.delete('from');
    params.delete('to');
    router.push(`/history?${params.toString()}`);
  };

  const hasFilters = currentMeterIds.length > 0 || currentFrom || currentTo;

  // Filter meters to ONLY those belonging to the active section/tab
  const tabMeters = useMemo(() => {
    if (!activeSectionId) return meters;
    if (activeSectionId === '__uncategorized__') {
      return meters.filter((m) => !m.section_id);
    }
    return meters.filter((m) => m.section_id === activeSectionId);
  }, [meters, activeSectionId]);

  const meterOptions: MultiSelectOption[] = useMemo(() => {
    return tabMeters.map((m) => ({
      value: m.id,
      label: m.name,
    }));
  }, [tabMeters]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Meter Filter — compact */}
      <div className="w-48 sm:w-56">
        <MultiSelect
          placeholder="All meters"
          options={meterOptions}
          values={currentMeterIds}
          onChange={setMeterIds}
          compact
        />
      </div>

      {/* Date From */}
      <div className="relative group">
        <label className="absolute -top-1.5 left-2 text-[8px] uppercase font-bold tracking-wider text-text-muted bg-bg-primary px-1 z-10 leading-none">
          From
        </label>
        <input
          type="date"
          value={currentFrom || ''}
          onChange={(e) => setFrom(e.target.value)}
          className="bg-bg-surface border border-border/80 rounded-[var(--radius-sm)] text-[11px] text-text-primary
            pl-2 pr-1.5 py-1 w-[120px]
            focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20
            hover:border-accent/40 transition-all cursor-pointer"
        />
      </div>

      {/* Date To */}
      <div className="relative group">
        <label className="absolute -top-1.5 left-2 text-[8px] uppercase font-bold tracking-wider text-text-muted bg-bg-primary px-1 z-10 leading-none">
          To
        </label>
        <input
          type="date"
          value={currentTo || ''}
          onChange={(e) => setTo(e.target.value)}
          className="bg-bg-surface border border-border/80 rounded-[var(--radius-sm)] text-[11px] text-text-primary
            pl-2 pr-1.5 py-1 w-[120px]
            focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20
            hover:border-accent/40 transition-all cursor-pointer"
        />
      </div>

      {/* Clear */}
      {hasFilters && (
        <button
          type="button"
          onClick={clearFilters}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-[var(--radius-sm)]
            text-text-muted hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer select-none"
          title="Clear all filters"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Clear
        </button>
      )}
    </div>
  );
}

// Exported for reuse by the Excel export button, so grouping there
// stays byte-for-byte in sync with the filter's own section sequence.
export function getTypeLabel(type: string): string {
  return TYPE_LABELS[type] || 'Outgoing (Sub)';
}
