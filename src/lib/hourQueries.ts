import { createClient } from '@/lib/supabase/server';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import type { HourMeter, HourMeterDevice, HourReadingLog } from '@/types/hour';

// ─── Available Meter Type for Management ─────────────────────

export interface AvailableMeterForHour {
  id: string;
  name: string;
  location: string;
  type: string;
  section_id: string | null;
  section_name: string;
  section_unit: string;
  is_in_system: boolean;
}

// ─── Get All Hour Meters ────────────────────────────────────

export async function getHourMeters(): Promise<HourMeter[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('hour_meters')
    .select(`
      *,
      devices:hour_meter_devices(*)
    `)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    // If table doesn't exist yet, log warning and return empty
    if (error.code === '42P01' || error.message.includes('schema cache')) {
      console.warn('hour_meters table not found. Please run hour_and_gas_meters.sql migration.');
    } else {
      console.error('Error fetching hour meters:', error);
    }
    return [];
  }

  // Ensure every hour meter has at least one billing primary device reference
  const meters = (data || []) as HourMeter[];
  return meters.map((m) => {
    const devices = m.devices || [];
    if (devices.length === 0) {
      return {
        ...m,
        devices: [
          {
            id: m.id,
            meter_id: m.id,
            checkpoint_label: 'Primary Meter',
            serial_number: '',
            is_billing_primary: true,
            sort_order: 0,
            created_at: m.created_at,
          },
        ],
      };
    }
    return m;
  });
}

// ─── Get All Hour Meter Devices ─────────────────────────────

export async function getHourMeterDevices(): Promise<HourMeterDevice[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('hour_meter_devices')
    .select(`
      *,
      meter:hour_meters(*)
    `)
    .order('sort_order', { ascending: true });

  if (error) {
    return [];
  }

  return (data || []) as HourMeterDevice[];
}

// ─── Get Hour Reading Logs ──────────────────────────────────

export async function getHourReadingLogs(filters?: {
  month?: string;
}): Promise<HourReadingLog[]> {
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
    fromDate = format(startOfMonth(now), 'yyyy-MM-dd');
    toDate = format(endOfMonth(now), 'yyyy-MM-dd');
  }

  // 1. Fetch from hour_reading_logs
  const { data, error } = await supabase
    .from('hour_reading_logs')
    .select(`
      *,
      device:hour_meter_devices(
        *,
        meter:hour_meters(*)
      ),
      operator:profiles(id, full_name)
    `)
    .gte('reading_date', fromDate)
    .lte('reading_date', toDate)
    .order('reading_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(2000);

  const logs = (!error && data ? (data as HourReadingLog[]) : []);

  // 2. Also check readings table as fallback for any hour meters without logs in hour_reading_logs
  const { data: hourMeters } = await supabase
    .from('hour_meters')
    .select('id, name, equipment_group, category, multiplication_factor, sort_order, is_active, created_at, devices:hour_meter_devices(*)')
    .eq('is_active', true);

  if (hourMeters && hourMeters.length > 0) {
    const hourMeterIds = hourMeters.map((m) => m.id);
    const existingMeterIdsWithLogs = new Set(
      logs.map((l) => l.device?.meter?.id || l.device?.meter_id).filter(Boolean)
    );

    const missingMeterIds = hourMeterIds.filter((id) => !existingMeterIdsWithLogs.has(id));

    if (missingMeterIds.length > 0) {
      const { data: legacyReadings } = await supabase
        .from('readings')
        .select(`
          id,
          meter_id,
          reading_value,
          reading_date,
          usage,
          created_at,
          logged_by,
          profile:profiles(id, full_name)
        `)
        .in('meter_id', missingMeterIds)
        .gte('reading_date', fromDate)
        .lte('reading_date', toDate)
        .order('reading_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (legacyReadings && legacyReadings.length > 0) {
        const hourMeterMap = new Map(hourMeters.map((m) => [m.id, m]));
        for (const lr of legacyReadings) {
          const hm = hourMeterMap.get(lr.meter_id);
          const primaryDev = hm?.devices?.find((d) => d.is_billing_primary) || hm?.devices?.[0];
          const devId = primaryDev?.id || lr.meter_id;

          logs.push({
            id: lr.id,
            device_id: devId,
            reading_value: Number(lr.reading_value),
            reading_date: lr.reading_date,
            usage: lr.usage != null ? Number(lr.usage) : null,
            operator_id: lr.logged_by,
            created_at: lr.created_at,
            operator: lr.profile as any,
            device: {
              id: devId,
              meter_id: lr.meter_id,
              checkpoint_label: primaryDev?.checkpoint_label || 'Primary Meter',
              serial_number: primaryDev?.serial_number || '',
              is_billing_primary: true,
              sort_order: 0,
              created_at: lr.created_at,
              meter: hm as any,
            },
          });
        }
      }
    }
  }

  logs.sort((a, b) => {
    const dateCmp = b.reading_date.localeCompare(a.reading_date);
    if (dateCmp !== 0) return dateCmp;
    return (b.created_at || '').localeCompare(a.created_at || '');
  });

  return logs;
}

