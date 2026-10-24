'use client';

import React, { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import type { EnergyMeter, EnergyMeterDevice, EnergyReadingLog } from '@/types/energy';
import type { AvailableMeterForUnit } from '@/lib/meterQueries';
import { computeEnergyDashboardStats } from '@/lib/calculations/energy';
import { GenericMeterTree, type MeterPageConfig } from '@/components/meters/GenericMeterTree';
import { ManageEnergyMetersModal } from '@/components/energy/ManageEnergyMetersModal';
import { StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ToastProvider } from '@/components/ui/Toast';
import { useSyncedMonth } from '@/context/MonthContext';

function GenericMetersContent({
  meters,
  devices,
  logs,
  priorReadings,
  availableMeters,
  selectedMonth,
  config,
  routePath,
  onToggle,
}: {
  meters: any[];
  devices: any[];
  logs: any[];
  priorReadings?: Record<string, any>;
  availableMeters: any[];
  selectedMonth: string;
  config: MeterPageConfig;
  routePath: string;
  onToggle?: (meterId: string, nextState: boolean) => Promise<{ success: boolean; message: string }>;
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
          router.replace(`${routePath}?month=${syncedMonth}`);
        });
      }
    }
  }, [selectedMonth, syncedMonth, setSelectedMonth, routePath, router]);

  const stats = computeEnergyDashboardStats(meters, devices, logs);

  // Month navigation logic
  const [y, m] = selectedMonth.split('-');
  const monthDate = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  const displayMonth = format(monthDate, 'MMMM yyyy');

  const handleMonthChange = (newMonth: string) => {
    if (!newMonth || !newMonth.includes('-')) return;
    setSelectedMonth(newMonth);
    startTransition(() => {
      router.push(`${routePath}?month=${newMonth}`);
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

  // Map available meters for the ManageEnergyMetersModal format
  const manageMetersList = availableMeters.map((m) => ({
    ...m,
    is_in_energy_meters: m.is_in_system ?? m.is_in_energy_meters,
  }));

  return (
    <div className="max-w-7xl mx-auto animate-fade-in space-y-5">
      {/* Page header with Month Selector & Manage Meters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-border/40">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary">{config.pageTitle}</h1>
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
          </Button>

          {isPending && (
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin ml-1" />
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 stagger-children">
        <StatCard
          label="Total RMS Incomer"
          value={`${stats.totalIncoming.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${config.unitSymbol}`}
          accentColor="var(--color-warning)"
          icon={
            config.unitSymbol === 'hrs' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3z" />
              </svg>
            )
          }
        />
        <StatCard
          label="Total Consumption In Headers"
          value={`${stats.totalOutgoingMain.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${config.unitSymbol}`}
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
          label="Total Consumption In Appliances"
          value={`${stats.totalOutgoingSub.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${config.unitSymbol}`}
          accentColor="var(--color-success)"
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          }
        />
      </div>

      {/* Meter Hierarchy & Sections */}
      <div className="animate-fade-in">
        <GenericMeterTree
          meters={meters}
          devices={devices}
          logs={logs}
          priorReadings={priorReadings}
          config={config}
        />
      </div>

      {/* Manage Meters Modal */}
      <ManageEnergyMetersModal
        open={manageModalOpen}
        onClose={() => setManageModalOpen(false)}
        availableMeters={manageMetersList}
        onRefresh={() => router.refresh()}
        title={`Manage ${config.pageTitle}`}
        systemName={config.pageTitle}
        showExcludeNonEnergy={false}
        onToggle={onToggle}
      />
    </div>
  );
}

export function GenericMetersClient(props: {
  meters: any[];
  devices: any[];
  logs: any[];
  priorReadings?: Record<string, any>;
  availableMeters: any[];
  selectedMonth: string;
  config: MeterPageConfig;
  routePath: string;
  onToggle?: (meterId: string, nextState: boolean) => Promise<{ success: boolean; message: string }>;
}) {
  return (
    <ToastProvider>
      <GenericMetersContent {...props} />
    </ToastProvider>
  );
}
