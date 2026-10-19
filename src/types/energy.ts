// ─────────────────────────────────────────────────────────────
// Energy Meter domain types
// Matches the Supabase schema in supabase/migrations/energy_meters.sql
// ─────────────────────────────────────────────────────────────

export type EnergyReadingMode = 'checkpoint' | 'split';

export type EnergyMeterSection = 'incoming' | 'outgoing_main' | 'outgoing_sub' | 'outgoing_sub_sub';

// ── Logical energy meter ────────────────────────────────────

export interface EnergyMeter {
  id: string;
  name: string;
  section: EnergyMeterSection;
  category: string;                    // e.g. 'REB', 'Generator', 'Solar'
  parent_id: string | null;
  multiplication_factor: number;
  is_primary_for_total: boolean;
  /** 'checkpoint' (default): primary device counts. 'split': devices are branches (Peak/Off-Peak) that are summed. */
  reading_mode?: EnergyReadingMode;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  // Joined / derived
  parent?: EnergyMeter | null;
  devices?: EnergyMeterDevice[];
  children?: EnergyMeter[];
}

// ── Physical checkpoint device ──────────────────────────────

export interface EnergyMeterDevice {
  id: string;
  meter_id: string;
  checkpoint_label: string;            // e.g. 'Before Source', 'HT Panel', 'LT Panel Incoming'
  serial_number: string;
  is_billing_primary: boolean;
  sort_order: number;
  created_at: string;
  // Joined
  meter?: EnergyMeter;
  latest_reading?: EnergyReadingLog | null;
}

// ── Reading log entry ───────────────────────────────────────

export interface EnergyReadingLog {
  id: string;
  device_id: string;
  reading_value: number;
  reading_date: string;
  usage: number | null;
  operator_id: string;
  created_at: string;
  // Joined
  device?: EnergyMeterDevice;
  operator?: { id: string; full_name: string };
}

// ── Aggregated monthly usage (mirrors energy_monthly_usage view) ──

export interface EnergyMonthlyUsage {
  meter_id: string;
  meter_name: string;
  meter_section: EnergyMeterSection;
  meter_category: string;
  multiplication_factor: number;
  parent_id: string | null;
  device_id: string;
  checkpoint_label: string;
  is_billing_primary: boolean;
  month: string;
  total_usage: number;
  reading_count: number;
}

// ── Checkpoint-level loss calculation result ─────────────────

export interface CheckpointLoss {
  upstream_device_id: string;
  upstream_label: string;
  downstream_device_id: string;
  downstream_label: string;
  upstream_reading: number;
  downstream_reading: number;
  loss_kwh: number;
  loss_percent: number;
}

// ── Summary stat card types ─────────────────────────────────

export interface EnergyDashboardStats {
  totalIncoming: number;
  totalOutgoingMain: number;
  totalOutgoingSub: number;
  totalOutgoingSubSub: number;
  systemLoss: number;
  systemLossPercent: number;
  totalMeters: number;
  totalDevices: number;
  totalReadingsThisMonth: number;
}

// ── Section config (for UI accordion headings) ──────────────

export const ENERGY_SECTION_META: Record<
  EnergyMeterSection,
  { label: string; icon: string; color: string; description: string }
> = {
  incoming: {
    label: 'Incoming Meters',
    icon: '',
    color: 'var(--color-warning)',
    description: 'Grid, generator, and renewable energy sources feeding the LT busbar.',
  },
  outgoing_main: {
    label: 'Outgoing Main Meters',
    icon: '',
    color: 'var(--color-accent)',
    description: 'Primary feeders originating at the LT Panel Outgoing busbar.',
  },
  outgoing_sub: {
    label: 'Outgoing Sub Meters',
    icon: '',
    color: 'var(--color-success)',
    description: 'Distribution boards grouped by facility zone.',
  },
  outgoing_sub_sub: {
    label: 'Outgoing Sub-Sub Meters',
    icon: '',
    color: 'var(--color-danger)',
    description: 'Sub-meters assigned to specific departmental / unit endpoints.',
  },
};
