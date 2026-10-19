// ─────────────────────────────────────────────────────────────
// Gas Meter domain types
// Matches the Supabase schema in supabase/migrations/hour_and_gas_meters.sql
// ─────────────────────────────────────────────────────────────

export type GasMeterSection = 'incoming' | 'outgoing_main' | 'outgoing_sub' | 'outgoing_sub_sub';

export interface GasMeter {
  id: string;
  name: string;
  section: GasMeterSection;
  category: string;
  parent_id: string | null;
  multiplication_factor: number;
  is_primary_for_total: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  // Joined / derived
  parent?: GasMeter | null;
  devices?: GasMeterDevice[];
}

export interface GasMeterDevice {
  id: string;
  meter_id: string;
  checkpoint_label: string;
  serial_number: string;
  is_billing_primary: boolean;
  sort_order: number;
  created_at: string;
  // Joined
  meter?: GasMeter;
  latest_reading?: GasReadingLog | null;
}

export interface GasReadingLog {
  id: string;
  device_id: string;
  reading_value: number;
  reading_date: string;
  usage: number | null;
  operator_id: string;
  created_at: string;
  // Joined
  device?: GasMeterDevice;
  operator?: { id: string; full_name: string };
}
