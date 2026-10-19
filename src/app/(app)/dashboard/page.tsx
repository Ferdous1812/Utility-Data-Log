'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, StatCard } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Tabs } from '@/components/ui/Tabs';
import type { MonthlyComparisonRow } from '@/components/charts/MonthlyComparisonChart';
import { FilterableChartCard } from '@/components/charts/FilterableMonthlyChart';
import { computeEnergyDashboardStats } from '@/lib/calculations/energy';
import type { EnergyMeter, EnergyMeterDevice, EnergyReadingLog } from '@/types/energy';
import { colorAt } from '@/lib/chartColors';
import { format, subMonths, endOfMonth, startOfMonth, subDays, addDays } from 'date-fns';
import type { Meter, MeterSection } from '@/lib/types';
import { useTierLabels, getEnergyGroupLabel, getGasGroupLabel, getHourGroupKey } from '@/lib/useTierLabels';

type ComparisonRange = 1 | 3 | 6 | 12;

interface ReadingLite {
  id: string;
  reading_value: number;
  reading_date: string;
  created_at: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Find the reading nearest to a target date (before or after, whichever is closer).
function findNearestReading(list: ReadingLite[] | undefined, targetDate: string): ReadingLite | null {
  if (!list || list.length === 0) return null;

  let before: ReadingLite | null = null;
  let after: ReadingLite | null = null;

  for (const r of list) {
    if (r.reading_date <= targetDate) {
      if (
        !before ||
        r.reading_date > before.reading_date ||
        (r.reading_date === before.reading_date && r.created_at > before.created_at)
      ) {
        before = r;
      }
    } else if (!after) {
      after = r;
    }
  }

  if (before && after) {
    const target = new Date(targetDate).getTime();
    const beforeDiff = target - new Date(before.reading_date).getTime();
    const afterDiff = new Date(after.reading_date).getTime() - target;
    return afterDiff < beforeDiff ? after : before;
  }

  return before || after;
}

export default function DashboardPage() {
  const supabase = createClient();
  const now = useMemo(() => new Date(), []);
  const tierLabels = useTierLabels();

  // Default reference month = the month before the current month.
  const defaultRef = useMemo(() => subMonths(now, 1), [now]);

  const [refMonth, setRefMonth] = useState(defaultRef.getMonth() + 1);
  const [refYear, setRefYear] = useState(defaultRef.getFullYear());
  const [comparisonRange, setComparisonRange] = useState<ComparisonRange>(1);

  const [meters, setMeters] = useState<Meter[]>([]);
  const [sections, setSections] = useState<MeterSection[]>([]);
  const [readingsByMeter, setReadingsByMeter] = useState<Map<string, ReadingLite[]>>(new Map());
  // Readings per branch device of split (Peak / Off-Peak) energy meters
  const [deviceReadings, setDeviceReadings] = useState<Map<string, ReadingLite[]>>(new Map());
  const [energyStatsData, setEnergyStatsData] = useState<{
    meters: EnergyMeter[];
    devices: EnergyMeterDevice[];
    logs: EnergyReadingLog[];
    prevLogs: EnergyReadingLog[];
  }>({ meters: [], devices: [], logs: [], prevLogs: [] });
  const [gasMeterIds, setGasMeterIds] = useState<Set<string>>(new Set());
  const [gasStatsData, setGasStatsData] = useState<{
    meters: EnergyMeter[];
    devices: EnergyMeterDevice[];
    logs: EnergyReadingLog[];
  }>({ meters: [], devices: [], logs: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'energy' | 'gas' | 'hour'>('energy');

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = now.getFullYear() - 3; y <= now.getFullYear() + 1; y++) years.push(y);
    return years;
  }, [now]);

  const refDate = useMemo(() => new Date(refYear, refMonth - 1, 1), [refYear, refMonth]);

  // Chronological list of months covered by the comparison range, ending at refDate.
  const monthsList = useMemo(() => {
    const arr: { key: string; label: string }[] = [];
    for (let i = comparisonRange - 1; i >= 0; i--) {
      const d = subMonths(refDate, i);
      arr.push({ key: format(d, 'yyyy-MM'), label: format(d, 'MMM yyyy') });
    }
    return arr;
  }, [refDate, comparisonRange]);

  // Month-end boundary dates: comparisonRange + 1 dates, used to compute
  // comparisonRange monthly differences (each month needs its own + prior month-end).
  const boundaries = useMemo(() => {
    const arr: string[] = [];
    for (let j = 0; j <= comparisonRange; j++) {
      const d = endOfMonth(subMonths(refDate, comparisonRange - j));
      arr.push(format(d, 'yyyy-MM-dd'));
    }
    return arr;
  }, [refDate, comparisonRange]);

