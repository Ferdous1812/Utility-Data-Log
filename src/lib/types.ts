// Database types matching the Supabase schema

export type UserRole = 'admin' | 'operator';
export type MeterType = 'incoming' | 'outgoing_main' | 'outgoing_sub' | 'outgoing_sub_sub' | 'main' | 'submeter' | 'outgoing';

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  created_at: string;
}

export interface Meter {
  id: string;
  name: string;
  type: MeterType;
  location: string;
  parent_meter_id: string | null;
  section_id?: string | null;
  multiplication_factor: number;
  sort_order?: number;
  is_active: boolean;
  created_at: string;
  // Joined fields
  parent_meter?: Meter | null;
}

export interface Reading {
  id: string;
  meter_id: string;
  reading_value: number;
  reading_date: string;
  usage: number | null;
  logged_by: string;
  created_at: string;
  // Joined fields
  meter?: Meter;
  profile?: Profile;
}

export interface MonthlyUsage {
  meter_id: string;
  meter_name: string;
  meter_type: MeterType;
  meter_location: string;
  meter_multiplication_factor?: number;
  meter_parent_meter_id?: string | null;
  month: string;
  total_usage: number;
  reading_count: number;
}

export interface DashboardStats {
  totalUsageThisMonth: number;
  totalUsageLastMonth: number;
  totalIncomingThisMonth: number;
  totalOutgoingMainThisMonth: number;
  totalOutgoingSubThisMonth: number;
  percentChange: number;
  totalMeters: number;
  totalReadingsThisMonth: number;
}

export interface MeterSection {
  id: string;
  name: string;
  icon: string;
  color: string;
  unit: string;
  sort_order: number;
  created_at: string;
}

export type AllocationMode = 'direct' | 'calculated_remainder';

export interface Unit {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  allocation_mode?: AllocationMode;
}

export interface UnitAllocation {
  id: string;
  unit_id: string;
  meter_id: string;
  percentage: number;
  created_at: string;
  meter?: Meter;
}

export interface UnitRemainderRule {
  unit_id: string;
  base_source_meter_id: string;
  deduction_meter_ids: string[];
  remainder_share_percent: number;
  updated_at: string;
}
