import { createClient } from '@/lib/supabase/server';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import type {
  EnergyMeter,
  EnergyMeterDevice,
  EnergyReadingLog,
} from '@/types/energy';

// ─── Get All Energy Meters (with devices) ───────────────────

export async function getEnergyMeters(): Promise<EnergyMeter[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('energy_meters')
    .select(`
      *,
      devices:energy_meter_devices(*)
    `)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    console.error('Error fetching energy meters:', error);
    return [];
  }

  return (data || []) as EnergyMeter[];
}

// ─── Get All Energy Meter Devices ───────────────────────────

export async function getEnergyMeterDevices(): Promise<EnergyMeterDevice[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('energy_meter_devices')
    .select(`
      *,
      meter:energy_meters(*)
    `)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('Error fetching energy meter devices:', error);
    return [];
  }

  return (data || []) as EnergyMeterDevice[];
}

// ─── Get Energy Reading Logs (month or custom date range) ───

export async function getEnergyReadingLogs(filters?: {
  deviceId?: string;
  meterId?: string;
  dateFrom?: string;
  dateTo?: string;
  month?: string; // e.g. '2026-10'
}): Promise<EnergyReadingLog[]> {
  const supabase = await createClient();
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
    fromDate = filters?.dateFrom || format(startOfMonth(now), 'yyyy-MM-dd');
    toDate = filters?.dateTo || format(endOfMonth(now), 'yyyy-MM-dd');
  }

  let query = supabase
    .from('energy_reading_logs')
    .select(`
      *,
      device:energy_meter_devices(
        *,
        meter:energy_meters(*)
      ),
      operator:profiles(id, full_name)
    `)
    .gte('reading_date', fromDate)
    .lte('reading_date', toDate)
    .order('reading_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(2000);

  if (filters?.deviceId) {
    query = query.eq('device_id', filters.deviceId);
  }

  if (filters?.meterId) {
    const { data: meterDevices } = await supabase
      .from('energy_meter_devices')
      .select('id')
      .eq('meter_id', filters.meterId);

    const deviceIds = (meterDevices || []).map((d) => d.id as string);
    if (deviceIds.length > 0) {
      query = query.in('device_id', deviceIds);
    } else {
      return [];
    }
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching energy reading logs:', error);
    return [];
  }

  return (data || []) as EnergyReadingLog[];
}

// ─── Get Latest Reading Per Device ──────────────────────────

export async function getLatestReadingsPerDevice(
  dateTo?: string
): Promise<Record<string, EnergyReadingLog>> {
  const supabase = await createClient();

  let query = supabase
    .from('energy_reading_logs')
    .select('*')
    .order('reading_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (dateTo) {
    query = query.lte('reading_date', dateTo);
  }

  const { data, error } = await query.limit(1000);

  if (error) {
    console.error('Error fetching latest readings:', error);
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

// ─── Get Available Meters (for Manage Meters modal) ─────────

export interface AvailableMeter {
  id: string;
  name: string;
  location: string;
  type: string;
  section_id: string | null;
  section_name: string;
  section_unit: string;
  is_in_energy_meters: boolean;
}

export async function getAvailableMetersForEnergy(): Promise<AvailableMeter[]> {
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

  // Gas (m³ / "gas") and Hour (hr / "hour") sections are managed on their own pages
  const isGasOrHourSection = (secName?: string | null, secUnit?: string | null) => {
    const u = (secUnit || '').trim().toLowerCase();
    const n = (secName || '').toLowerCase();
    return u.includes('m³') || u.includes('m3') || n.includes('gas') || u.includes('hr') || n.includes('hour');
  };

  return (metersRes.data || [])
    .filter((m) => {
      const sec = m.section_id ? sectionMap.get(m.section_id) : null;
      return !isGasOrHourSection(sec?.name, sec?.unit);
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