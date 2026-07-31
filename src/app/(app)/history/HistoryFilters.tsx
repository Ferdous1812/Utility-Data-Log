'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { Meter } from '@/lib/types';

interface HistoryFiltersProps {
  meters: Meter[];
  currentMeter?: string;
  currentFrom?: string;
  currentTo?: string;
}

export function HistoryFilters({ meters, currentMeter, currentFrom, currentTo }: HistoryFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/history?${params.toString()}`);
  };

  const clearFilters = () => {
    router.push('/history');
  };

  const hasFilters = currentMeter || currentFrom || currentTo;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-64">
        <Select
          label="Filter by Meter"
          placeholder="All meters"
          options={[
            { value: '', label: 'All meters' },
            ...meters.map((m) => ({
              value: m.id,
              label: m.name,
              group: m.type === 'main' ? 'Main Meters' : 'Submeters',
            })),
          ]}
          value={currentMeter || ''}
          onChange={(e) => updateFilter('meter', e.target.value)}
        />
      </div>
      <div className="w-44">
        <Input
          label="From Date"
          type="date"
          value={currentFrom || ''}
          onChange={(e) => updateFilter('from', e.target.value)}
        />
      </div>
      <div className="w-44">
        <Input
          label="To Date"
          type="date"
          value={currentTo || ''}
          onChange={(e) => updateFilter('to', e.target.value)}
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
