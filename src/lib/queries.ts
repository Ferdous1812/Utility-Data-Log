import { createClient } from '@/lib/supabase/server';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
import type { DashboardStats, MonthlyUsage, Reading, Meter, Profile } from '@/lib/types';

// ─── Dashboard Stats ───

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = await createClient();
  const now = new Date();
  const thisMonthStart = format(startOfMonth(now), 'yyyy-MM-dd');
  const thisMonthEnd = format(endOfMonth(now), 'yyyy-MM-dd');
  const lastMonthStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');
  const lastMonthEnd = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');

  // Fetch this month readings joined with meter type
  const { data: thisMonth } = await supabase
    .from('readings')
    .select('usage, meter:meters(type)')
    .gte('reading_date', thisMonthStart)
    .lte('reading_date', thisMonthEnd)
    .not('usage', 'is', null);

  let totalUsageThisMonth = 0;
  let totalIncomingThisMonth = 0;
  let totalOutgoingMainThisMonth = 0;
  let totalOutgoingSubThisMonth = 0;

  (thisMonth || []).forEach((r) => {
    const val = Number(r.usage) || 0;
    totalUsageThisMonth += val;
    const type = (r.meter as unknown as { type?: string })?.type;
    if (type === 'incoming' || type === 'main') {
      totalIncomingThisMonth += val;
    } else if (type === 'outgoing_main' || type === 'outgoing') {
      totalOutgoingMainThisMonth += val;
    } else {
      // outgoing_sub, submeter, outgoing_sub_sub
      totalOutgoingSubThisMonth += val;
    }
  });

  const totalReadingsThisMonth = (thisMonth || []).length;

  // Last month usage
  const { data: lastMonth } = await supabase
    .from('readings')
    .select('usage')
    .gte('reading_date', lastMonthStart)
    .lte('reading_date', lastMonthEnd)
    .not('usage', 'is', null);

  const totalUsageLastMonth = (lastMonth || []).reduce(
    (sum, r) => sum + (Number(r.usage) || 0),
    0
  );

  const percentChange =
    totalUsageLastMonth > 0
      ? ((totalUsageThisMonth - totalUsageLastMonth) / totalUsageLastMonth) * 100
      : 0;

  const { count } = await supabase
    .from('meters')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  return {
    totalUsageThisMonth,
    totalUsageLastMonth,
    totalIncomingThisMonth,
    totalOutgoingMainThisMonth,
    totalOutgoingSubThisMonth,
    percentChange,
    totalMeters: count || 0,
    totalReadingsThisMonth,
  };
}

// ─── Monthly Usage by Meter ───

export async function getMonthlyUsageByMeter(): Promise<MonthlyUsage[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('monthly_usage')
    .select('*')
    .order('month', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Error fetching monthly usage:', error);
    return [];
  }

  return (data || []) as MonthlyUsage[];
}

// ─── Readings History ───

export async function getReadingsHistory(filters?: {
  meterId?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<(Reading & { meter: Meter; profile: Profile })[]> {
  const supabase = await createClient();

  let query = supabase
    .from('readings')
    .select(`
      *,
      meter:meters(*),
      profile:profiles(*)
    `)
    .order('reading_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);

  if (filters?.meterId) {
    query = query.eq('meter_id', filters.meterId);
  }
  if (filters?.dateFrom) {
    query = query.gte('reading_date', filters.dateFrom);
  }
  if (filters?.dateTo) {
    query = query.lte('reading_date', filters.dateTo);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching readings:', error);
    return [];
  }

  return (data || []) as (Reading & { meter: Meter; profile: Profile })[];
}

// ─── Get Previous Reading ───

export async function getPreviousReading(meterId: string): Promise<Reading | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('readings')
    .select('*')
    .eq('meter_id', meterId)
    .order('reading_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return data as Reading | null;
}

// ─── Get All Meters ───

export async function getMeters(): Promise<Meter[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('meters')
    .select(`
      *,
      parent_meter:meters!parent_meter_id(id, name)
    `)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('type', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    console.error('Error fetching meters:', error);
    return [];
  }

  return (data || []) as Meter[];
}

// ─── Get All Profiles ───

export async function getProfiles(): Promise<Profile[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching profiles:', error);
    return [];
  }

  return (data || []) as Profile[];
}

// ─── Get Current User Profile ───

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return data as Profile | null;
}

// ─── Chart Data: Current vs Previous Month ───

export async function getChartData(): Promise<
  { meterName: string; currentMonth: number; previousMonth: number }[]
> {
  const supabase = await createClient();
  const now = new Date();
  const thisMonthStart = format(startOfMonth(now), 'yyyy-MM-dd');
  const thisMonthEnd = format(endOfMonth(now), 'yyyy-MM-dd');
  const lastMonthStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');
  const lastMonthEnd = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');

  const { data: meters } = await supabase
    .from('meters')
    .select('id, name')
    .eq('is_active', true);

  if (!meters || meters.length === 0) return [];

  const { data: thisMonthReadings } = await supabase
    .from('readings')
    .select('meter_id, usage')
    .gte('reading_date', thisMonthStart)
    .lte('reading_date', thisMonthEnd)
    .not('usage', 'is', null);

  const { data: lastMonthReadings } = await supabase
    .from('readings')
    .select('meter_id, usage')
    .gte('reading_date', lastMonthStart)
    .lte('reading_date', lastMonthEnd)
    .not('usage', 'is', null);

  const thisMonthMap = new Map<string, number>();
  (thisMonthReadings || []).forEach((r) => {
    thisMonthMap.set(r.meter_id, (thisMonthMap.get(r.meter_id) || 0) + Number(r.usage));
  });

  const lastMonthMap = new Map<string, number>();
  (lastMonthReadings || []).forEach((r) => {
    lastMonthMap.set(r.meter_id, (lastMonthMap.get(r.meter_id) || 0) + Number(r.usage));
  });

  return meters.map((m) => ({
    meterName: m.name,
    currentMonth: Math.round(thisMonthMap.get(m.id) || 0),
    previousMonth: Math.round(lastMonthMap.get(m.id) || 0),
  })).filter(d => d.currentMonth > 0 || d.previousMonth > 0);
}
