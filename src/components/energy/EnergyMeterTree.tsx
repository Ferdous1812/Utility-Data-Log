'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import type {
  EnergyMeter,
  EnergyMeterDevice,
  EnergyReadingLog,
  EnergyMeterSection,
} from '@/types/energy';
import { ENERGY_SECTION_META } from '@/types/energy';
import {
  getBillingDevice,
  getMeterBranches,
  isSplitMeter,
  deviceUsageInRange,
  meterUsageInRange,
  groupMetersBySection,
  groupByCategory,
} from '@/lib/calculations/energy';
import { EditMeterNameModal } from './EditMeterNameModal';

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

type MeterReadingData = {
  prevReading: number | null;
  prevDate: string | null;
  currentReading: number | null;
  currentDate: string | null;
  difference: number | null;
  mf: number;
  consumption: number;
};

/** Reading data for ONE device (checkpoint primary device, or one split branch). */
function getDeviceReadingData(
  meter: EnergyMeter,
  device: EnergyMeterDevice,
  logs: EnergyReadingLog[],
  priorReadings: Record<string, EnergyReadingLog> | undefined,
  fallbackUsage: number
): MeterReadingData {
  const mf = meter.multiplication_factor != null ? Number(meter.multiplication_factor) : 1;

  // Device logs for the current selected month sorted latest first
  const deviceLogs = logs
    .filter((l) => l.device_id === device.id)
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

  if (deviceLogs.length > 0) {
    const currentLog = deviceLogs[0];
    currentReading = Number(currentLog.reading_value);
    currentDate = currentLog.reading_date;

    if (deviceLogs.length > 1) {
      // Multiple logs in month: previous log is the second newest
      const prevLog = deviceLogs[1];
      prevReading = Number(prevLog.reading_value);
      prevDate = prevLog.reading_date;
      difference = currentReading - prevReading;
    } else {
      // Single log in month: check prior month readings
      const priorLog = priorReadings ? priorReadings[device.id] : null;
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
    // No logs in the current month: check if a prior reading exists
    const priorLog = priorReadings ? priorReadings[device.id] : null;
    if (priorLog) {
      prevReading = Number(priorLog.reading_value);
      prevDate = priorLog.reading_date;
    }
  }

  // Calculate final consumption
  const consumption = difference != null ? difference * mf : fallbackUsage;

  return { prevReading, prevDate, currentReading, currentDate, difference, mf, consumption };
}

/** One branch (e.g. Peak / Off-Peak) of a split meter, with its own reading data. */
export function getBranchReadingData(
  meter: EnergyMeter,
  devices: EnergyMeterDevice[],
  logs: EnergyReadingLog[],
  priorReadings?: Record<string, EnergyReadingLog>
): { device: EnergyMeterDevice; data: MeterReadingData }[] {
  const mf = meter.multiplication_factor != null ? Number(meter.multiplication_factor) : 1;
  return getMeterBranches(meter, devices).map((device) => ({
    device,
    data: getDeviceReadingData(
      meter,
      device,
      logs,
      priorReadings,
      deviceUsageInRange(logs, device.id) * mf
    ),
  }));
}

export function getMeterReadingData(
  meter: EnergyMeter,
  devices: EnergyMeterDevice[],
  logs: EnergyReadingLog[],
  priorReadings?: Record<string, EnergyReadingLog>
): MeterReadingData {
  const meterDevices = devices.filter((d) => d.meter_id === meter.id);
  const mf = meter.multiplication_factor != null ? Number(meter.multiplication_factor) : 1;

  // Split meter (Peak + Off-Peak …): show the SUM of all branches
  if (isSplitMeter(meter)) {
    const branches = getBranchReadingData(meter, devices, logs, priorReadings);
    const diffs = branches.map((b) => b.data.difference).filter((d): d is number => d != null);
    return {
      prevReading: null,
      prevDate: null,
      currentReading: null,
      currentDate: null,
      difference: diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) : null,
      mf,
      consumption: branches.reduce((sum, b) => sum + b.data.consumption, 0),
    };
  }

  const primaryDevice = getBillingDevice(meterDevices);

  if (!primaryDevice) {
    return {
      prevReading: null,
      prevDate: null,
      currentReading: null,
      currentDate: null,
      difference: null,
      mf,
      consumption: 0,
    };
  }

  return getDeviceReadingData(
    meter,
    primaryDevice,
    logs,
    priorReadings,
    meterUsageInRange(meter, devices, logs)
  );
}

// ─── Section Accordion ──────────────────────────────────────

