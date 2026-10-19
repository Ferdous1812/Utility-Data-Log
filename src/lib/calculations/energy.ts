// ─────────────────────────────────────────────────────────────
// Energy Calculation Service
//
// Pure-logic functions for:
//   - Primary device selection
//   - Total incoming / outgoing energy
//   - Checkpoint-level transmission/cable loss
//   - System balance (busbar loss)
// ─────────────────────────────────────────────────────────────

import type {
  EnergyMeter,
  EnergyMeterDevice,
  EnergyReadingLog,
  CheckpointLoss,
  EnergyDashboardStats,
} from '@/types/energy';

// ─── Helpers ────────────────────────────────────────────────

/** Return the device flagged `is_billing_primary` for a meter, or first device. */
export function getBillingDevice(devices: EnergyMeterDevice[]): EnergyMeterDevice | null {
  return devices.find((d) => d.is_billing_primary) ?? devices[0] ?? null;
}

/** Sum usage for a device within a date window from its reading logs. */
export function deviceUsageInRange(
  logs: EnergyReadingLog[],
  deviceId: string
): number {
  return logs
    .filter((l) => l.device_id === deviceId && l.usage != null)
    .reduce((sum, l) => sum + Number(l.usage), 0);
}

/** True when the meter's devices are parallel branches (e.g. Peak / Off-Peak) that are summed. */
export function isSplitMeter(meter: Pick<EnergyMeter, 'reading_mode'>): boolean {
  return meter.reading_mode === 'split';
}

