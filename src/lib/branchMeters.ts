// Helpers for split (Peak / Off-Peak) energy meters.
// On the Log Reading page and the Logbook History each branch is shown as its own meter.

import type { Meter } from '@/lib/types';

export interface SplitMeterInfo {
  id: string;
  devices: { id: string; checkpoint_label: string; sort_order: number }[];
}

/** Active energy meters that are in split mode, with their branch devices. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchSplitMeters(supabase: any): Promise<SplitMeterInfo[]> {
  const { data, error } = await supabase
    .from('energy_meters')
    .select('id, devices:energy_meter_devices(id, checkpoint_label, sort_order)')
    .eq('is_active', true)
    .eq('reading_mode', 'split');
  if (error || !data) return []; // e.g. migration not applied yet
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((m) => ({
    id: m.id,
    devices: [...(m.devices || [])].sort((a: any, b: any) => a.sort_order - b.sort_order),
  }));
}

/**
 * Replace each split meter with one virtual meter per branch, e.g. "REB — Peak" / "REB — Off-Peak".
 * The virtual meter's id is the branch device id; `_branch` marks it.
 */
export function expandSplitMeters<T extends Meter>(meters: T[], split: SplitMeterInfo[]): T[] {
  const byId = new Map(split.map((s) => [s.id, s]));
  return meters.flatMap((m) => {
    const s = byId.get(m.id);
    if (!s || s.devices.length === 0) return [m];
    return s.devices.map(
      (d) =>
        ({
          ...m,
          id: d.id,
          name: `${m.name} — ${d.checkpoint_label}`,
          _branch: true,
          _parentMeterId: m.id,
        }) as unknown as T
    );
  });
}

/** Reading-log rows of all branch devices, shaped like `readings` rows for the Logbook table. */
export async function getBranchReadingsHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  split: SplitMeterInfo[],
  virtualMeters: Meter[],
  filters: { meterIds?: string[]; dateFrom?: string; dateTo?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  let deviceIds = split.flatMap((s) => s.devices.map((d) => d.id));
  if (filters.meterIds && filters.meterIds.length > 0) {
    deviceIds = deviceIds.filter((id) => filters.meterIds!.includes(id));
  }
  if (deviceIds.length === 0) return [];

  let query = supabase
    .from('energy_reading_logs')
    .select('*, operator:profiles(id, full_name)')
    .in('device_id', deviceIds)
    .order('reading_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500);
  if (filters.dateFrom) query = query.gte('reading_date', filters.dateFrom);
  if (filters.dateTo) query = query.lte('reading_date', filters.dateTo);

  const { data, error } = await query;
  if (error || !data) return [];

  const meterById = new Map(virtualMeters.map((m) => [m.id, m]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((r) => ({
    id: r.id,
    meter_id: r.device_id,
    reading_value: Number(r.reading_value),
    reading_date: r.reading_date,
    usage: r.usage != null ? Number(r.usage) : null,
    is_reset: r.is_reset ?? false,
    logged_by: r.operator_id,
    created_at: r.created_at,
    meter: meterById.get(r.device_id),
    profile: r.operator,
    _branch: true,
  }));
}