  const fetchData = useCallback(async () => {
    setLoading(true);

    const [metersRes, sectionsRes, hourMetersRes] = await Promise.all([
      supabase
        .from('meters')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('type')
        .order('name'),
      supabase.from('meter_sections').select('*').order('sort_order', { ascending: true }),
      supabase.from('hour_meters').select('id, equipment_group, category').eq('is_active', true),
    ]);

    // Energy Meter page data source (same tables/logic as /energy-meters) for the top cards
    const refMonthStart = startOfMonth(refDate);
    const prevMonthStart = subMonths(refMonthStart, 1);
    const monthRange = (d: Date) => ({
      from: format(startOfMonth(d), 'yyyy-MM-dd'),
      to: format(endOfMonth(d), 'yyyy-MM-dd'),
    });
    const refRange = monthRange(refMonthStart);
    const prevRange = monthRange(prevMonthStart);

    const [energyMetersRes, energyLogsRes, energyPrevLogsRes, gasMetersRes, gasLogsRes] = await Promise.all([
      supabase
        .from('energy_meters')
        .select('*, devices:energy_meter_devices(*)')
        .eq('is_active', true),
      supabase
        .from('energy_reading_logs')
        .select('*')
        .gte('reading_date', refRange.from)
        .lte('reading_date', refRange.to)
        .limit(2000),
      supabase
        .from('energy_reading_logs')
        .select('*')
        .gte('reading_date', prevRange.from)
        .lte('reading_date', prevRange.to)
        .limit(2000),
      supabase
        .from('gas_meters')
        .select('*, devices:gas_meter_devices(*)')
        .eq('is_active', true),
      supabase
        .from('gas_reading_logs')
        .select('*, device:gas_meter_devices(id, meter_id)')
        .gte('reading_date', refRange.from)
        .lte('reading_date', refRange.to)
        .limit(2000),
    ]);

    const energyMetersList = (energyMetersRes.data || []) as EnergyMeter[];
    setEnergyStatsData({
      meters: energyMetersList,
      devices: energyMetersList.flatMap((m) => m.devices || []),
      logs: (energyLogsRes.data || []) as EnergyReadingLog[],
      prevLogs: (energyPrevLogsRes.data || []) as EnergyReadingLog[],
    });
    // Gas data: same sources/fallback as the Gas Meters page (gas_reading_logs,
    // falling back to the readings table for meters with no gas logs this month).
    const gasMetersList = ((gasMetersRes.data || []) as any[]).map((m) => {
      const devs = m.devices || [];
      return devs.length > 0
        ? m
        : {
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
    }) as EnergyMeter[];
    const gasLogs = ((gasLogsRes.data || []) as any[]) as EnergyReadingLog[];

    const gasMetersWithLogs = new Set(
      gasLogs.map((l: any) => l.device?.meter_id).filter(Boolean)
    );
    const gasMissingIds = gasMetersList.map((m) => m.id).filter((id) => !gasMetersWithLogs.has(id));
    if (gasMissingIds.length > 0) {
      const { data: legacyGas } = await supabase
        .from('readings')
        .select('id, meter_id, reading_value, reading_date, usage, created_at, logged_by')
        .in('meter_id', gasMissingIds)
        .gte('reading_date', refRange.from)
        .lte('reading_date', refRange.to);
      const gmMap = new Map(gasMetersList.map((m) => [m.id, m]));
      (legacyGas || []).forEach((lr: any) => {
        const gm = gmMap.get(lr.meter_id);
        const primary = gm?.devices?.find((d) => d.is_billing_primary) || gm?.devices?.[0];
        gasLogs.push({
          id: lr.id,
          device_id: primary?.id || lr.meter_id,
          reading_value: Number(lr.reading_value),
          reading_date: lr.reading_date,
          usage: lr.usage != null ? Number(lr.usage) : null,
          operator_id: lr.logged_by,
          created_at: lr.created_at,
        } as EnergyReadingLog);
      });
    }

    setGasStatsData({
      meters: gasMetersList,
      devices: gasMetersList.flatMap((m) => m.devices || []),
      logs: gasLogs,
    });
    setGasMeterIds(new Set(gasMetersList.map((g) => g.id)));

    const hourMap = new Map<string, { equipment_group?: string; category?: string }>();
    (hourMetersRes.data || []).forEach((hm: any) => {
      hourMap.set(hm.id, { equipment_group: hm.equipment_group, category: hm.category });
    });

    const fetchedMeters = ((metersRes.data || []) as any[]).map((m) => {
      const hm = hourMap.get(m.id);
      return {
        ...m,
        equipment_group: hm?.equipment_group,
        category: hm?.category || m.category,
      };
    }) as Meter[];

    setMeters(fetchedMeters);
    setSections((sectionsRes.data || []) as MeterSection[]);

    if (fetchedMeters.length === 0 || boundaries.length === 0) {
      setReadingsByMeter(new Map());
      setLoading(false);
      return;
    }

    const meterIds = fetchedMeters.map((m) => m.id);
    const windowStart = format(subDays(new Date(boundaries[0]), 20), 'yyyy-MM-dd');
    const windowEnd = format(addDays(new Date(boundaries[boundaries.length - 1]), 20), 'yyyy-MM-dd');

    const { data: readingsData } = await supabase
      .from('readings')
      .select('id, meter_id, reading_value, reading_date, created_at')
      .in('meter_id', meterIds)
      .gte('reading_date', windowStart)
      .lte('reading_date', windowEnd)
      .order('reading_date', { ascending: true })
      .order('created_at', { ascending: true });

    const grouped = new Map<string, ReadingLite[]>();
    (readingsData || []).forEach((r) => {
      const arr = grouped.get(r.meter_id) || [];
      arr.push({
        id: r.id,
        reading_value: Number(r.reading_value),
        reading_date: r.reading_date,
        created_at: r.created_at,
      });
      grouped.set(r.meter_id, arr);
    });

    // Branch readings for split energy meters (Peak / Off-Peak)
    const splitDeviceIds = energyMetersList
      .filter((m) => m.reading_mode === 'split')
      .flatMap((m) => (m.devices || []).map((d) => d.id));
    const devGrouped = new Map<string, ReadingLite[]>();
    if (splitDeviceIds.length > 0) {
      const { data: devLogs } = await supabase
        .from('energy_reading_logs')
        .select('id, device_id, reading_value, reading_date, created_at')
        .in('device_id', splitDeviceIds)
        .gte('reading_date', windowStart)
        .lte('reading_date', windowEnd)
        .order('reading_date', { ascending: true })
        .order('created_at', { ascending: true });
      (devLogs || []).forEach((r: any) => {
        const arr = devGrouped.get(r.device_id) || [];
        arr.push({
          id: r.id,
          reading_value: Number(r.reading_value),
          reading_date: r.reading_date,
          created_at: r.created_at,
        });
        devGrouped.set(r.device_id, arr);
      });
    }
    setDeviceReadings(devGrouped);

    setReadingsByMeter(grouped);
    setLoading(false);
  }, [supabase, boundaries, refDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Split (Peak / Off-Peak) meters: per-branch monthly usage; meter total = sum of branches.
  const splitMonthly = useMemo(() => {
    const map = new Map<string, { total: number[]; branches: { id: string; label: string; values: number[] }[] }>();
    energyStatsData.meters
      .filter((m) => m.reading_mode === 'split')
      .forEach((m) => {
        const mf = Number(m.multiplication_factor) || 1;
        const devs = [...(m.devices || [])].sort((a, b) => a.sort_order - b.sort_order);
        const branches = devs.map((d) => {
          const list = deviceReadings.get(d.id);
          const values: number[] = [];
          for (let i = 0; i < comparisonRange; i++) {
            const prevReading = findNearestReading(list, boundaries[i]);
            const currReading = findNearestReading(list, boundaries[i + 1]);
            if (!prevReading || !currReading || prevReading.id === currReading.id) {
              values.push(0);
              continue;
            }
            values.push((currReading.reading_value - prevReading.reading_value) * mf);
          }
          return { id: d.id, label: d.checkpoint_label, values };
        });
        const total = Array.from({ length: comparisonRange }, (_, i) =>
          branches.reduce((sum, b) => sum + (b.values[i] || 0), 0)
        );
        map.set(m.id, { total, branches });
      });
    return map;
  }, [energyStatsData.meters, deviceReadings, boundaries, comparisonRange]);

  // Per-meter consumption for each month in the comparison range.
  const meterMonthlyConsumption = useMemo(() => {
    const map = new Map<string, number[]>();
    meters.forEach((m) => {
      const list = readingsByMeter.get(m.id);
      const mf = Number(m.multiplication_factor) || 1;
      const values: number[] = [];
      for (let i = 0; i < comparisonRange; i++) {
        const prevReading = findNearestReading(list, boundaries[i]);
        const currReading = findNearestReading(list, boundaries[i + 1]);
        if (!prevReading || !currReading || prevReading.id === currReading.id) {
          values.push(0);
          continue;
        }
        values.push((currReading.reading_value - prevReading.reading_value) * mf);
      }
      map.set(m.id, values);
    });
    // Split meters: total = sum of branches; branch ids are tracked for the graph filter
    splitMonthly.forEach((v, meterId) => {
      map.set(meterId, v.total);
      v.branches.forEach((b) => map.set(b.id, b.values));
    });
    return map;
  }, [meters, readingsByMeter, boundaries, comparisonRange, splitMonthly]);

  const sectionMap = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);

  const isKwSection = useCallback(
    (m: Meter) => {
      const sec = sectionMap.get(m.section_id || '');
      // A meter with no section assigned is treated as a standard KW/Energy meter.
      if (!sec) return true;
      return !!sec.unit?.trim().toLowerCase().startsWith('kw');
    },
    [sectionMap]
  );

  const isGasSection = useCallback(
    (m: Meter) => {
      const sec = sectionMap.get(m.section_id || '');
      const u = sec?.unit?.trim().toLowerCase() || '';
      return u.includes('m³') || u.includes('m3') || !!sec?.name?.toLowerCase().includes('gas');
    },
    [sectionMap]
  );

  const isHourSection = useCallback(
    (m: Meter) => {
      const sec = sectionMap.get(m.section_id || '');
      const u = sec?.unit?.trim().toLowerCase() || '';
      return u.includes('hr') || !!sec?.name?.toLowerCase().includes('hour');
    },
    [sectionMap]
  );

  const refIdx = comparisonRange - 1;
  const prevIdx = comparisonRange - 2;

  const sumFor = useCallback(
    (list: Meter[], idx: number) => {
      if (idx < 0) return 0;
      return list.reduce((sum, m) => sum + (meterMonthlyConsumption.get(m.id)?.[idx] || 0), 0);
    },
    [meterMonthlyConsumption]
  );

  const kwMeters = useMemo(() => meters.filter(isKwSection), [meters, isKwSection]);
  const incomingMeters = useMemo(
    () => kwMeters.filter((m) => m.type === 'incoming' || m.type === 'main'),
    [kwMeters]
  );
  const outgoingMainMeters = useMemo(
    () => kwMeters.filter((m) => m.type === 'outgoing_main' || m.type === 'outgoing'),
    [kwMeters]
  );
  const outgoingSubMeters = useMemo(
    () => kwMeters.filter((m) => m.type === 'outgoing_sub' || m.type === 'submeter'),
    [kwMeters]
  );
  const outgoingSubSubMeters = useMemo(
    () => kwMeters.filter((m) => m.type === 'outgoing_sub_sub'),
    [kwMeters]
  );

  // ─── Top cards: same logic as the Energy Meters page ───
  const energyStats = useMemo(
    () => computeEnergyDashboardStats(energyStatsData.meters, energyStatsData.devices, energyStatsData.logs),
    [energyStatsData]
  );
  const energyStatsPrev = useMemo(
    () => computeEnergyDashboardStats(energyStatsData.meters, energyStatsData.devices, energyStatsData.prevLogs),
    [energyStatsData]
  );

  const totalIncoming = energyStats.totalIncoming;
  const totalIncomingPrev = energyStatsPrev.totalIncoming;
  const percentChange =
    totalIncomingPrev > 0 ? ((totalIncoming - totalIncomingPrev) / totalIncomingPrev) * 100 : 0;

  const totalOutgoingMain = energyStats.totalOutgoingMain;
  const totalOutgoingMainPrev = energyStatsPrev.totalOutgoingMain;
  const outgoingMainChange =
    totalOutgoingMainPrev > 0 ? ((totalOutgoingMain - totalOutgoingMainPrev) / totalOutgoingMainPrev) * 100 : 0;

  // Outgoing Sub / Sub-Sub cards are unchanged (dashboard readings-based)
  const totalOutgoingSub = sumFor(outgoingSubMeters, refIdx);
  const totalOutgoingSubPrev = sumFor(outgoingSubMeters, prevIdx);
  const outgoingSubChange =
    totalOutgoingSubPrev > 0 ? ((totalOutgoingSub - totalOutgoingSubPrev) / totalOutgoingSubPrev) * 100 : 0;

  const totalOutgoingSubSub = sumFor(outgoingSubSubMeters, refIdx);

  const systemLoss = energyStats.systemLoss;
  const systemLossPercent = energyStats.systemLossPercent;


  // ─── Meter-wise Consumption charts (multi-month rows, KW meters only) ───
  // Same shape as the Units chart above: one row per meter, with a value per
  // month in the selected comparison range, shaded from the row's base color.
  const lastMonthKey = monthsList[monthsList.length - 1]?.key;

  const buildMonthlyRows = useCallback(
    (list: Meter[], colorFor: (m: Meter, i: number) => string): MonthlyComparisonRow[] =>
      list
        .map((m, i) => {
          const values: Record<string, number> = {};
          monthsList.forEach((mo, idx) => {
            values[mo.key] = Math.round((meterMonthlyConsumption.get(m.id)?.[idx] || 0) * 10) / 10;
          });
          return { id: m.id, name: m.name, color: colorFor(m, i), values };
        })
        .sort((a, b) => (b.values[lastMonthKey] || 0) - (a.values[lastMonthKey] || 0)),
    [monthsList, meterMonthlyConsumption, lastMonthKey]
  );

  // Adds Peak / Off-Peak rows (hidden by default, selectable in the filter) after each split meter
  const withBranchRows = useCallback(
    (rows: MonthlyComparisonRow[]): MonthlyComparisonRow[] =>
      rows.flatMap((r) => {
        const sm = splitMonthly.get(r.id);
        if (!sm) return [r];
        const branchRows: MonthlyComparisonRow[] = sm.branches.map((b) => {
          const values: Record<string, number> = {};
          monthsList.forEach((mo, idx) => {
            values[mo.key] = Math.round((b.values[idx] || 0) * 10) / 10;
          });
          return { id: b.id, name: `${r.name} — ${b.label}`, color: r.color, values, defaultHidden: true };
        });
        return [r, ...branchRows];
      }),
    [splitMonthly, monthsList]
  );

  const incomingMonthlyRows = useMemo(
    () => withBranchRows(buildMonthlyRows(incomingMeters, (_m, i) => colorAt(i))),
    [buildMonthlyRows, incomingMeters, withBranchRows]
  );

  const outgoingMainMonthlyRows = useMemo(
    () => withBranchRows(buildMonthlyRows(outgoingMainMeters, (_m, i) => colorAt(i))),
    [buildMonthlyRows, outgoingMainMeters, withBranchRows]
  );
  const outgoingSubMonthlyRows = useMemo(
    () => withBranchRows(buildMonthlyRows(outgoingSubMeters, (_m, i) => colorAt(i))),
    [buildMonthlyRows, outgoingSubMeters, withBranchRows]
  );
  const outgoingSubSubMonthlyRows = useMemo(
    () => withBranchRows(buildMonthlyRows(outgoingSubSubMeters, (_m, i) => colorAt(i))),
    [buildMonthlyRows, outgoingSubSubMeters, withBranchRows]
  );

  // ─── Gas Meter & Hour Meter charts (multi-month rows) ───
  // Gas tier comes from gas_meters.section (same as the Gas Meters page)
  const gasSectionById = useMemo(
    () => new Map(gasStatsData.meters.map((m) => [m.id, m.section as string])),
    [gasStatsData.meters]
  );

  // Only meters that exist & are active on the Gas Meters page
  const gasMeters = useMemo(
    () => meters.filter((m) => isGasSection(m) && gasMeterIds.has(m.id)),
    [meters, isGasSection, gasMeterIds]
  );
  const hourMeters = useMemo(() => meters.filter(isHourSection), [meters, isHourSection]);

  const gasIncomingMeters = useMemo(
    () => gasMeters.filter((m) => gasSectionById.get(m.id) === 'incoming'),
    [gasMeters, gasSectionById]
  );
  const gasOutgoingMainMeters = useMemo(
    () => gasMeters.filter((m) => gasSectionById.get(m.id) === 'outgoing_main'),
    [gasMeters, gasSectionById]
  );
  const gasApplianceMeters = useMemo(
    () => gasMeters.filter((m) => gasSectionById.get(m.id) === 'outgoing_sub'),
    [gasMeters, gasSectionById]
  );

  // Gas cards: identical calculation to the Gas Meters page
  const gasStats = useMemo(
    () => computeEnergyDashboardStats(gasStatsData.meters, gasStatsData.devices, gasStatsData.logs),
    [gasStatsData]
  );
  const totalGasIncomer = gasStats.totalIncoming;
  const totalGasHeaders = gasStats.totalOutgoingMain;
  const totalGasAppliances = gasStats.totalOutgoingSub;

  const buildHourMonthlyRows = useCallback(
    (list: Meter[]): MonthlyComparisonRow[] =>
      list
        .map((m, i) => {
          const values: Record<string, number> = {};
          monthsList.forEach((mo, idx) => {
            values[mo.key] = Math.round((meterMonthlyConsumption.get(m.id)?.[idx] || 0) * 10) / 10;
          });
          return { id: m.id, name: m.name, color: colorAt(i), values };
        })
        .sort((a, b) => (b.values[lastMonthKey] || 0) - (a.values[lastMonthKey] || 0)),
    [monthsList, meterMonthlyConsumption, lastMonthKey]
  );

  // One graph per gas tier: RMS Incomers, Headers, Appliances
  const gasIncomingMonthlyRows = useMemo(
    () => buildMonthlyRows(gasIncomingMeters, (_m, i) => colorAt(i)),
    [buildMonthlyRows, gasIncomingMeters]
  );
  const gasMainMonthlyRows = useMemo(
    () => buildMonthlyRows(gasOutgoingMainMeters, (_m, i) => colorAt(i)),
    [buildMonthlyRows, gasOutgoingMainMeters]
  );
  const gasApplianceMonthlyRows = useMemo(
    () => buildMonthlyRows(gasApplianceMeters, (_m, i) => colorAt(i)),
    [buildMonthlyRows, gasApplianceMeters]
  );

  const hourCompMeters = useMemo(() => hourMeters.filter((m) => getHourGroupKey(m) === 'Compressor'), [hourMeters]);
  const hourPumpMeters = useMemo(() => hourMeters.filter((m) => getHourGroupKey(m) === 'Pump'), [hourMeters]);
  const hourGenMeters = useMemo(() => hourMeters.filter((m) => getHourGroupKey(m) === 'Generator'), [hourMeters]);
  const hourOtherMeters = useMemo(() => hourMeters.filter((m) => getHourGroupKey(m) === 'Other'), [hourMeters]);

  const hourCompMonthlyRows = useMemo(() => buildHourMonthlyRows(hourCompMeters), [buildHourMonthlyRows, hourCompMeters]);
  const hourPumpMonthlyRows = useMemo(() => buildHourMonthlyRows(hourPumpMeters), [buildHourMonthlyRows, hourPumpMeters]);
  const hourGenMonthlyRows = useMemo(() => buildHourMonthlyRows(hourGenMeters), [buildHourMonthlyRows, hourGenMeters]);
  const hourOtherMonthlyRows = useMemo(() => buildHourMonthlyRows(hourOtherMeters), [buildHourMonthlyRows, hourOtherMeters]);

  const totalHourComp = useMemo(() => sumFor(hourCompMeters, refIdx), [sumFor, hourCompMeters, refIdx]);
  const totalHourPump = useMemo(() => sumFor(hourPumpMeters, refIdx), [sumFor, hourPumpMeters, refIdx]);
  const totalHourGen = useMemo(() => sumFor(hourGenMeters, refIdx), [sumFor, hourGenMeters, refIdx]);
  const totalHourOther = useMemo(() => sumFor(hourOtherMeters, refIdx), [sumFor, hourOtherMeters, refIdx]);

  const gasUnit = sections.find((s) => s.name.toLowerCase().includes('gas'))?.unit || 'm³';
  const hourUnit = sections.find((s) => s.name.toLowerCase().includes('hour'))?.unit || 'hrs';

  const dashboardTabs = useMemo(() => {
    const tabs: { id: 'energy' | 'gas' | 'hour'; label: string }[] = [];
    const hasEnergyMeters = meters.some((m) => !isGasSection(m) && !isHourSection(m));
    if (hasEnergyMeters) {
      tabs.push({ id: 'energy', label: 'Energy Meter' });
    }
    if (gasMeters.length > 0) {
      tabs.push({ id: 'gas', label: 'Gas Meter' });
    }
    if (hourMeters.length > 0) {
      tabs.push({ id: 'hour', label: 'Hour Meter' });
    }
    return tabs;
  }, [meters, gasMeters, hourMeters, isGasSection, isHourSection]);

  useEffect(() => {
    if (dashboardTabs.length > 0) {
      if (!dashboardTabs.some((t) => t.id === activeTab)) {
        setActiveTab(dashboardTabs[0].id);
      }
    }
  }, [dashboardTabs, activeTab]);

  const refLabel = `${MONTH_NAMES[refMonth - 1]} ${refYear}`;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
          <p className="text-sm text-text-secondary mt-1">
            Factory energy consumption overview — <span className="text-accent font-semibold">{refLabel}</span>
          </p>
        </div>

        {/* Global Controls — shared by every chart on this page */}
        <Card className="px-3 py-2 w-fit max-w-full flex-shrink-0 overflow-x-auto">
          <div className="flex flex-nowrap items-center gap-2 w-max">
            <div className="w-[104px]">
              <Select
                value={refMonth}
                onChange={(e) => setRefMonth(Number(e.target.value))}
                options={MONTH_NAMES.map((name, idx) => ({ value: String(idx + 1), label: name }))}
                className="!py-1.5 !text-xs !pl-2.5 !pr-7"
              />
            </div>
            <div className="w-[82px]">
              <Select
                value={refYear}
                onChange={(e) => setRefYear(Number(e.target.value))}
                options={yearOptions.map((y) => ({ value: String(y), label: String(y) }))}
                className="!py-1.5 !text-xs !pl-2.5 !pr-7"
              />
            </div>
            <div className="w-px h-6 bg-border mx-0.5 flex-shrink-0" />
            <div className="flex items-center gap-1 flex-shrink-0">
              {([1, 3, 6, 12] as ComparisonRange[]).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setComparisonRange(n)}
                  className={`px-2.5 py-1.5 rounded-[var(--radius-sm)] text-xs font-semibold transition-all whitespace-nowrap ${
                    comparisonRange === n
                      ? 'bg-accent text-white'
                      : 'bg-bg-elevated text-text-secondary hover:text-text-primary border border-border'
                  }`}
                >
                  {n}M
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Section Tabs */}
          {dashboardTabs.length > 1 && (
            <Tabs
              tabs={dashboardTabs}
              activeTab={activeTab}
              onChange={(id) => setActiveTab(id as 'energy' | 'gas' | 'hour')}
              className="mb-2"
            />
          )}

          {/* ─── Energy Meter Tab ─── */}
          {activeTab === 'energy' && (
            <div className="space-y-6">
              {/* Stats Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 stagger-children">
                <StatCard
                  label={`Total ${tierLabels.incoming || 'Incoming'} Power`}
                  value={`${totalIncoming.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`}
                  icon={
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                  }
                  trend={totalIncomingPrev > 0 ? { value: percentChange, label: 'vs previous month' } : undefined}
                  accentColor="var(--color-warning)"
                />

                <StatCard
                  label={`${tierLabels.outgoing_main || 'Outgoing'} Power`}
                  value={`${totalOutgoingMain.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`}
                  icon={
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  }
                  trend={totalOutgoingMainPrev > 0 ? { value: outgoingMainChange, label: 'vs previous month' } : undefined}
                  accentColor="var(--color-accent)"
                />

                <StatCard
                  label={`${tierLabels.outgoing_sub || 'Outgoing'} Power`}
                  value={`${totalOutgoingSub.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`}
                  icon={
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <line x1="9" y1="3" x2="9" y2="21" />
                    </svg>
                  }
                  trend={totalOutgoingSubPrev > 0 ? { value: outgoingSubChange, label: 'vs previous month' } : undefined}
                  accentColor="var(--color-success)"
                />

                {outgoingSubSubMeters.length > 0 && (
                  <StatCard
                    label={`${tierLabels.outgoing_sub_sub || 'Sub-Sub'} Power`}
                    value={`${totalOutgoingSubSub.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`}
                    icon={
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <line x1="9" y1="3" x2="9" y2="21" />
                        <line x1="15" y1="3" x2="15" y2="21" />
                      </svg>
                    }
                    accentColor="var(--color-danger)"
                  />
                )}

                <StatCard
                  label="System Loss"
                  value={`${Math.abs(systemLoss).toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`}
                  icon={
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  }
                  accentColor={
                    systemLossPercent > 5
                      ? 'var(--color-danger)'
                      : systemLossPercent > 2
                        ? 'var(--color-warning)'
                        : 'var(--color-success)'
                  }
                  trend={{ value: systemLossPercent, label: 'of incoming' }}
                />
              </div>

              {/* Meter-wise Consumption */}
              <div>
                <h2 className="text-lg font-semibold text-text-primary mb-1">Meter-wise Consumption</h2>
                <p className="text-xs text-text-secondary mb-4">
                  Energy (kWh) meters · last {comparisonRange} month{comparisonRange > 1 ? 's' : ''}, ending {refLabel}, grouped by hierarchy tier
                </p>
                <div className="grid grid-cols-1 gap-4">
                  <FilterableChartCard title={<>{getEnergyGroupLabel('incoming', tierLabels)}</>} headerExtra={<><span className="text-xs text-text-muted">{incomingMonthlyRows.filter((r) => !r.defaultHidden).length} meters</span></>}
                      months={monthsList}
                      rows={incomingMonthlyRows}
                      unit="kWh"
                      emptyMessage="No incoming meters configured."
                    />

                  <FilterableChartCard title={<>{getEnergyGroupLabel('outgoing_main', tierLabels)}</>} headerExtra={<><span className="text-xs text-text-muted">{outgoingMainMonthlyRows.filter((r) => !r.defaultHidden).length} meters</span></>}
                      months={monthsList}
                      rows={outgoingMainMonthlyRows}
                      unit="kWh"
                      emptyMessage="No main outgoing meters configured."
                    />

                  <FilterableChartCard title={<>{getEnergyGroupLabel('outgoing_sub', tierLabels)}</>} headerExtra={<><span className="text-xs text-text-muted">{outgoingSubMonthlyRows.filter((r) => !r.defaultHidden).length} meters</span></>}
                      months={monthsList}
                      rows={outgoingSubMonthlyRows}
                      unit="kWh"
                      emptyMessage="No sub outgoing meters configured."
                    />

                  <FilterableChartCard title={<>{getEnergyGroupLabel('outgoing_sub_sub', tierLabels)}</>} headerExtra={<><span className="text-xs text-text-muted">{outgoingSubSubMonthlyRows.filter((r) => !r.defaultHidden).length} meters</span></>}
                      months={monthsList}
                      rows={outgoingSubSubMonthlyRows}
                      unit="kWh"
                      emptyMessage="No sub-of-sub outgoing meters configured."
                    />
                </div>
              </div>
            </div>
          )}

          {/* ─── Gas Meter Tab ─── */}
          {activeTab === 'gas' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-text-primary mb-1">Gas Meters</h2>
                <p className="text-xs text-text-secondary mb-4">
                  RMS incomers, headers & appliances · last {comparisonRange} month{comparisonRange > 1 ? 's' : ''}, ending {refLabel}
                </p>
                {/* Gas Stat Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 stagger-children">
                  <StatCard
                    label="Total RMS Incomer"
                    value={`${totalGasIncomer.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${gasUnit}`}
                    accentColor="var(--color-warning)"
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3z" />
                      </svg>
                    }
                  />
                  <StatCard
                    label="Total Consumption In Headers"
                    value={`${totalGasHeaders.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${gasUnit}`}
                    accentColor="var(--color-accent)"
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="8 12 12 16 16 12" />
                        <line x1="12" y1="8" x2="12" y2="16" />
                      </svg>
                    }
                  />
                  <StatCard
                    label="Total Consumption In Appliances"
                    value={`${totalGasAppliances.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${gasUnit}`}
                    accentColor="var(--color-success)"
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <line x1="9" y1="3" x2="9" y2="21" />
                      </svg>
                    }
                  />
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <FilterableChartCard title={<>Gas Meter — RMS Incomers</>}
                    headerExtra={<span className="text-xs text-text-muted">{gasIncomingMonthlyRows.length} meters</span>}
                    months={monthsList}
                    rows={gasIncomingMonthlyRows}
                    unit={gasUnit}
                    emptyMessage="No RMS incomer gas meters configured."
                  />

                  <FilterableChartCard title={<>Gas Meter — {getGasGroupLabel('outgoing_main', tierLabels)}</>}
                    headerExtra={<span className="text-xs text-text-muted">{gasMainMonthlyRows.length} meters</span>}
                    months={monthsList}
                    rows={gasMainMonthlyRows}
                    unit={gasUnit}
                    emptyMessage="No gas header meters configured."
                  />

                  <FilterableChartCard title={<>Gas Meter — Appliances</>}
                    headerExtra={<span className="text-xs text-text-muted">{gasApplianceMonthlyRows.length} meters</span>}
                    months={monthsList}
                    rows={gasApplianceMonthlyRows}
                    unit={gasUnit}
                    emptyMessage="No appliance gas meters configured."
                  />
                </div>
              </div>
            </div>
          )}

          {/* ─── Hour Meter Tab ─── */}
          {activeTab === 'hour' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-text-primary mb-1">Hour Meters</h2>
                <p className="text-xs text-text-secondary mb-4">
                  Equipment running hours grouped by machinery group · last {comparisonRange} month{comparisonRange > 1 ? 's' : ''}, ending {refLabel}
                </p>

                {/* Hour Meter Stat Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 stagger-children">
                  <StatCard
                    label={tierLabels.hour_compressor || 'Compressors'}
                    value={`${totalHourComp.toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs`}
                    accentColor="var(--color-accent)"
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M14.31 8l5.74 9.94M9.69 8h11.48M7.38 12l5.74-9.94M9.69 16L3.95 6.06M14.31 16H2.83M16.62 12l-5.74 9.94" />
                      </svg>
                    }
                  />
                  <StatCard
                    label={tierLabels.hour_pump || 'Pumps'}
                    value={`${totalHourPump.toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs`}
                    accentColor="var(--color-warning)"
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
                      </svg>
                    }
                  />
                  <StatCard
                    label={tierLabels.hour_generator || 'Generators'}
                    value={`${totalHourGen.toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs`}
                    accentColor="var(--color-success)"
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                      </svg>
                    }
                  />
                  <StatCard
                    label={tierLabels.hour_other || 'Other Machinery'}
                    value={`${totalHourOther.toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs`}
                    accentColor="var(--color-primary, #6366f1)"
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                      </svg>
                    }
                  />
                </div>

                {/* Group Charts Grid */}
                <div className="grid grid-cols-1 gap-4">
                  <FilterableChartCard title={<>{tierLabels.hour_compressor || 'Compressors'}</>} headerExtra={<><span className="text-xs text-text-muted">{hourCompMeters.length} meters</span></>}
                      months={monthsList}
                      rows={hourCompMonthlyRows}
                      unit={hourUnit}
                      emptyMessage="No compressor meters configured."
                      yAxisWidth={140}
                    />

                  <FilterableChartCard title={<>{tierLabels.hour_pump || 'Pumps'}</>} headerExtra={<><span className="text-xs text-text-muted">{hourPumpMeters.length} meters</span></>}
                      months={monthsList}
                      rows={hourPumpMonthlyRows}
                      unit={hourUnit}
                      emptyMessage="No pump meters configured."
                      yAxisWidth={140}
                    />

                  <FilterableChartCard title={<>{tierLabels.hour_generator || 'Generators'}</>} headerExtra={<><span className="text-xs text-text-muted">{hourGenMeters.length} meters</span></>}
                      months={monthsList}
                      rows={hourGenMonthlyRows}
                      unit={hourUnit}
                      emptyMessage="No generator meters configured."
                      yAxisWidth={140}
                    />

                  <FilterableChartCard title={<>{tierLabels.hour_other || 'Other Machinery'}</>} headerExtra={<><span className="text-xs text-text-muted">{hourOtherMeters.length} meters</span></>}
                      months={monthsList}
                      rows={hourOtherMonthlyRows}
                      unit={hourUnit}
                      emptyMessage="No other machinery configured."
                      yAxisWidth={140}
                    />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