/** Branch devices of a split meter, in display order. */
export function getMeterBranches(
  meter: EnergyMeter,
  devices: EnergyMeterDevice[]
): EnergyMeterDevice[] {
  return devices
    .filter((d) => d.meter_id === meter.id)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * Sum usage for a logical meter.
 *  - checkpoint meter: billing-primary device only
 *  - split meter: sum of ALL branch devices (e.g. Peak + Off-Peak)
 */
export function meterUsageInRange(
  meter: EnergyMeter,
  devices: EnergyMeterDevice[],
  logs: EnergyReadingLog[]
): number {
  const meterDevices = devices.filter((d) => d.meter_id === meter.id);
  const mf = meter.multiplication_factor;
  if (isSplitMeter(meter)) {
    return meterDevices.reduce((sum, d) => sum + deviceUsageInRange(logs, d.id), 0) * mf;
  }
  const primary = getBillingDevice(meterDevices);
  if (!primary) return 0;
  return deviceUsageInRange(logs, primary.id) * mf;
}

// ─── Aggregates ─────────────────────────────────────────────

/** Total incoming energy across all incoming meters where `is_primary_for_total`. */
export function totalIncomingEnergy(
  meters: EnergyMeter[],
  devices: EnergyMeterDevice[],
  logs: EnergyReadingLog[]
): number {
  return meters
    .filter((m) => m.section === 'incoming' && m.is_primary_for_total && m.is_active)
    .reduce((sum, m) => sum + meterUsageInRange(m, devices, logs), 0);
}

/** Total outgoing main energy. */
export function totalOutgoingMainEnergy(
  meters: EnergyMeter[],
  devices: EnergyMeterDevice[],
  logs: EnergyReadingLog[]
): number {
  return meters
    .filter((m) => m.section === 'outgoing_main' && m.is_active)
    .reduce((sum, m) => sum + meterUsageInRange(m, devices, logs), 0);
}

/** Total outgoing sub energy. */
export function totalOutgoingSubEnergy(
  meters: EnergyMeter[],
  devices: EnergyMeterDevice[],
  logs: EnergyReadingLog[]
): number {
  return meters
    .filter((m) => m.section === 'outgoing_sub' && m.is_active)
    .reduce((sum, m) => sum + meterUsageInRange(m, devices, logs), 0);
}

/** Total outgoing sub-sub energy. */
export function totalOutgoingSubSubEnergy(
  meters: EnergyMeter[],
  devices: EnergyMeterDevice[],
  logs: EnergyReadingLog[]
): number {
  return meters
    .filter((m) => m.section === 'outgoing_sub_sub' && m.is_active)
    .reduce((sum, m) => sum + meterUsageInRange(m, devices, logs), 0);
}

// ─── Loss Calculations ─────────────────────────────────────

/**
 * Calculate transmission / checkpoint loss between two devices of the
 * same logical meter.
 *
 * Loss = upstream_usage – downstream_usage
 *
 * Example (REB Incoming):
 *   Loss = Reading(Before Source) – Reading(LT Panel Incoming)
 *
 * Example (Outgoing Cable):
 *   Loss = Reading(LT Panel Outgoing) – Reading(Remote Location End)
 */
export function calculateCheckpointLoss(
  upstreamDevice: EnergyMeterDevice,
  downstreamDevice: EnergyMeterDevice,
  logs: EnergyReadingLog[]
): CheckpointLoss {
  const upstreamUsage = deviceUsageInRange(logs, upstreamDevice.id);
  const downstreamUsage = deviceUsageInRange(logs, downstreamDevice.id);
  const lossKwh = upstreamUsage - downstreamUsage;
  const lossPercent = upstreamUsage > 0 ? (lossKwh / upstreamUsage) * 100 : 0;

  return {
    upstream_device_id: upstreamDevice.id,
    upstream_label: upstreamDevice.checkpoint_label,
    downstream_device_id: downstreamDevice.id,
    downstream_label: downstreamDevice.checkpoint_label,
    upstream_reading: upstreamUsage,
    downstream_reading: downstreamUsage,
    loss_kwh: lossKwh,
    loss_percent: lossPercent,
  };
}

/**
 * Auto-detect and calculate all consecutive checkpoint losses for a
 * logical meter.  Devices are sorted by `sort_order`; loss is computed
 * between each adjacent pair (device[0]→device[1], device[1]→device[2], …).
 */
export function calculateAllCheckpointLosses(
  meterId: string,
  devices: EnergyMeterDevice[],
  logs: EnergyReadingLog[]
): CheckpointLoss[] {
  const sorted = devices
    .filter((d) => d.meter_id === meterId)
    .sort((a, b) => a.sort_order - b.sort_order);

  const losses: CheckpointLoss[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    losses.push(calculateCheckpointLoss(sorted[i], sorted[i + 1], logs));
  }
  return losses;
}

/**
 * System Balance / Busbar Loss:
 *
 * System Loss = Total Incoming (LT) – Total Outgoing Main (LT)
 */
export function calculateSystemLoss(
  meters: EnergyMeter[],
  devices: EnergyMeterDevice[],
  logs: EnergyReadingLog[]
): { lossKwh: number; lossPercent: number } {
  const incoming = totalIncomingEnergy(meters, devices, logs);
  const outgoing = totalOutgoingMainEnergy(meters, devices, logs);
  const lossKwh = incoming - outgoing;
  const lossPercent = incoming > 0 ? (lossKwh / incoming) * 100 : 0;
  return { lossKwh, lossPercent };
}

// ─── Full Dashboard Stats ───────────────────────────────────

export function computeEnergyDashboardStats(
  meters: EnergyMeter[],
  devices: EnergyMeterDevice[],
  logs: EnergyReadingLog[]
): EnergyDashboardStats {
  const incoming = totalIncomingEnergy(meters, devices, logs);
  const outMain = totalOutgoingMainEnergy(meters, devices, logs);
  const outSub = totalOutgoingSubEnergy(meters, devices, logs);
  const outSubSub = totalOutgoingSubSubEnergy(meters, devices, logs);
  const { lossKwh, lossPercent } = calculateSystemLoss(meters, devices, logs);

  return {
    totalIncoming: incoming,
    totalOutgoingMain: outMain,
    totalOutgoingSub: outSub,
    totalOutgoingSubSub: outSubSub,
    systemLoss: lossKwh,
    systemLossPercent: lossPercent,
    totalMeters: meters.filter((m) => m.is_active).length,
    totalDevices: devices.length,
    totalReadingsThisMonth: logs.length,
  };
}

// ─── Hierarchy Builder ──────────────────────────────────────

/** Build a tree of EnergyMeters by wiring parent/child relationships. */
export function buildMeterTree(meters: EnergyMeter[]): EnergyMeter[] {
  const map = new Map<string, EnergyMeter>();
  const roots: EnergyMeter[] = [];

  // Clone each meter with an empty children array
  meters.forEach((m) => {
    map.set(m.id, { ...m, children: [] });
  });

  map.forEach((m) => {
    if (m.parent_id && map.has(m.parent_id)) {
      map.get(m.parent_id)!.children!.push(m);
    } else {
      roots.push(m);
    }
  });

  return roots;
}

/** Group meters by section. */
export function groupMetersBySection(
  meters: EnergyMeter[]
): Record<string, EnergyMeter[]> {
  const groups: Record<string, EnergyMeter[]> = {
    incoming: [],
    outgoing_main: [],
    outgoing_sub: [],
    outgoing_sub_sub: [],
  };
  meters.forEach((m) => {
    if (groups[m.section]) {
      groups[m.section].push(m);
    }
  });
  return groups;
}

/** Group meters within a section by category. */
export function groupByCategory(meters: EnergyMeter[]): Record<string, EnergyMeter[]> {
  return meters.reduce<Record<string, EnergyMeter[]>>((acc, m) => {
    const cat = m.category || 'General';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(m);
    return acc;
  }, {});
}