// ─── Get Prior Hour Readings ────────────────────────────────

export async function getPriorHourReadings(
  dateTo: string
): Promise<Record<string, HourReadingLog>> {
  const supabase = await createClient();

  // 1. Fetch from hour_reading_logs
  const { data, error } = await supabase
    .from('hour_reading_logs')
    .select('*')
    .lte('reading_date', dateTo)
    .order('reading_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1000);

  const map: Record<string, HourReadingLog> = {};
  if (!error && data) {
    (data || []).forEach((log) => {
      const r = log as HourReadingLog;
      if (!map[r.device_id]) {
        map[r.device_id] = r;
      }
    });
  }

  // 2. Check readings table as fallback for any hour meters missing prior readings
  const { data: hourMeters } = await supabase
    .from('hour_meters')
    .select('id, name, equipment_group, category, multiplication_factor, sort_order, is_active, created_at, devices:hour_meter_devices(*)')
    .eq('is_active', true);

  if (hourMeters && hourMeters.length > 0) {
    const hourMeterMap = new Map(hourMeters.map((m) => [m.id, m]));
    const meterIdsNeedingPrior: string[] = [];

    for (const hm of hourMeters) {
      const primaryDev = hm.devices?.find((d) => d.is_billing_primary) || hm.devices?.[0];
      const devId = primaryDev?.id || hm.id;
      if (!map[devId] && !map[hm.id]) {
        meterIdsNeedingPrior.push(hm.id);
      }
    }

    if (meterIdsNeedingPrior.length > 0) {
      const { data: legacyPrior } = await supabase
        .from('readings')
        .select(`
          id,
          meter_id,
          reading_value,
          reading_date,
          usage,
          created_at,
          logged_by
        `)
        .in('meter_id', meterIdsNeedingPrior)
        .lte('reading_date', dateTo)
        .order('reading_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (legacyPrior && legacyPrior.length > 0) {
        for (const lr of legacyPrior) {
          const hm = hourMeterMap.get(lr.meter_id);
          const primaryDev = hm?.devices?.find((d) => d.is_billing_primary) || hm?.devices?.[0];
          const devId = primaryDev?.id || lr.meter_id;

          if (!map[devId] && !map[lr.meter_id]) {
            const mappedLog: HourReadingLog = {
              id: lr.id,
              device_id: devId,
              reading_value: Number(lr.reading_value),
              reading_date: lr.reading_date,
              usage: lr.usage != null ? Number(lr.usage) : null,
              operator_id: lr.logged_by,
              created_at: lr.created_at,
              device: {
                id: devId,
                meter_id: lr.meter_id,
                checkpoint_label: primaryDev?.checkpoint_label || 'Primary Meter',
                serial_number: primaryDev?.serial_number || '',
                is_billing_primary: true,
                sort_order: 0,
                created_at: lr.created_at,
                meter: hm as any,
              },
            };
            map[devId] = mappedLog;
            map[lr.meter_id] = mappedLog;
          }
        }
      }
    }

    // Populate both device_id and meter.id in map so either lookup succeeds
    for (const hm of hourMeters) {
      const primaryDev = hm.devices?.find((d) => d.is_billing_primary) || hm.devices?.[0];
      const devId = primaryDev?.id || hm.id;
      if (map[devId] && !map[hm.id]) {
        map[hm.id] = map[devId];
      } else if (map[hm.id] && !map[devId]) {
        map[devId] = map[hm.id];
      }
    }
  }

  return map;
}

// ─── Get Available Meters for Hour System ───────────────────

export async function getAvailableMetersForHour(): Promise<AvailableMeterForHour[]> {
  const supabase = await createClient();

  const [metersRes, hourMetersRes, sectionsRes] = await Promise.all([
    supabase
      .from('meters')
      .select('id, name, location, type, section_id')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('hour_meters')
      .select('id, is_active'),
    supabase
      .from('meter_sections')
      .select('id, name, unit'),
  ]);

  const activeHourSet = new Set(
    (hourMetersRes.data || []).filter((em) => em.is_active).map((em) => em.id)
  );

  const sectionMap = new Map(
    (sectionsRes.data || []).map((s) => [s.id, { name: s.name, unit: s.unit }])
  );

  // Filter to meters with hrs unit or hour in section name
  return (metersRes.data || [])
    .filter((m) => {
      if (!m.section_id) return false;
      const sec = sectionMap.get(m.section_id);
      if (!sec) return false;
      const u = (sec.unit || '').trim().toLowerCase();
      const n = (sec.name || '').trim().toLowerCase();
      return u === 'hrs' || u === 'hr' || u === 'hours' || n.includes('hour');
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
        section_unit: sec?.unit || 'hrs',
        is_in_system: activeHourSet.has(m.id),
      };
    });
}
