import React from 'react';
import { getReadingsHistory, getMeters, getCurrentProfile } from '@/lib/queries';
import { Card } from '@/components/ui/Card';
import { HistoryFilters } from './HistoryFilters';
import { HistoryTable } from './HistoryTable';

export const dynamic = 'force-dynamic';

interface HistoryPageProps {
  searchParams: Promise<{
    meter?: string;
    from?: string;
    to?: string;
  }>;
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const params = await searchParams;
  const [readings, meters, profile] = await Promise.all([
    getReadingsHistory({
      meterId: params.meter,
      dateFrom: params.from,
      dateTo: params.to,
    }),
    getMeters(),
    getCurrentProfile(),
  ]);

  const userRole = profile?.role || 'operator';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Logbook History</h1>
        <p className="text-sm text-text-secondary mt-1">
          Complete history of all meter readings with usage calculations
        </p>
      </div>

      {/* Filters */}
      <HistoryFilters
        meters={meters}
        currentMeter={params.meter}
        currentFrom={params.from}
        currentTo={params.to}
      />

      {/* Data Table with Admin Edit & Delete actions */}
      <Card className="p-0 overflow-hidden">
        <HistoryTable readings={readings} userRole={userRole} />

        {readings.length > 0 && (
          <div className="px-4 py-3 border-t border-border bg-bg-elevated">
            <span className="text-xs text-text-muted">
              Showing {readings.length} reading{readings.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}
