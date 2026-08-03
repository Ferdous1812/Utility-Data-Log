import React from 'react';
import { getReadingsHistory, getMeters, getMeterSections, getCurrentProfile } from '@/lib/queries';
import { HistoryFilters } from './HistoryFilters';
import { HistoryTable } from './HistoryTable';
import { HistoryExportButton } from './HistoryExportButton';

export const dynamic = 'force-dynamic';

interface HistoryPageProps {
  searchParams: Promise<{
    meters?: string;
    sections?: string;
    from?: string;
    to?: string;
  }>;
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const params = await searchParams;
  const meterIds = params.meters ? params.meters.split(',').filter(Boolean) : [];
  const sectionIds = params.sections ? params.sections.split(',').filter(Boolean) : [];

  const [readings, meters, sections, profile] = await Promise.all([
    getReadingsHistory({
      meterIds,
      sectionIds,
      dateFrom: params.from,
      dateTo: params.to,
    }),
    getMeters(),
    getMeterSections(),
    getCurrentProfile(),
  ]);

  const userRole = profile?.role || 'operator';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Logbook History</h1>
          <p className="text-sm text-text-secondary mt-1">
            Complete history of all meter readings with usage calculations
          </p>
        </div>
        <HistoryExportButton readings={readings} sections={sections} />
      </div>

      {/* Filters */}
      <HistoryFilters
        meters={meters}
        sections={sections}
        currentMeterIds={meterIds}
        currentSectionIds={sectionIds}
        currentFrom={params.from}
        currentTo={params.to}
      />

      {/* Data Tables — one per meter section, with Admin Edit & Delete actions */}
      <HistoryTable readings={readings} userRole={userRole} sections={sections} />

      {readings.length > 0 && (
        <div className="px-1">
          <span className="text-xs text-text-muted">
            Showing {readings.length} reading{readings.length !== 1 ? 's' : ''} total
          </span>
        </div>
      )}
    </div>
  );
}
