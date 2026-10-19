import { createClient } from '@/lib/supabase/server';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import type {
  EnergyMeter,
  EnergyMeterDevice,
  EnergyReadingLog,
} from '@/types/energy';

// ─── Types ──────────────────────────────────────────────────

export type MeterUnit = 'kWh' | 'hrs' | 'm³';

export interface AvailableMeterForUnit {
  id: string;
  name: string;
  location: string;
  type: string;
  section_id: string | null;
  section_name: string;
  section_unit: string;
  is_in_energy_meters: boolean;
}

// ─── Helpers ────────────────────────────────────────────────

export function matchesUnit(sectionName: string | null | undefined, sectionUnit: string | null | undefined, unit: MeterUnit): boolean {
  const sUnit = (sectionUnit || '').trim().toLowerCase();
  const sName = (sectionName || '').trim().toLowerCase();

  if (unit === 'hrs') {
    return (
      sUnit === 'hrs' ||
      sUnit === 'hr' ||
      sUnit === 'hours' ||
      sUnit === 'hour' ||
      sUnit === 'h' ||
      sName.includes('hour')
    );
  }
  if (unit === 'm³') {
    return (
      sUnit === 'm³' ||
      sUnit === 'm3' ||
      sUnit === 'cu.m' ||
      sUnit === 'm^3' ||
      sName.includes('gas')
    );
  }
  if (unit === 'kWh') {
    return (
      sUnit === 'kwh' ||
      sUnit === 'kw' ||
      sName.includes('energy') ||
      sName.includes('power')
    );
  }
  return false;
}

// ─── Get Meters Filtered by Section Unit ────────────────────

async function getMeterIdsForUnit(unit: MeterUnit): Promise<string[]> {
  const supabase = await createClient();

  // 1. Get section IDs that match the unit
  const { data: sections } = await supabase
    .from('meter_sections')
    .select('id, name, unit');

  if (!sections || sections.length === 0) return [];

  const matchedSectionIds = sections
    .filter((s) => matchesUnit(s.name, s.unit, unit))
    .map((s) => s.id);

  if (matchedSectionIds.length === 0) return [];

  // 2. Get base meter IDs from those sections
  const { data: baseMeters } = await supabase
    .from('meters')
    .select('id')
    .in('section_id', matchedSectionIds)
    .eq('is_active', true);

  return (baseMeters || []).map((m) => m.id);
}

export async function getMetersForUnit(unit: MeterUnit): Promise<EnergyMeter[]> {
  const supabase = await createClient();
  const meterIds = await getMeterIdsForUnit(unit);
  if (meterIds.length === 0) return [];

  const { data, error } = await supabase
    .from('energy_meters')
    .select(`
      *,
      devices:energy_meter_devices(*)
    `)
    .eq('is_active', true)
    .in('id', meterIds)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    console.error(`Error fetching ${unit} meters:`, error);
    return [];
  }

  return (data || []) as EnergyMeter[];
}

export async function getDevicesForUnit(unit: MeterUnit): Promise<EnergyMeterDevice[]> {
  const supabase = await createClient();
  const meterIds = await getMeterIdsForUnit(unit);
  if (meterIds.length === 0) return [];

  const { data, error } = await supabase
    .from('energy_meter_devices')
    .select(`
      *,
      meter:energy_meters(*)
    `)
    .in('meter_id', meterIds)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error(`Error fetching ${unit} devices:`, error);
    return [];
  }

  return (data || []) as EnergyMeterDevice[];
}

export async function getReadingLogsForUnit(
  unit: MeterUnit,
  filters?: { month?: string }
): Promise<EnergyReadingLog[]> {
  const supabase = await createClient();
  const meterIds = await getMeterIdsForUnit(unit);
  if (meterIds.length === 0) return [];

  // Get device IDs for these meters
  const { data: devicesData } = await supabase
    .from('energy_meter_devices')
    .select('id')
    .in('meter_id', meterIds);

  const deviceIds = (devicesData || []).map((d) => d.id);
  if (deviceIds.length === 0) return [];

  let fromDate: string;
  let toDate: string;

  if (filters?.month && filters.month.includes('-')) {
    const [y, m] = filters.month.split('-');
    const year = parseInt(y, 10);
    const monthIndex = parseInt(m, 10) - 1;
    const targetDate = new Date(year, monthIndex, 1);
    fromDate = format(startOfMonth(targetDate), 'yyyy-MM-dd');
    toDate = format(endOfMonth(targetDate), 'yyyy-MM-dd');
  } else {
    const now = new Date();
    fromDate = format(startOfMonth(now), 'yyyy-MM-dd');
    toDate = format(endOfMonth(now), 'yyyy-MM-dd');
  }

  const { data, error } = await supabase
    .from('energy_reading_logs')
    .select(`
      *,
      device:energy_meter_devices(
        *,
        meter:energy_meters(*)
      ),
      operator:profiles(id, full_name)
    `)
    .in('device_id', deviceIds)
    .gte('reading_date', fromDate)
    .lte('reading_date', toDate)
    .order('reading_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(2000);

  if (error) {
    console.error(`Error fetching ${unit} reading logs:`, error);
    return [];
  }

  return (data || []) as EnergyReadingLog[];
}

export async function getPriorReadingsForUnit(
  unit: MeterUnit,
  dateTo: string
): Promise<Record<string, EnergyReadingLog>> {
  const supabase = await createClient();
  const meterIds = await getMeterIdsForUnit(unit);
  if (meterIds.length === 0) return {};

  const { data: devicesData } = await supabase
    .from('energy_meter_devices')
    .select('id')
    .in('meter_id', meterIds);

  const deviceIds = (devicesData || []).map((d) => d.id);
  if (deviceIds.length === 0) return {};

  const { data, error } = await supabase
    .from('energy_reading_logs')
    .select('*')
    .in('device_id', deviceIds)
    .lte('reading_date', dateTo)
    .order('reading_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) {
    console.error(`Error fetching prior ${unit} readings:`, error);
    return {};
  }

  const map: Record<string, EnergyReadingLog> = {};
  (data || []).forEach((log) => {
    const r = log as EnergyReadingLog;
    if (!map[r.device_id]) {
      map[r.device_id] = r;
    }
  });

  return map;
}

export async function getAvailableMetersForUnit(unit: MeterUnit): Promise<AvailableMeterForUnit[]> {
  const supabase = await createClient();

  const [metersRes, energyMetersRes, sectionsRes] = await Promise.all([
    supabase
      .from('meters')
      .select('id, name, location, type, section_id')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('energy_meters')
      .select('id, is_active'),
    supabase
      .from('meter_sections')
      .select('id, name, unit'),
  ]);

  const activeEnergySet = new Set(
    (energyMetersRes.data || []).filter((em) => em.is_active).map((em) => em.id)
  );

  const sectionMap = new Map(
    (sectionsRes.data || []).map((s) => [s.id, { name: s.name, unit: s.unit }])
  );

  return (metersRes.data || [])
    .filter((m) => {
      if (!m.section_id) return false;
      const sec = sectionMap.get(m.section_id);
      if (!sec) return false;
      return matchesUnit(sec.name, sec.unit, unit);
    })
    .map((m) => {
      const sec = m.section_id ? sectionMap.get(m.section_id) : null;
      return {
        id: m.id,
        name: m.name,
        location: m.location || '',
        type: m.type,
        section_id: m.section_id || null,
        section_name: sec?.name || 'Uncategorized',
        section_unit: sec?.unit || '',
        is_in_energy_meters: activeEnergySet.has(m.id),
      };
    });
}
