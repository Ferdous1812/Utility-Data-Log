import React from 'react';
import { getReadingsHistory, getMeters, getMeterSections, getCurrentProfile } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { fetchSplitMeters, expandSplitMeters, getBranchReadingsHistory } from '@/lib/branchMeters';
import { HistoryTable } from './HistoryTable';
import { HistoryExportButton } from './HistoryExportButton';

export const dynamic = 'force-dynamic';

interface HistoryPageProps {
  searchParams: Promise<{
    tab?: string;
    meters?: string;
    from?: string;
    to?: string;
  }>;
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const params = await searchParams;
  const meterIds = params.meters ? params.meters.split(',').filter(Boolean) : [];

  const supabase = await createClient();

  const [legacyReadings, baseMeters, sections, profile, hourMetersRes, splitMeters] = await Promise.all([
    getReadingsHistory({
      meterIds,
      dateFrom: params.from,
      dateTo: params.to,
    }),
    getMeters(),
    getMeterSections(),
    getCurrentProfile(),
    supabase.from('hour_meters').select('id, equipment_group, category').eq('is_active', true),
    fetchSplitMeters(supabase),
  ]);

  // Split meters (e.g. REB) are listed as one meter per branch: "REB — Peak", "REB — Off-Peak"
  const meters = expandSplitMeters(baseMeters, splitMeters);
  const splitIds = new Set(splitMeters.map((s) => s.id));
  const branchReadings = await getBranchReadingsHistory(supabase, splitMeters, meters, {
    meterIds,
    dateFrom: params.from,
    dateTo: params.to,
  });
  // A reading can exist both in the legacy `readings` table and in the branch logs
  // (copied earlier with the same id). Branch logs win, so every reading shows once.
  const branchIds = new Set(branchReadings.map((r) => r.id));
  const seenIds = new Set<string>();
  const readings = [
    ...legacyReadings.filter((r) => !splitIds.has(r.meter_id) && !branchIds.has(r.id)),
    ...branchReadings,
  ]
    .filter((r) => {
      if (seenIds.has(r.id)) return false;
      seenIds.add(r.id);
      return true;
    })
    .sort(
      (a, b) =>
        b.reading_date.localeCompare(a.reading_date) ||
        (b.created_at || '').localeCompare(a.created_at || '')
    )
    .slice(0, 500) as typeof legacyReadings;

  // Enrich meters and reading.meter with equipment_group from hour_meters
  // so that getHourGroupKey() can correctly classify compressor / pump / generator.
  const hourMap = new Map<string, { equipment_group?: string; category?: string }>();
  ((hourMetersRes.data || []) as any[]).forEach((hm: any) => {
    hourMap.set(hm.id, { equipment_group: hm.equipment_group, category: hm.category });
  });

  const enrichedMeters = meters.map((m) => {
    const hm = hourMap.get(m.id);
    return hm ? { ...m, equipment_group: hm.equipment_group, category: hm.category || (m as any).category } : m;
  });

  const enrichedReadings = readings.map((r) => {
    const hm = hourMap.get(r.meter?.id);
    return hm && r.meter
      ? { ...r, meter: { ...r.meter, equipment_group: hm.equipment_group, category: hm.category || (r.meter as any).category } }
      : r;
  });

  const userRole = profile?.role || 'operator';
  const distinctMetersCount = new Set(readings.map((r) => r.meter_id)).size;

  return (
    <div className="max-w-7xl mx-auto space-y-4 animate-fade-in">
      {/* Page Header with Export */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-border/40">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary">Logbook History</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Complete historical log entries with difference &amp; consumption tracking
          </p>
        </div>
        <div className="flex items-center gap-2">
          <HistoryExportButton readings={enrichedReadings} sections={sections} />
        </div>
      </div>

      {/* History Table with Section Tabs & Tab-Scoped Meter Filters */}
      <HistoryTable
        readings={enrichedReadings}
        userRole={userRole}
        sections={sections}
        meters={enrichedMeters}
        currentMeterIds={meterIds}
        currentFrom={params.from}
        currentTo={params.to}
        initialTab={params.tab}
      />

      {readings.length > 0 && (
        <div className="flex items-center justify-between px-1 text-xs text-text-muted">
          <span>
            Showing {readings.length} reading{readings.length !== 1 ? 's' : ''} across {distinctMetersCount} meter{distinctMetersCount !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  );
}