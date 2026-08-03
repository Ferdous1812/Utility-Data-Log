'use client';

import React, { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/MultiSelect';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { Meter, MeterSection } from '@/lib/types';

interface HistoryFiltersProps {
  meters: Meter[];
  sections: MeterSection[];
  currentMeterIds: string[];
  currentSectionIds: string[];
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
  currentMeterIds,
  currentSectionIds,
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
  const setSectionIds = (ids: string[]) => updateParams({ sections: ids.join(',') });
  const setFrom = (v: string) => updateParams({ from: v });
  const setTo = (v: string) => updateParams({ to: v });

  const clearFilters = () => router.push('/history');

  const hasFilters =
    currentMeterIds.length > 0 || currentSectionIds.length > 0 || currentFrom || currentTo;

  // Section-wise meter ordering — same sequence as Settings / Log Reading:
  // walk sections in sort_order, list that section's meters (already sorted
  // by sort_order/type/name), then a trailing "Uncategorized" group.
  const meterOptions: MultiSelectOption[] = useMemo(() => {
    const bySection: MultiSelectOption[] = [];
    for (const sec of sections) {
      for (const m of meters) {
        if (m.section_id === sec.id) {
          bySection.push({ value: m.id, label: m.name, group: sec.name });
        }
      }
    }
    const uncategorized = meters
      .filter((m) => !m.section_id)
      .map((m) => ({ value: m.id, label: m.name, group: 'Uncategorized' }));

    return [...bySection, ...uncategorized];
  }, [meters, sections]);

  const sectionOptions: MultiSelectOption[] = useMemo(
    () => sections.map((s) => ({ value: s.id, label: s.name })),
    [sections]
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-60">
        <MultiSelect
          label="Section"
          placeholder="All sections"
          options={sectionOptions}
          values={currentSectionIds}
          onChange={setSectionIds}
        />
      </div>
      <div className="w-64">
        <MultiSelect
          label="Meter"
          placeholder="All meters"
          options={meterOptions}
          values={currentMeterIds}
          onChange={setMeterIds}
        />
      </div>
      <div className="w-44">
        <Input
          label="From Date"
          type="date"
          value={currentFrom || ''}
          onChange={(e) => setFrom(e.target.value)}
        />
      </div>
      <div className="w-44">
        <Input
          label="To Date"
          type="date"
          value={currentTo || ''}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          ✕ Clear
        </Button>
      )}
    </div>
  );
}

// Exported for reuse by the Excel export button, so grouping there
// stays byte-for-byte in sync with the filter's own section sequence.
export function getTypeLabel(type: string): string {
  return TYPE_LABELS[type] || 'Outgoing (Sub)';
}
