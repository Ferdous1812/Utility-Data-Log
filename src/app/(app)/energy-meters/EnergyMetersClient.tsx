'use client';

import React, { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import type { EnergyMeter, EnergyMeterDevice, EnergyReadingLog } from '@/types/energy';
import type { AvailableMeter } from '@/lib/energyQueries';
import { computeEnergyDashboardStats } from '@/lib/calculations/energy';
import { EnergyMeterTree } from '@/components/energy/EnergyMeterTree';
import { ManageEnergyMetersModal } from '@/components/energy/ManageEnergyMetersModal';
import { StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ToastProvider } from '@/components/ui/Toast';
import { useSyncedMonth } from '@/context/MonthContext';

function EnergyMetersContent({
  meters,
  devices,
  logs,
  priorReadings,
  availableMeters,
  selectedMonth,
}: {
  meters: EnergyMeter[];
  devices: EnergyMeterDevice[];
  logs: EnergyReadingLog[];
  priorReadings?: Record<string, EnergyReadingLog>;
  availableMeters: AvailableMeter[];
  selectedMonth: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const { selectedMonth: syncedMonth, setSelectedMonth } = useSyncedMonth();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchHasMonth = window.location.search.includes('month=');
      if (searchHasMonth && selectedMonth && selectedMonth !== syncedMonth) {
        setSelectedMonth(selectedMonth);
      } else if (!searchHasMonth && syncedMonth && syncedMonth !== selectedMonth) {
        startTransition(() => {
          router.replace(`/energy-meters?month=${syncedMonth}`);
        });
      }
    }
  }, [selectedMonth, syncedMonth, setSelectedMonth, router]);

  const stats = computeEnergyDashboardStats(meters, devices, logs);

  // Month navigation logic
  const [y, m] = selectedMonth.split('-');
  const monthDate = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  const displayMonth = format(monthDate, 'MMMM yyyy');

  const handleMonthChange = (newMonth: string) => {
    if (!newMonth || !newMonth.includes('-')) return;
    setSelectedMonth(newMonth);
    startTransition(() => {
      router.push(`/energy-meters?month=${newMonth}`);
    });
  };

  const handlePrevMonth = () => {
    const prevDate = new Date(parseInt(y, 10), parseInt(m, 10) - 2, 1);
    handleMonthChange(format(prevDate, 'yyyy-MM'));
  };

  const handleNextMonth = () => {
    const nextDate = new Date(parseInt(y, 10), parseInt(m, 10), 1);
    handleMonthChange(format(nextDate, 'yyyy-MM'));
  };

  const hasNonEnergyMeters = availableMeters.some(
    (m) =>
      m.is_in_energy_meters &&
      (m.section_name.toLowerCase().includes('gas') ||
        m.section_name.toLowerCase().includes('hour') ||
        m.section_unit === 'm³' ||
        m.section_unit === 'hrs')
  );

  return (
    <div className="max-w-7xl mx-auto animate-fade-in space-y-5">
      {/* Page header with Month Selector & Manage Meters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-border/40">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary">Energy Meters</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Showing data for <span className="text-text-primary font-semibold">{displayMonth}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Month Selector */}
          <div className="flex items-center gap-0.5 bg-bg-surface border border-border rounded-[var(--radius-sm)] p-0.5 text-xs">
            <button
              type="button"
              onClick={handlePrevMonth}
              title="Previous Month"
              className="p-1 rounded hover:bg-bg-surface-hover text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <div className="relative flex items-center px-2 py-0.5">
              <span className="font-semibold text-text-primary text-xs pointer-events-none whitespace-nowrap min-w-[100px] text-center">
                {displayMonth}
              </span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => handleMonthChange(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                title="Click to pick month"
              />
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              title="Next Month"
              className="p-1 rounded hover:bg-bg-surface-hover text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {/* Manage Meters Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setManageModalOpen(true)}
            className="relative text-xs"
          >
            Manage Meters
            {hasNonEnergyMeters && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-warning rounded-full border-2 border-bg-primary" title="Gas/Hour meters detected" />
            )}
          </Button>

          {isPending && (
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin ml-1" />
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 stagger-children">
        <StatCard
          label="Total Incoming"
          value={`${stats.totalIncoming.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`}
          accentColor="var(--color-warning)"
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          }
        />
        <StatCard
          label="Outgoing Main"
          value={`${stats.totalOutgoingMain.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`}
          accentColor="var(--color-accent)"
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="8 12 12 16 16 12" />
              <line x1="12" y1="8" x2="12" y2="16" />
            </svg>
          }
        />
        <StatCard
          label="System Loss"
          value={`${Math.abs(stats.systemLoss).toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`}
          accentColor={
            stats.systemLossPercent > 5
              ? 'var(--color-danger)'
              : stats.systemLossPercent > 2
                ? 'var(--color-warning)'
                : 'var(--color-success)'
          }
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          }
          trend={{
            value: stats.systemLossPercent,
            label: 'of incoming',
          }}
        />
        <StatCard
          label="Active Meters"
          value={stats.totalMeters}
          accentColor="var(--color-success)"
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
              <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" />
            </svg>
          }
        />
      </div>

      {/* Energy Meter Hierarchy & Sections */}
      <div className="animate-fade-in">
        <EnergyMeterTree
          meters={meters}
          devices={devices}
          logs={logs}
          priorReadings={priorReadings}
        />
      </div>

      {/* Manage Energy Meters Modal */}
      <ManageEnergyMetersModal
        open={manageModalOpen}
        onClose={() => setManageModalOpen(false)}
        availableMeters={availableMeters}
        onRefresh={() => router.refresh()}
      />
    </div>
  );
}

export function EnergyMetersClient(props: {
  meters: EnergyMeter[];
  devices: EnergyMeterDevice[];
  logs: EnergyReadingLog[];
  priorReadings?: Record<string, EnergyReadingLog>;
  availableMeters: AvailableMeter[];
  selectedMonth: string;
}) {
  return (
    <ToastProvider>
      <EnergyMetersContent {...props} />
    </ToastProvider>
  );
}
