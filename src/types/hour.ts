// ─────────────────────────────────────────────────────────────
// Hour Meter domain types
// Matches the Supabase schema in supabase/migrations/hour_and_gas_meters.sql
// ─────────────────────────────────────────────────────────────

export type HourEquipmentGroup = 'Compressor' | 'Pump' | 'Generator' | 'Other';

export interface HourMeter {
  id: string;
  name: string;
  equipment_group: HourEquipmentGroup;
  category: string;
  multiplication_factor: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  // Joined / derived
  devices?: HourMeterDevice[];
}

export interface HourMeterDevice {
  id: string;
  meter_id: string;
  checkpoint_label: string;
  serial_number: string;
  is_billing_primary: boolean;
  sort_order: number;
  created_at: string;
  // Joined
  meter?: HourMeter;
  latest_reading?: HourReadingLog | null;
}

export interface HourReadingLog {
  id: string;
  device_id: string;
  reading_value: number;
  reading_date: string;
  usage: number | null;
  operator_id: string;
  created_at: string;
  // Joined
  device?: HourMeterDevice;
  operator?: { id: string; full_name: string };
}
