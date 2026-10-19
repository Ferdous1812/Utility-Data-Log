import { createClient } from '@/lib/supabase/server';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import type { GasMeter, GasMeterDevice, GasReadingLog } from '@/types/gas';

// ─── Available Meter Type for Management ─────────────────────

export interface AvailableMeterForGas {
  id: string;
  name: string;
  location: string;
  type: string;
  section_id: string | null;
  section_name: string;
  section_unit: string;
  is_in_system: boolean;
}

// ─── Get All Gas Meters ─────────────────────────────────────

export async function getGasMeters(): Promise<GasMeter[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('gas_meters')
    .select(`
      *,
      devices:gas_meter_devices(*)
    `)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    if (error.code === '42P01' || error.message.includes('schema cache')) {
      console.warn('gas_meters table not found. Please run hour_and_gas_meters.sql migration.');
    } else {
      console.error('Error fetching gas meters:', error);
    }
    return [];
  }

  // Ensure every gas meter has at least one billing primary device reference
  const meters = (data || []) as GasMeter[];
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

// ─── Get All Gas Meter Devices ──────────────────────────────

export async function getGasMeterDevices(): Promise<GasMeterDevice[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('gas_meter_devices')
    .select(`
      *,
      meter:gas_meters(*)
    `)
    .order('sort_order', { ascending: true });

  if (error) {
    return [];
  }

  return (data || []) as GasMeterDevice[];
}

// ─── Get Gas Reading Logs ───────────────────────────────────

export async function getGasReadingLogs(filters?: {
  month?: string;
}): Promise<GasReadingLog[]> {
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

  // 1. Fetch from gas_reading_logs
  const { data, error } = await supabase
    .from('gas_reading_logs')
    .select(`
      *,
      device:gas_meter_devices(
        *,
        meter:gas_meters(*)
      ),
      operator:profiles(id, full_name)
    `)
    .gte('reading_date', fromDate)
    .lte('reading_date', toDate)
    .order('reading_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(2000);

  const logs = (!error && data ? (data as GasReadingLog[]) : []);

  // 2. Also check readings table as fallback for any gas meters without logs in gas_reading_logs
  const { data: gasMeters } = await supabase
    .from('gas_meters')
    .select('id, name, section, category, multiplication_factor, is_primary_for_total, sort_order, is_active, created_at, devices:gas_meter_devices(*)')
    .eq('is_active', true);

  if (gasMeters && gasMeters.length > 0) {
    const gasMeterIds = gasMeters.map((m) => m.id);
    const existingMeterIdsWithLogs = new Set(
      logs.map((l) => l.device?.meter?.id || l.device?.meter_id).filter(Boolean)
    );

    const missingMeterIds = gasMeterIds.filter((id) => !existingMeterIdsWithLogs.has(id));

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
        const gasMeterMap = new Map(gasMeters.map((m) => [m.id, m]));
        for (const lr of legacyReadings) {
          const gm = gasMeterMap.get(lr.meter_id);
          const primaryDev = gm?.devices?.find((d) => d.is_billing_primary) || gm?.devices?.[0];
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
              meter: gm as any,
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

// ─── Get Prior Gas Readings ─────────────────────────────────

export async function getPriorGasReadings(
  dateTo: string
): Promise<Record<string, GasReadingLog>> {
  const supabase = await createClient();

  // 1. Fetch from gas_reading_logs
  const { data, error } = await supabase
    .from('gas_reading_logs')
    .select('*')
    .lte('reading_date', dateTo)
    .order('reading_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1000);

  const map: Record<string, GasReadingLog> = {};
  if (!error && data) {
    (data || []).forEach((log) => {
      const r = log as GasReadingLog;
      if (!map[r.device_id]) {
        map[r.device_id] = r;
      }
    });
  }

  // 2. Check readings table as fallback for any gas meters missing prior readings
  const { data: gasMeters } = await supabase
    .from('gas_meters')
    .select('id, name, section, category, multiplication_factor, is_primary_for_total, sort_order, is_active, created_at, devices:gas_meter_devices(*)')
    .eq('is_active', true);

  if (gasMeters && gasMeters.length > 0) {
    const gasMeterMap = new Map(gasMeters.map((m) => [m.id, m]));
    const meterIdsNeedingPrior: string[] = [];

    for (const gm of gasMeters) {
      const primaryDev = gm.devices?.find((d) => d.is_billing_primary) || gm.devices?.[0];
      const devId = primaryDev?.id || gm.id;
      if (!map[devId] && !map[gm.id]) {
        meterIdsNeedingPrior.push(gm.id);
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
          const gm = gasMeterMap.get(lr.meter_id);
          const primaryDev = gm?.devices?.find((d) => d.is_billing_primary) || gm?.devices?.[0];
          const devId = primaryDev?.id || lr.meter_id;

          if (!map[devId] && !map[lr.meter_id]) {
            const mappedLog: GasReadingLog = {
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
                meter: gm as any,
              },
            };
            map[devId] = mappedLog;
            map[lr.meter_id] = mappedLog;
          }
        }
      }
    }

    // Populate both device_id and meter.id in map so either lookup succeeds
    for (const gm of gasMeters) {
      const primaryDev = gm.devices?.find((d) => d.is_billing_primary) || gm.devices?.[0];
      const devId = primaryDev?.id || gm.id;
      if (map[devId] && !map[gm.id]) {
        map[gm.id] = map[devId];
      } else if (map[gm.id] && !map[devId]) {
        map[devId] = map[gm.id];
      }
    }
  }

  return map;
}

// ─── Get Available Meters for Gas System ────────────────────

export async function getAvailableMetersForGas(): Promise<AvailableMeterForGas[]> {
  const supabase = await createClient();

  const [metersRes, gasMetersRes, sectionsRes] = await Promise.all([
    supabase
      .from('meters')
      .select('id, name, location, type, section_id')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('gas_meters')
      .select('id, is_active'),
    supabase
      .from('meter_sections')
      .select('id, name, unit'),
  ]);

  const activeGasSet = new Set(
    (gasMetersRes.data || []).filter((em) => em.is_active).map((em) => em.id)
  );

  const sectionMap = new Map(
    (sectionsRes.data || []).map((s) => [s.id, { name: s.name, unit: s.unit }])
  );

  // Filter to meters with m³ unit or gas in section name
  return (metersRes.data || [])
    .filter((m) => {
      if (!m.section_id) return false;
      const sec = sectionMap.get(m.section_id);
      if (!sec) return false;
      const u = (sec.unit || '').trim().toLowerCase();
      const n = (sec.name || '').trim().toLowerCase();
      return u === 'm³' || u === 'm3' || u === 'cu.m' || n.includes('gas');
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
        section_unit: sec?.unit || 'm³',
        is_in_system: activeGasSet.has(m.id),
      };
    });
}