function SectionAccordion({
  section,
  meters,
  devices,
  logs,
  priorReadings,
  defaultOpen = false,
  isOpen,
  onToggleOpen,
  selectedMeterIds,
  onToggleSelect,
  onSelectAllInSection,
  onEditMeter,
}: {
  section: EnergyMeterSection;
  meters: EnergyMeter[];
  devices: EnergyMeterDevice[];
  logs: EnergyReadingLog[];
  priorReadings?: Record<string, EnergyReadingLog>;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onToggleOpen?: () => void;
  selectedMeterIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAllInSection: (meters: EnergyMeter[]) => void;
  onEditMeter: (meter: EnergyMeter) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const handleToggle = () => (onToggleOpen ? onToggleOpen() : setInternalOpen(!internalOpen));
  const meta = ENERGY_SECTION_META[section];
  const count = meters.length;

  const allInSectionSelected =
    count > 0 && meters.every((m) => selectedMeterIds.has(m.id));

  return (
    <div
      className="bg-bg-surface border border-border rounded-[var(--radius-md)] overflow-hidden transition-all duration-200"
    >
      {/* Header */}
      <div className="w-full flex items-center justify-between px-3.5 sm:px-4 py-2.5 hover:bg-bg-surface-hover transition-colors">
        <button
          type="button"
          onClick={handleToggle}
          className="flex-1 flex items-center justify-between text-left cursor-pointer min-w-0 mr-3"
        >
          <div className="min-w-0 flex items-center gap-2">
            <h3 className="text-xs sm:text-sm font-semibold text-text-primary truncate">{meta.label}</h3>
            <span className="hidden sm:inline text-[11px] text-text-muted truncate">· {meta.description}</span>
          </div>
          <span className="text-[11px] text-text-muted font-medium bg-bg-elevated px-2 py-0.5 rounded border border-border/40 ml-2">
            {count} meter{count !== 1 ? 's' : ''}
          </span>
        </button>

        <div className="flex items-center gap-2 flex-shrink-0">
          {count > 0 && (
            <button
              type="button"
              onClick={() => onSelectAllInSection(meters)}
              title={allInSectionSelected ? 'Deselect section' : 'Select all in section'}
              className="text-[11px] text-text-muted hover:text-accent font-medium px-1.5 py-0.5 rounded hover:bg-bg-surface-hover/80 transition-colors cursor-pointer"
            >
              {allInSectionSelected ? 'Deselect All' : 'Select Section'}
            </button>
          )}

          <button
            type="button"
            onClick={handleToggle}
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
          {section === 'incoming' ? (
            <IncomingMetersByCategory
              meters={meters}
              devices={devices}
              logs={logs}
              priorReadings={priorReadings}
              selectedMeterIds={selectedMeterIds}
              onToggleSelect={onToggleSelect}
              onEditMeter={onEditMeter}
            />
          ) : (
            <MeterList
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

// ─── Incoming meters grouped by category ────────────────────

function IncomingMetersByCategory({
  meters,
  devices,
  logs,
  priorReadings,
  selectedMeterIds,
  onToggleSelect,
  onEditMeter,
}: {
  meters: EnergyMeter[];
  devices: EnergyMeterDevice[];
  logs: EnergyReadingLog[];
  priorReadings?: Record<string, EnergyReadingLog>;
  selectedMeterIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onEditMeter: (meter: EnergyMeter) => void;
}) {
  const categories = groupByCategory(meters);
  const categoryEntries = Object.entries(categories);

  if (categoryEntries.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col gap-3">
      {categoryEntries.map(([category, catMeters]) => (
        <div key={category}>
          <div className="flex items-center gap-2 mb-1.5 px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              {category}
            </span>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <MeterList
            meters={catMeters}
            devices={devices}
            logs={logs}
            priorReadings={priorReadings}
            selectedMeterIds={selectedMeterIds}
            onToggleSelect={onToggleSelect}
            onEditMeter={onEditMeter}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Meter Table List ───────────────────────────────────────

function MeterList({
  meters,
  devices,
  logs,
  priorReadings,
  selectedMeterIds,
  onToggleSelect,
  onEditMeter,
}: {
  meters: EnergyMeter[];
  devices: EnergyMeterDevice[];
  logs: EnergyReadingLog[];
  priorReadings?: Record<string, EnergyReadingLog>;
  selectedMeterIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onEditMeter: (meter: EnergyMeter) => void;
}) {
  if (meters.length === 0) {
    return <EmptyState />;
  }

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
              Consumption
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {meters.map((meter) => (
            <MeterTableRow
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

function MeterTableRow({
  meter,
  devices,
  logs,
  priorReadings,
  isSelected,
  onToggleSelect,
  onEditMeter,
  level = 0,
  childCount = 0,
  isCollapsed = false,
  onToggleCollapse,
  isHierarchyView = false,
}: {
  meter: EnergyMeter;
  devices: EnergyMeterDevice[];
  logs: EnergyReadingLog[];
  priorReadings?: Record<string, EnergyReadingLog>;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onEditMeter: (meter: EnergyMeter) => void;
  level?: number;
  childCount?: number;
  isCollapsed?: boolean;
  onToggleCollapse?: (id: string) => void;
  isHierarchyView?: boolean;
}) {
  const isPrimary = meter.is_primary_for_total;
  const data = getMeterReadingData(meter, devices, logs, priorReadings);
  const split = isSplitMeter(meter);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const branches = split ? getBranchReadingData(meter, devices, logs, priorReadings) : [];

  const plClass = !isHierarchyView
    ? 'px-2.5'
    : level === 0
    ? 'pl-2.5 pr-2'
    : level === 1
    ? 'pl-6 pr-2'
    : level === 2
    ? 'pl-10 pr-2'
    : level === 3
    ? 'pl-14 pr-2'
    : 'pl-18 pr-2';

  const branchPrefix =
    level === 1 ? '└─ ' :
    level === 2 ? '└─── ' :
    level >= 3 ? '└───── ' :
    '';

  const branchColor =
    level === 1 ? 'text-accent/80' :
    level === 2 ? 'text-success/80' :
    'text-danger/80';

  return (
    <>
    <tr
      onClick={() => onToggleSelect(meter.id)}
      className={`transition-colors cursor-pointer select-none ${
        isSelected
          ? 'bg-accent/10 hover:bg-accent/15'
          : isHierarchyView
          ? level >= 2
            ? 'bg-bg-primary/50 hover:bg-bg-surface-hover/70'
            : level === 1
            ? 'bg-bg-primary/25 hover:bg-bg-surface-hover/70'
            : 'hover:bg-bg-surface-hover/70'
          : 'hover:bg-bg-surface-hover/70'
      }`}
    >
      {/* Meter Name + Selection Checkbox + Status Dot */}
      <td
        className={`sticky left-0 z-10 py-1.5 transition-colors ${plClass} ${
          isSelected
            ? 'bg-bg-surface/90'
            : isHierarchyView && level > 0
            ? 'bg-bg-elevated/95'
            : 'bg-bg-elevated'
        }`}
      >
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {/* Tree branch connector */}
            {isHierarchyView && level > 0 && (
              <span className={`font-mono text-[11px] shrink-0 font-bold ${branchColor}`}>
                {branchPrefix}
              </span>
            )}

            {/* Split meter breakdown button */}
            {split && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setBranchesOpen((o) => !o);
                }}
                className="p-0.5 -m-0.5 rounded hover:bg-bg-surface-hover/80 cursor-pointer text-text-muted flex-shrink-0"
                title={branchesOpen ? 'Hide breakdown' : 'Show breakdown'}
                aria-label={`${branchesOpen ? 'Collapse' : 'Expand'} ${meter.name} breakdown`}
                aria-expanded={branchesOpen}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`transition-transform ${branchesOpen ? 'rotate-90' : ''}`}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            )}

            {/* Selection Checkbox */}
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(meter.id)}
              onClick={(e) => e.stopPropagation()}
              className="w-3.5 h-3.5 rounded border-border text-accent focus:ring-accent/20 cursor-pointer accent-accent flex-shrink-0"
              aria-label={`Select ${meter.name}`}
            />

            {/* Tree collapse/expand button (if meter has children in hierarchy view) */}
            {isHierarchyView && childCount > 0 ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapse?.(meter.id);
                }}
                className="p-0.5 text-accent hover:bg-accent/10 rounded transition-all flex items-center gap-1.5 focus:outline-none min-w-0 cursor-pointer"
                title={isCollapsed ? 'Expand child meters' : 'Collapse child meters'}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className={`shrink-0 transition-transform duration-200 ${
                    isCollapsed ? '-rotate-90 text-text-muted' : 'rotate-0 text-accent'
                  }`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <span className="truncate text-xs font-semibold text-text-primary" title={meter.name}>
                  {meter.name}
                </span>
                <span className="text-[10px] font-normal px-1.5 py-0.2 rounded-full bg-accent/15 text-accent shrink-0">
                  {childCount}
                </span>
              </button>
            ) : (
              <span
                className={`truncate text-xs ${
                  isHierarchyView && level > 0 ? 'text-text-secondary' : 'font-medium text-text-primary'
                }`}
                title={meter.name}
              >
                {meter.name}
              </span>
            )}
          </div>

          {/* Edit status dot */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEditMeter(meter);
            }}
            className="p-1 -m-1 rounded-full hover:bg-bg-surface-hover/80 transition-all cursor-pointer flex items-center justify-center group/dot flex-shrink-0"
            title={`Click to edit ${meter.name} (${isPrimary ? 'Primary' : 'Non-Primary'})`}
            aria-label={`Edit ${meter.name}`}
          >
            {isPrimary ? (
              <span
                className="w-2 h-2 rounded-full bg-success ring-2 ring-success/25 group-hover/dot:scale-125 transition-transform"
              />
            ) : (
              <span
                className="w-2 h-2 rounded-full bg-danger ring-2 ring-danger/25 group-hover/dot:scale-125 transition-transform"
              />
            )}
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

      {/* Consumption */}
      <td className="px-2.5 py-1.5 text-right tabular-nums font-bold text-accent whitespace-nowrap text-xs">
        {formatUsage(data.consumption)}
      </td>
    </tr>

    {split && branchesOpen && branches.map(({ device, data: bd }) => (
      <tr key={device.id} className="bg-bg-surface/40">
        <td
          className={`sticky left-0 z-10 bg-bg-elevated pr-2.5 py-1 ${
            isHierarchyView
              ? level === 0 ? 'pl-9' : level === 1 ? 'pl-14' : level === 2 ? 'pl-18' : 'pl-22'
              : 'pl-9'
          }`}
        >
          <span className="text-[11px] text-text-secondary truncate" title={device.checkpoint_label}>
            {device.checkpoint_label}
          </span>
        </td>
        <td className="px-2 py-1 text-right tabular-nums text-text-muted text-[11px] whitespace-nowrap">
          {formatReading(bd.prevReading)}
        </td>
        <td className="px-1.5 py-1 text-center text-[10px] text-text-muted whitespace-nowrap">
          {formatDate(bd.prevDate)}
        </td>
        <td className="px-2 py-1 text-right tabular-nums text-text-primary text-[11px] whitespace-nowrap">
          {formatReading(bd.currentReading)}
        </td>
        <td className="px-1.5 py-1 text-center text-[10px] text-text-secondary whitespace-nowrap">
          {formatDate(bd.currentDate)}
        </td>
        <td className="px-2 py-1 text-right tabular-nums text-text-secondary text-[11px] whitespace-nowrap">
          {bd.difference != null ? formatReading(bd.difference) : '—'}
        </td>
        <td className="px-1 py-1 text-center text-[10px] text-text-muted whitespace-nowrap">
          {formatMF(bd.mf)}
        </td>
        <td className="px-2.5 py-1 text-right tabular-nums text-accent text-[11px] whitespace-nowrap">
          {formatUsage(bd.consumption)}
        </td>
      </tr>
    ))}
    </>
  );
}

// ─── Hierarchy / Mother-Child Tree View (same pattern as Settings page) ───

function HierarchyMeterView({
  meters,
  devices,
  logs,
  priorReadings,
  selectedMeterIds,
  collapsedMeterIds,
  onToggleSelect,
  onSelectGroup,
  onToggleCollapse,
  onEditMeter,
}: {
  meters: EnergyMeter[];
  devices: EnergyMeterDevice[];
  logs: EnergyReadingLog[];
  priorReadings?: Record<string, EnergyReadingLog>;
  selectedMeterIds: Set<string>;
  collapsedMeterIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectGroup: (groupMeters: EnergyMeter[]) => void;
  onToggleCollapse: (id: string) => void;
  onEditMeter: (meter: EnergyMeter) => void;
}) {
  const meterIds = useMemo(() => new Set(meters.map((m) => m.id)), [meters]);

  const sortMeters = useCallback(
    (list: EnergyMeter[]) =>
      [...list].sort((a, b) => {
        const soA = a.sort_order ?? 0;
        const soB = b.sort_order ?? 0;
        if (soA !== soB) return soA - soB;
        return a.name.localeCompare(b.name);
      }),
    []
  );

  // Incoming Feeders / Roots (incoming)
  const incomingRoots = useMemo(
    () => sortMeters(meters.filter((m) => m.section === 'incoming' && (!m.parent_id || !meterIds.has(m.parent_id)))),
    [meters, meterIds, sortMeters]
  );

  // Standalone Mother Panels that are NOT children of incoming meters in this list
  const standaloneMotherRoots = useMemo(
    () => sortMeters(meters.filter((m) => m.section === 'outgoing_main' && (!m.parent_id || !meterIds.has(m.parent_id)))),
    [meters, meterIds, sortMeters]
  );

  // Unassigned Submeters (submeters whose parent is missing or not in this list)
  const unassignedSubMeters = useMemo(
    () => sortMeters(meters.filter((m) => (m.section === 'outgoing_sub' || m.section === 'outgoing_sub_sub') && (!m.parent_id || !meterIds.has(m.parent_id)))),
    [meters, meterIds, sortMeters]
  );

  // Helper to collect all meters in a subtree recursively
  const getSubtreeMeters = useCallback(
    (root: EnergyMeter): EnergyMeter[] => {
      const list: EnergyMeter[] = [root];
      const children = sortMeters(meters.filter((m) => m.parent_id === root.id));
      for (const child of children) {
        list.push(...getSubtreeMeters(child));
      }
      return list;
    },
    [meters, sortMeters]
  );

  const getGroupMeters = useCallback(
    (roots: EnergyMeter[]): EnergyMeter[] => {
      const set = new Set<string>();
      const result: EnergyMeter[] = [];
      roots.forEach((root) => {
        getSubtreeMeters(root).forEach((m) => {
          if (!set.has(m.id)) {
            set.add(m.id);
            result.push(m);
          }
        });
      });
      return result;
    },
    [getSubtreeMeters]
  );

  const incomingGroupMeters = useMemo(() => getGroupMeters(incomingRoots), [getGroupMeters, incomingRoots]);
  const standaloneGroupMeters = useMemo(() => getGroupMeters(standaloneMotherRoots), [getGroupMeters, standaloneMotherRoots]);
  const unassignedGroupMeters = useMemo(() => getGroupMeters(unassignedSubMeters), [getGroupMeters, unassignedSubMeters]);

  // Remaining meters (if any, e.g. custom sections or circular refs)
  const allCategorizedIds = useMemo(
    () => new Set([...incomingGroupMeters, ...standaloneGroupMeters, ...unassignedGroupMeters].map((m) => m.id)),
    [incomingGroupMeters, standaloneGroupMeters, unassignedGroupMeters]
  );
  const otherRoots = useMemo(
    () => sortMeters(meters.filter((m) => !allCategorizedIds.has(m.id) && (!m.parent_id || !meterIds.has(m.parent_id)))),
    [meters, allCategorizedIds, meterIds, sortMeters]
  );
  const otherGroupMeters = useMemo(() => getGroupMeters(otherRoots), [getGroupMeters, otherRoots]);

  const incomingAllSelected = incomingGroupMeters.length > 0 && incomingGroupMeters.every((m) => selectedMeterIds.has(m.id));
  const standaloneAllSelected = standaloneGroupMeters.length > 0 && standaloneGroupMeters.every((m) => selectedMeterIds.has(m.id));
  const unassignedAllSelected = unassignedGroupMeters.length > 0 && unassignedGroupMeters.every((m) => selectedMeterIds.has(m.id));
  const otherAllSelected = otherGroupMeters.length > 0 && otherGroupMeters.every((m) => selectedMeterIds.has(m.id));

  // Recursive node renderer
  const renderMeterNode = (meter: EnergyMeter, level = 0): React.ReactNode => {
    const children = sortMeters(meters.filter((m) => m.parent_id === meter.id));
    const isCollapsed = collapsedMeterIds.has(meter.id);

    return (
      <React.Fragment key={meter.id}>
        <MeterTableRow
          meter={meter}
          devices={devices}
          logs={logs}
          priorReadings={priorReadings}
          isSelected={selectedMeterIds.has(meter.id)}
          onToggleSelect={onToggleSelect}
          onEditMeter={onEditMeter}
          level={level}
          childCount={children.length}
          isCollapsed={isCollapsed}
          onToggleCollapse={onToggleCollapse}
          isHierarchyView={true}
        />
        {!isCollapsed &&
          children.map((child) => renderMeterNode(child, level + 1))}
      </React.Fragment>
    );
  };

  if (meters.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="overflow-x-auto border border-border/80 rounded-[var(--radius-md)] bg-bg-elevated shadow-xs animate-fade-in">
      <table className="w-full text-xs border-collapse table-fixed min-w-[840px]">
        <colgroup>
          <col className="w-[180px] sm:w-[260px]" />
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
              Meter Hierarchy & Name
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
              Consumption
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {/* Incoming Feeders & Sources */}
          {incomingRoots.length > 0 && (
            <>
              <tr className="bg-warning/10 border-y border-warning/20">
                <td colSpan={8} className="px-2.5 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-warning text-[10px] uppercase tracking-wider">
                      Incoming Feeders & Sources ({incomingGroupMeters.length} meter{incomingGroupMeters.length !== 1 ? 's' : ''})
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelectGroup(incomingGroupMeters)}
                      className="text-[10px] text-text-muted hover:text-warning font-medium px-1.5 py-0.5 rounded hover:bg-warning/10 transition-colors cursor-pointer"
                    >
                      {incomingAllSelected ? 'Deselect Group' : 'Select Group'}
                    </button>
                  </div>
                </td>
              </tr>
              {incomingRoots.map((root) => renderMeterNode(root, 0))}
            </>
          )}

          {/* Standalone Mother Panels & Feeder Trees */}
          {standaloneMotherRoots.length > 0 && (
            <>
              <tr className="bg-accent/10 border-y border-accent/20">
                <td colSpan={8} className="px-2.5 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-accent text-[10px] uppercase tracking-wider">
                      Standalone Mother Panels & Feeder Trees ({standaloneGroupMeters.length} meter{standaloneGroupMeters.length !== 1 ? 's' : ''})
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelectGroup(standaloneGroupMeters)}
                      className="text-[10px] text-text-muted hover:text-accent font-medium px-1.5 py-0.5 rounded hover:bg-accent/10 transition-colors cursor-pointer"
                    >
                      {standaloneAllSelected ? 'Deselect Group' : 'Select Group'}
                    </button>
                  </div>
                </td>
              </tr>
              {standaloneMotherRoots.map((root) => renderMeterNode(root, 0))}
            </>
          )}

          {/* Unassigned Submeters (if any) */}
          {unassignedSubMeters.length > 0 && (
            <>
              <tr className="bg-danger/10 border-y border-danger/20">
                <td colSpan={8} className="px-2.5 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-danger text-[10px] uppercase tracking-wider">
                      Unassigned Submeters ({unassignedGroupMeters.length} meter{unassignedGroupMeters.length !== 1 ? 's' : ''})
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelectGroup(unassignedGroupMeters)}
                      className="text-[10px] text-text-muted hover:text-danger font-medium px-1.5 py-0.5 rounded hover:bg-danger/10 transition-colors cursor-pointer"
                    >
                      {unassignedAllSelected ? 'Deselect Group' : 'Select Group'}
                    </button>
                  </div>
                </td>
              </tr>
              {unassignedSubMeters.map((root) => renderMeterNode(root, 0))}
            </>
          )}

          {/* Other / Uncategorized Meters (if any) */}
          {otherRoots.length > 0 && (
            <>
              <tr className="bg-bg-surface-hover/80 border-y border-border">
                <td colSpan={8} className="px-2.5 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-text-secondary text-[10px] uppercase tracking-wider">
                      Other Meters ({otherGroupMeters.length} meter{otherGroupMeters.length !== 1 ? 's' : ''})
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelectGroup(otherGroupMeters)}
                      className="text-[10px] text-text-muted hover:text-accent font-medium px-1.5 py-0.5 rounded hover:bg-bg-surface-hover transition-colors cursor-pointer"
                    >
                      {otherAllSelected ? 'Deselect Group' : 'Select Group'}
                    </button>
                  </div>
                </td>
              </tr>
              {otherRoots.map((root) => renderMeterNode(root, 0))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="text-center py-4">
      <p className="text-xs text-text-muted">No meters in this section yet.</p>
    </div>
  );
}

// ─── Main Export ────────────────────────────────────────────

export function EnergyMeterTree({
  meters: initialMeters,
  devices,
  logs,
  priorReadings,
}: {
  meters: EnergyMeter[];
  devices: EnergyMeterDevice[];
  logs: EnergyReadingLog[];
  priorReadings?: Record<string, EnergyReadingLog>;
}) {
  const router = useRouter();
  const [meters, setMeters] = useState<EnergyMeter[]>(initialMeters);
  const [selectedMeterIds, setSelectedMeterIds] = useState<Set<string>>(new Set());
  const [editingMeter, setEditingMeter] = useState<EnergyMeter | null>(null);
  const [copied, setCopied] = useState(false);

  // View Mode: 'section' (current default) vs 'tree' (mother-child relation as in Settings)
  const [viewMode, setViewMode] = useState<'section' | 'tree'>('section');
  const [collapsedMeterIds, setCollapsedMeterIds] = useState<Set<string>>(new Set());

  // Load user view preference from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('energy_meter_view_mode');
      if (saved === 'section' || saved === 'tree') {
        setViewMode(saved);
      }
    } catch {}
  }, []);

  const handleViewModeChange = (mode: 'section' | 'tree') => {
    setViewMode(mode);
    try {
      localStorage.setItem('energy_meter_view_mode', mode);
    } catch {}
  };

  const handleToggleCollapse = (meterId: string) => {
    setCollapsedMeterIds((prev) => {
      const next = new Set(prev);
      if (next.has(meterId)) {
        next.delete(meterId);
      } else {
        next.add(meterId);
      }
      return next;
    });
  };

  const expandAllTree = () => {
    setCollapsedMeterIds(new Set());
  };

  const collapseAllTree = () => {
    const parentIds = meters
      .filter((m) => meters.some((child) => child.parent_id === m.id))
      .map((m) => m.id);
    setCollapsedMeterIds(new Set(parentIds));
  };

  useEffect(() => {
    setMeters(initialMeters);
  }, [initialMeters]);

  const handleEditSuccess = (updated: { id: string; name: string; is_primary_for_total: boolean }) => {
    setMeters((prev) =>
      prev.map((m) =>
        m.id === updated.id
          ? { ...m, name: updated.name, is_primary_for_total: updated.is_primary_for_total }
          : m
      )
    );
    router.refresh();
  };

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

  const handleSelectAllInSection = (sectionMeters: EnergyMeter[]) => {
    const allSelected = sectionMeters.every((m) => selectedMeterIds.has(m.id));
    setSelectedMeterIds((prev) => {
      const next = new Set(prev);
      sectionMeters.forEach((m) => {
        if (allSelected) {
          next.delete(m.id);
        } else {
          next.add(m.id);
        }
      });
      return next;
    });
  };

  const handleSelectGroup = (groupMeters: EnergyMeter[]) => {
    const allSelected = groupMeters.every((m) => selectedMeterIds.has(m.id));
    setSelectedMeterIds((prev) => {
      const next = new Set(prev);
      groupMeters.forEach((m) => {
        if (allSelected) {
          next.delete(m.id);
        } else {
          next.add(m.id);
        }
      });
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedMeterIds(new Set());
  };

  const handleSelectAll = () => {
    if (selectedMeterIds.size === meters.length) {
      setSelectedMeterIds(new Set());
    } else {
      setSelectedMeterIds(new Set(meters.map((m) => m.id)));
    }
  };

  // Compute selected sum directly from reading data
  const selectedSum = useMemo(() => {
    let sum = 0;
    for (const meter of meters) {
      if (selectedMeterIds.has(meter.id)) {
        const data = getMeterReadingData(meter, devices, logs, priorReadings);
        sum += data.consumption;
      }
    }
    return sum;
  }, [meters, selectedMeterIds, devices, logs, priorReadings]);

  const handleCopySum = () => {
    navigator.clipboard.writeText(selectedSum.toFixed(1));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const grouped = groupMetersBySection(meters);
  const sectionOrder: EnergyMeterSection[] = [
    'incoming',
    'outgoing_main',
    'outgoing_sub',
    'outgoing_sub_sub',
  ];
  const activeSections = sectionOrder.filter((section) => (grouped[section] || []).length > 0);

  // Accordion open/close state for Section View
  const [openSectionIds, setOpenSectionIds] = useState<Set<string>>(
    () => new Set(['incoming', 'outgoing_main', 'outgoing_sub', 'outgoing_sub_sub'])
  );

  const isAllSectionsOpen = activeSections.length > 0 && activeSections.every((s) => openSectionIds.has(s));

  const toggleAllSections = () => {
    if (isAllSectionsOpen) {
      setOpenSectionIds(new Set());
    } else {
      setOpenSectionIds(new Set(activeSections));
    }
  };

  const handleToggleSection = (section: string) => {
    setOpenSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Hierarchy Tree expand/collapse state
  const allParentIds = useMemo(() => {
    return meters
      .filter((m) => meters.some((child) => child.parent_id === m.id))
      .map((m) => m.id);
  }, [meters]);

  const isAllTreeExpanded = collapsedMeterIds.size === 0;

  const toggleExpandCollapseTree = () => {
    if (isAllTreeExpanded) {
      setCollapsedMeterIds(new Set(allParentIds));
    } else {
      setCollapsedMeterIds(new Set());
    }
  };

  const isExpanded = viewMode === 'tree' ? isAllTreeExpanded : isAllSectionsOpen;
  const handleToggleExpandCollapse = viewMode === 'tree' ? toggleExpandCollapseTree : toggleAllSections;

  const selectedCount = selectedMeterIds.size;

  return (
    <div className={`flex flex-col gap-2.5 ${selectedCount > 0 ? 'pb-24' : ''}`}>
      {/* Legend & quick selection action */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-text-muted">
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          {/* View mode toggle icons (beside Select All Meters) */}
          <div className="flex items-center bg-bg-surface border border-border rounded-[var(--radius-sm)] p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => handleViewModeChange('section')}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-all cursor-pointer text-[11px] font-medium ${
                viewMode === 'section'
                  ? 'bg-accent text-white shadow-xs'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-surface-hover'
              }`}
              title="Section View (Default - grouped by section accordions)"
              aria-label="Section View"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              <span>Sections</span>
            </button>

            <button
              type="button"
              onClick={() => handleViewModeChange('tree')}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-all cursor-pointer text-[11px] font-medium ${
                viewMode === 'tree'
                  ? 'bg-accent text-white shadow-xs'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-surface-hover'
              }`}
              title="Mother-Child Hierarchy View (arranged in same pattern as Settings page)"
              aria-label="Mother-Child Tree View"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="3" />
                <circle cx="18" cy="18" r="3" />
                <circle cx="18" cy="6" r="3" />
                <path d="M6 9v9a3 3 0 0 0 3 3h6" />
                <path d="M6 6h9" />
              </svg>
              <span>Mother-Child</span>
            </button>
          </div>

          <div className="h-3.5 w-px bg-border/60" />

          {/* Select all meters */}
          <button
            type="button"
            onClick={handleSelectAll}
            className="hover:text-accent font-medium transition-colors cursor-pointer underline-offset-2 hover:underline"
          >
            {selectedCount === meters.length ? 'Deselect All' : 'Select All Meters'}
          </button>
          {selectedCount > 0 && (
            <>
              <span>·</span>
              <button
                type="button"
                onClick={handleClearSelection}
                className="hover:text-danger font-medium transition-colors cursor-pointer"
              >
                Clear ({selectedCount})
              </button>
            </>
          )}

          {/* Single Expand / Collapse Toggle Button */}
          <div className="hidden sm:block h-3.5 w-px bg-border/60" />
          <button
            type="button"
            onClick={handleToggleExpandCollapse}
            className="flex items-center gap-1 text-[11px] text-text-muted hover:text-accent font-medium transition-colors cursor-pointer px-2 py-0.5 rounded bg-bg-surface hover:bg-bg-surface-hover border border-border/60"
            title={isExpanded ? 'Collapse all' : 'Expand all'}
          >
            <span className="text-[10px]">▼</span>
            <span>{isExpanded ? 'Collapse All' : 'Expand All'}</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-success ring-1 ring-success/30" />
            Primary
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-danger ring-1 ring-danger/30" />
            Non-Primary
          </span>
          <span className="text-[10px] text-text-muted/70 italic hidden sm:inline">
            (Click dot to edit)
          </span>
        </div>
      </div>

      {activeSections.length === 0 ? (
        <div className="bg-bg-surface border border-border rounded-[var(--radius-md)] p-8 text-center">
          <h3 className="text-sm font-semibold text-text-primary mb-1">No Energy Meters Found</h3>
          <p className="text-xs text-text-muted max-w-sm mx-auto">
            Click &ldquo;Manage Meters&rdquo; to add or configure energy meters.
          </p>
        </div>
      ) : viewMode === 'tree' ? (
        <HierarchyMeterView
          meters={meters}
          devices={devices}
          logs={logs}
          priorReadings={priorReadings}
          selectedMeterIds={selectedMeterIds}
          collapsedMeterIds={collapsedMeterIds}
          onToggleSelect={handleToggleSelect}
          onSelectGroup={handleSelectGroup}
          onToggleCollapse={handleToggleCollapse}
          onEditMeter={(m) => setEditingMeter(m)}
        />
      ) : (
        activeSections.map((section) => (
          <SectionAccordion
            key={section}
            section={section}
            meters={grouped[section] || []}
            devices={devices}
            logs={logs}
            priorReadings={priorReadings}
            isOpen={openSectionIds.has(section)}
            onToggleOpen={() => handleToggleSection(section)}
            selectedMeterIds={selectedMeterIds}
            onToggleSelect={handleToggleSelect}
            onSelectAllInSection={handleSelectAllInSection}
            onEditMeter={(m) => setEditingMeter(m)}
          />
        ))
      )}

      {/* Floating Bottom Selection Footer */}
      {selectedCount > 0 && (
        <div className="fixed bottom-3 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 z-40 max-w-xl w-auto animate-fade-in pointer-events-auto">
          <div className="flex items-center justify-between gap-2 sm:gap-4 px-3 py-1.5 sm:px-4 sm:py-2 rounded-[var(--radius-lg)] bg-bg-surface/95 backdrop-blur-md border border-border shadow-2xl text-text-primary">
            {/* Left: Count */}
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-accent/15 text-accent text-[10px] font-bold flex-shrink-0">
                ∑
              </span>
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
              <span className="text-[10px] font-semibold text-text-secondary">kWh</span>
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

      {/* Edit Meter Name Modal */}
      <EditMeterNameModal
        open={!!editingMeter}
        onClose={() => setEditingMeter(null)}
        meter={editingMeter}
        onSuccess={handleEditSuccess}
      />
    </div>
  );
}
