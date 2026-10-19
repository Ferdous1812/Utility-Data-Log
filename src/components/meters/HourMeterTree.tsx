'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import type {
  HourMeter,
  HourMeterDevice,
  HourReadingLog,
  HourEquipmentGroup,
} from '@/types/hour';
import {
  EditHourMeterModal,
  getHourMeterGroup,
} from './EditHourMeterModal';
import { useTierLabels } from '@/lib/useTierLabels';

// ─── Formatters ─────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const monthIndex = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, monthIndex, day);
      return format(d, 'dd MMM yyyy');
    }
    return format(new Date(dateStr), 'dd MMM yyyy');
  } catch {
    return dateStr;
  }
}

function formatReading(val: number | null): string {
  if (val == null || isNaN(val)) return '—';
  return val.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatUsage(val: number | null): string {
  if (val == null || isNaN(val)) return '—';
  return val.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMF(val: number): string {
  const intPart = Math.floor(Math.abs(val));
  const fracPart = Math.abs(val) - intPart;
  const sign = val < 0 ? '-' : '';
  return '×' + sign + String(intPart).padStart(3, '0') + '.' + fracPart.toFixed(2).slice(2);
}

// ─── Meter Reading Data Helper ──────────────────────────────

export function getHourBillingDevice(devices: HourMeterDevice[]): HourMeterDevice | undefined {
  if (devices.length === 0) return undefined;
  return devices.find((d) => d.is_billing_primary) || devices[0];
}

export function getHourMeterReadingData(
  meter: HourMeter,
  devices: HourMeterDevice[],
  logs: HourReadingLog[],
  priorReadings?: Record<string, HourReadingLog>
): {
  prevReading: number | null;
  prevDate: string | null;
  currentReading: number | null;
  currentDate: string | null;
  difference: number | null;
  mf: number;
  consumption: number;
} {
  const meterDevices = devices.filter((d) => d.meter_id === meter.id);
  const primaryDevice = getHourBillingDevice(meterDevices) || ({
    id: meter.id,
    meter_id: meter.id,
    checkpoint_label: 'Primary Meter',
    serial_number: '',
    is_billing_primary: true,
    sort_order: 0,
    created_at: (meter as any).created_at || '',
  } as HourMeterDevice);
  const mf = meter.multiplication_factor != null ? Number(meter.multiplication_factor) : 1;

  const deviceLogs = logs
    .filter(
      (l) =>
        l.device_id === primaryDevice.id ||
        l.device_id === meter.id ||
        (l.device && (l.device.meter_id === meter.id || (l.device.meter && l.device.meter.id === meter.id)))
    )
    .sort((a, b) => {
      const dateCmp = b.reading_date.localeCompare(a.reading_date);
      if (dateCmp !== 0) return dateCmp;
      return (b.created_at || '').localeCompare(a.created_at || '');
    });

  let currentReading: number | null = null;
  let currentDate: string | null = null;
  let prevReading: number | null = null;
  let prevDate: string | null = null;
  let difference: number | null = null;

  const priorLog = priorReadings
    ? priorReadings[primaryDevice.id] || priorReadings[meter.id] || null
    : null;

  if (deviceLogs.length > 0) {
    const currentLog = deviceLogs[0];
    currentReading = Number(currentLog.reading_value);
    currentDate = currentLog.reading_date;

    if (deviceLogs.length > 1) {
      const prevLog = deviceLogs[1];
      prevReading = Number(prevLog.reading_value);
      prevDate = prevLog.reading_date;
      difference = currentReading - prevReading;
    } else {
      if (priorLog) {
        prevReading = Number(priorLog.reading_value);
        prevDate = priorLog.reading_date;
        difference = currentReading - prevReading;
      } else if (currentLog.usage != null) {
        difference = Number(currentLog.usage);
        prevReading = currentReading - difference;
        prevDate = null;
      }
    }
  } else {
    if (priorLog) {
      prevReading = Number(priorLog.reading_value);
      prevDate = priorLog.reading_date;
    }
  }

  const consumption =
    difference != null
      ? difference * mf
      : 0;

  return {
    prevReading,
    prevDate,
    currentReading,
    currentDate,
    difference,
    mf,
    consumption,
  };
}

// ─── Group Meta ─────────────────────────────────────────────

interface GroupMeta {
  title: string;
  icon: string;
  description: string;
  badgeBg: string;
}

const GROUP_META: Record<HourEquipmentGroup, GroupMeta> = {
  Compressor: {
    title: 'Compressors',
    icon: '',
    description: 'Air compressors and compressed air machinery',
    badgeBg: 'bg-accent/10 text-accent border-accent/20',
  },
  Pump: {
    title: 'Pumps',
    icon: '',
    description: 'Feed water, cooling, condensate, and transfer pumps',
    badgeBg: 'bg-warning/10 text-warning border-warning/20',
  },
  Generator: {
    title: 'Generators',
    icon: '',
    description: 'Gas generators, diesel engines, and backup gensets',
    badgeBg: 'bg-success/10 text-success border-success/20',
  },
  Other: {
    title: 'Other Equipment',
    icon: '',
    description: 'Auxiliary plant equipment and utility machinery',
    badgeBg: 'bg-text-muted/10 text-text-secondary border-border/40',
  },
};

// ─── Group Accordion ────────────────────────────────────────

function GroupAccordion({
  groupKey,
  meters,
  devices,
  logs,
  priorReadings,
  defaultOpen = true,
  selectedMeterIds,
  onToggleSelect,
  onSelectAllInGroup,
  onEditMeter,
}: {
  groupKey: HourEquipmentGroup;
  meters: HourMeter[];
  devices: HourMeterDevice[];
  logs: HourReadingLog[];
  priorReadings?: Record<string, HourReadingLog>;
  defaultOpen?: boolean;
  selectedMeterIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAllInGroup: (meters: HourMeter[]) => void;
  onEditMeter: (meter: HourMeter) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const tierLabels = useTierLabels();
  const meta = GROUP_META[groupKey];
  const count = meters.length;

  const groupTitle =
    groupKey === 'Compressor' ? (tierLabels.hour_compressor || 'Compressors')
    : groupKey === 'Pump' ? (tierLabels.hour_pump || 'Pumps')
    : groupKey === 'Generator' ? (tierLabels.hour_generator || 'Generators')
    : (tierLabels.hour_other || 'Other Machinery');

  const allSelected =
    count > 0 && meters.every((m) => selectedMeterIds.has(m.id));

  // Compute total run hours for this group
  const groupHours = useMemo(() => {
    return meters.reduce((acc, m) => {
      const data = getHourMeterReadingData(m, devices, logs, priorReadings);
      return acc + (data.consumption || 0);
    }, 0);
  }, [meters, devices, logs, priorReadings]);

  return (
    <div className="bg-bg-surface border border-border rounded-[var(--radius-md)] overflow-hidden transition-all duration-200">
      {/* Header */}
      <div className="w-full flex items-center justify-between px-3.5 sm:px-4 py-2.5 hover:bg-bg-surface-hover transition-colors">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex-1 flex items-center justify-between text-left cursor-pointer min-w-0 mr-3"
        >
          <div className="min-w-0 flex items-center gap-2">
            <h3 className="text-xs sm:text-sm font-semibold text-text-primary truncate">{groupTitle}</h3>
            <span className="hidden sm:inline text-[11px] text-text-muted truncate">· {meta.description}</span>
          </div>

          <div className="flex items-center gap-2 ml-2">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${meta.badgeBg}`}>
              {groupHours.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} hrs
            </span>
            <span className="text-[11px] text-text-muted font-medium bg-bg-elevated px-2 py-0.5 rounded border border-border/40">
              {count} meter{count !== 1 ? 's' : ''}
            </span>
          </div>
        </button>

        <div className="flex items-center gap-2 flex-shrink-0">
          {count > 0 && (
            <button
              type="button"
              onClick={() => onSelectAllInGroup(meters)}
              title={allSelected ? 'Deselect group' : 'Select all in group'}
              className="text-[11px] text-text-muted hover:text-accent font-medium px-1.5 py-0.5 rounded hover:bg-bg-surface-hover/80 transition-colors cursor-pointer"
            >
              {allSelected ? 'Deselect All' : 'Select Group'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="p-1 rounded text-text-muted hover:text-text-primary cursor-pointer"
            aria-label="Toggle accordion"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      {open && (
        <div className="border-t border-border px-2 sm:px-3 py-2.5 animate-fade-in">
          {count === 0 ? (
            <div className="text-center py-4">
              <p className="text-xs text-text-muted">No {groupTitle.toLowerCase()} configured yet.</p>
            </div>
          ) : (
            <HourMeterTable
              meters={meters}
              devices={devices}
              logs={logs}
              priorReadings={priorReadings}
              selectedMeterIds={selectedMeterIds}
              onToggleSelect={onToggleSelect}
              onEditMeter={onEditMeter}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Meter Table List ───────────────────────────────────────

function HourMeterTable({
  meters,
  devices,
  logs,
  priorReadings,
  selectedMeterIds,
  onToggleSelect,
  onEditMeter,
}: {
  meters: HourMeter[];
  devices: HourMeterDevice[];
  logs: HourReadingLog[];
  priorReadings?: Record<string, HourReadingLog>;
  selectedMeterIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onEditMeter: (meter: HourMeter) => void;
}) {
  return (
    <div className="overflow-x-auto border border-border/80 rounded-[var(--radius-md)] bg-bg-elevated shadow-xs">
      <table className="w-full text-xs border-collapse table-fixed min-w-[780px]">
        <colgroup>
          <col className="w-[120px] sm:w-[150px]" />
          <col className="w-[95px]" />
          <col className="w-[85px]" />
          <col className="w-[110px]" />
          <col className="w-[85px]" />
          <col className="w-[85px]" />
          <col className="w-[65px]" />
          <col className="w-[100px]" />
        </colgroup>
        <thead className="sticky top-0 z-20 bg-table-header text-[10px] font-bold uppercase tracking-wider text-white border-b border-border select-none">
          <tr>
            <th className="sticky left-0 z-30 bg-table-header px-2.5 py-1.5 text-left text-white">
              Meter Name
            </th>
            <th className="px-2 py-1.5 text-right whitespace-nowrap text-white">
              Prev Reading
            </th>
            <th className="px-1.5 py-1.5 text-center whitespace-nowrap text-white">
              Prev Date
            </th>
            <th className="px-2 py-1.5 text-right whitespace-nowrap text-white">
              Current Reading
            </th>
            <th className="px-1.5 py-1.5 text-center whitespace-nowrap text-white">
              Current Date
            </th>
            <th className="px-2 py-1.5 text-right whitespace-nowrap text-white">
              Difference
            </th>
            <th className="px-1 py-1.5 text-center whitespace-nowrap text-white">
              MF
            </th>
            <th className="px-2.5 py-1.5 text-right whitespace-nowrap text-white">
              Run Hours
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {meters.map((meter) => (
            <HourMeterTableRow
              key={meter.id}
              meter={meter}
              devices={devices}
              logs={logs}
              priorReadings={priorReadings}
              isSelected={selectedMeterIds.has(meter.id)}
              onToggleSelect={onToggleSelect}
              onEditMeter={onEditMeter}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Single Meter Table Row ─────────────────────────────────

function HourMeterTableRow({
  meter,
  devices,
  logs,
  priorReadings,
  isSelected,
  onToggleSelect,
  onEditMeter,
}: {
  meter: HourMeter;
  devices: HourMeterDevice[];
  logs: HourReadingLog[];
  priorReadings?: Record<string, HourReadingLog>;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onEditMeter: (meter: HourMeter) => void;
}) {
  const data = getHourMeterReadingData(meter, devices, logs, priorReadings);

  return (
    <tr
      onClick={() => onToggleSelect(meter.id)}
      className={`transition-colors cursor-pointer select-none ${
        isSelected
          ? 'bg-accent/10 hover:bg-accent/15'
          : 'hover:bg-bg-surface-hover/70'
      }`}
    >
      {/* Meter Name + Selection Checkbox + Status Dot */}
      <td
        className={`sticky left-0 z-10 px-2.5 py-1.5 transition-colors ${
          isSelected ? 'bg-bg-surface/90' : 'bg-bg-elevated'
        }`}
      >
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => {}}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect(meter.id);
              }}
              className="w-3.5 h-3.5 accent-accent rounded cursor-pointer flex-shrink-0"
              aria-label={`Select ${meter.name}`}
            />
            <span
              className="w-2 h-2 rounded-full flex-shrink-0 bg-success"
              title="Active Meter"
            />
            <span className="font-semibold text-text-primary truncate text-xs">
              {meter.name}
            </span>
          </div>

          {/* Edit icon */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEditMeter(meter);
            }}
            title="Edit meter name & group"
            className="p-1 rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors flex-shrink-0 cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
        </div>
      </td>

      {/* Previous Reading */}
      <td className="px-2 py-1.5 text-right tabular-nums text-text-muted font-medium whitespace-nowrap text-xs">
        {formatReading(data.prevReading)}
      </td>

      {/* Previous Date */}
      <td className="px-1.5 py-1.5 text-center text-[11px] text-text-muted whitespace-nowrap">
        {formatDate(data.prevDate)}
      </td>

      {/* Current Reading */}
      <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-text-primary whitespace-nowrap text-xs">
        {formatReading(data.currentReading)}
      </td>

      {/* Current Date */}
      <td className="px-1.5 py-1.5 text-center text-[11px] text-text-secondary whitespace-nowrap">
        {formatDate(data.currentDate)}
      </td>

      {/* Difference */}
      <td className="px-2 py-1.5 text-right tabular-nums font-medium text-text-secondary whitespace-nowrap text-xs">
        {data.difference != null ? formatReading(data.difference) : '—'}
      </td>

      {/* Multiplication Factor (MF) */}
      <td className="px-1 py-1.5 text-center text-[11px] text-text-muted whitespace-nowrap">
        {formatMF(data.mf)}
      </td>

      {/* Run Hours */}
      <td className="px-2.5 py-1.5 text-right tabular-nums font-bold text-accent whitespace-nowrap text-xs">
        {formatUsage(data.consumption)}
      </td>
    </tr>
  );
}

// ─── Main HourMeterTree Component ───────────────────────────

export function HourMeterTree({
  meters,
  devices,
  logs,
  priorReadings,
}: {
  meters: HourMeter[];
  devices: HourMeterDevice[];
  logs: HourReadingLog[];
  priorReadings?: Record<string, HourReadingLog>;
}) {
  const router = useRouter();
  const [selectedMeterIds, setSelectedMeterIds] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [editingMeter, setEditingMeter] = useState<HourMeter | null>(null);

  // Group meters into Compressor, Pump, Generator, Other
  const groupedMeters = useMemo(() => {
    const groups: Record<HourEquipmentGroup, HourMeter[]> = {
      Compressor: [],
      Pump: [],
      Generator: [],
      Other: [],
    };

    meters.forEach((m) => {
      const g = getHourMeterGroup(m);
      groups[g].push(m);
    });

    return groups;
  }, [meters]);

  // Toggle selection
  const handleToggleSelect = (id: string) => {
    setSelectedMeterIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select/deselect all meters in a group
  const handleSelectAllInGroup = (groupMeters: HourMeter[]) => {
    const ids = groupMeters.map((m) => m.id);
    const allSelected = ids.every((id) => selectedMeterIds.has(id));

    setSelectedMeterIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  // Clear all selections
  const handleClearSelection = () => {
    setSelectedMeterIds(new Set());
  };

  // Compute selected sum
  const { selectedCount, selectedSum } = useMemo(() => {
    if (selectedMeterIds.size === 0) {
      return { selectedCount: 0, selectedSum: 0 };
    }

    let sum = 0;
    meters.forEach((m) => {
      if (selectedMeterIds.has(m.id)) {
        const data = getHourMeterReadingData(m, devices, logs, priorReadings);
        sum += data.consumption || 0;
      }
    });

    return {
      selectedCount: selectedMeterIds.size,
      selectedSum: sum,
    };
  }, [selectedMeterIds, meters, devices, logs, priorReadings]);

  // Copy sum to clipboard
  const handleCopySum = async () => {
    try {
      await navigator.clipboard.writeText(
        selectedSum.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  // Handle edit success
  const handleEditSuccess = () => {
    router.refresh();
  };

  const allGroups: HourEquipmentGroup[] = ['Compressor', 'Pump', 'Generator', 'Other'];
  const activeGroups = allGroups.filter((g) => groupedMeters[g].length > 0);

  return (
    <div className="space-y-3 pb-24">
      {/* Groups (Compressor, Pump, Generator, Other) */}
      {activeGroups.map((groupKey) => (
        <GroupAccordion
          key={groupKey}
          groupKey={groupKey}
          meters={groupedMeters[groupKey]}
          devices={devices}
          logs={logs}
          priorReadings={priorReadings}
          defaultOpen={true}
          selectedMeterIds={selectedMeterIds}
          onToggleSelect={handleToggleSelect}
          onSelectAllInGroup={handleSelectAllInGroup}
          onEditMeter={(meter) => setEditingMeter(meter)}
        />
      ))}

      {meters.length === 0 && (
        <div className="bg-bg-surface border border-border rounded-[var(--radius-md)] p-8 text-center">
          <h3 className="text-sm font-semibold text-text-primary mb-1">No Hour Meters Found</h3>
          <p className="text-xs text-text-muted max-w-sm mx-auto mb-4">
            Click &ldquo;Manage Meters&rdquo; in the top-right to include hour meters in this tracking tree.
          </p>
        </div>
      )}

      {/* Floating Summation Footer Card */}
      {selectedCount > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 animate-fade-in w-[95%] max-w-xl pointer-events-auto">
          <div className="flex items-center justify-between gap-3 px-3.5 py-1.5 sm:py-2 rounded-[var(--radius-lg)] bg-bg-surface/95 backdrop-blur-md border border-border shadow-lg">
            {/* Left: Badge & count */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-5 h-5 rounded-full bg-accent/15 flex items-center justify-center text-accent font-bold text-xs flex-shrink-0">
                ∑
              </div>
              <span className="text-[11px] font-semibold text-text-primary whitespace-nowrap">
                {selectedCount} meter{selectedCount !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Center: Sum */}
            <div className="flex items-baseline gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] bg-bg-elevated border border-border/60">
              <span className="text-xs sm:text-sm font-bold text-accent tabular-nums">
                {selectedSum.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span className="text-[10px] font-semibold text-text-secondary">hrs</span>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={handleCopySum}
                title="Copy sum to clipboard"
                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-[var(--radius-sm)] border border-border hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
              >
                {copied ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-success">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span className="text-success">Copied</span>
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    <span className="hidden sm:inline">Copy</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleClearSelection}
                title="Clear selection"
                className="p-1 rounded-[var(--radius-sm)] text-text-muted hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                aria-label="Clear selection"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Hour Meter Modal */}
      <EditHourMeterModal
        open={!!editingMeter}
        onClose={() => setEditingMeter(null)}
        meter={editingMeter}
        onSuccess={handleEditSuccess}
      />
    </div>
  );
}
