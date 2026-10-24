'use client';

import React, { useState, useTransition, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import type { HourMeter, HourMeterDevice, HourReadingLog } from '@/types/hour';
import type { AvailableMeterForHour } from '@/lib/hourQueries';
import { toggleMeterInHourAction } from '@/lib/hourActions';
import { HourMeterTree, getHourMeterReadingData } from '@/components/meters/HourMeterTree';
import { getHourMeterGroup } from '@/components/meters/EditHourMeterModal';
import { ManageEnergyMetersModal } from '@/components/energy/ManageEnergyMetersModal';
import { StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ToastProvider } from '@/components/ui/Toast';
import { useTierLabels } from '@/lib/useTierLabels';
import { useSyncedMonth } from '@/context/MonthContext';

function HourMetersContent({
  meters,
  devices,
  logs,
  priorReadings,
  availableMeters,
  selectedMonth,
}: {
  meters: HourMeter[];
  devices: HourMeterDevice[];
  logs: HourReadingLog[];
  priorReadings?: Record<string, HourReadingLog>;
  availableMeters: AvailableMeterForHour[];
  selectedMonth: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const tierLabels = useTierLabels();
  const { selectedMonth: syncedMonth, setSelectedMonth } = useSyncedMonth();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchHasMonth = window.location.search.includes('month=');
      if (searchHasMonth && selectedMonth && selectedMonth !== syncedMonth) {
        setSelectedMonth(selectedMonth);
      } else if (!searchHasMonth && syncedMonth && syncedMonth !== selectedMonth) {
        startTransition(() => {
          router.replace(`/hour-meters?month=${syncedMonth}`);
        });
      }
    }
  }, [selectedMonth, syncedMonth, setSelectedMonth, router]);

  // Month navigation logic
  const [y, m] = selectedMonth.split('-');
  const monthDate = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  const displayMonth = format(monthDate, 'MMMM yyyy');

  const handleMonthChange = (newMonth: string) => {
    if (!newMonth || !newMonth.includes('-')) return;
    setSelectedMonth(newMonth);
    startTransition(() => {
      router.push(`/hour-meters?month=${newMonth}`);
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

  // Compute equipment run hours
  const stats = useMemo(() => {
    let total = 0;
    let comp = 0;
    let pump = 0;
    let gen = 0;

    meters.forEach((meter) => {
      const data = getHourMeterReadingData(meter, devices, logs, priorReadings);
      const hrs = data.consumption || 0;
      total += hrs;
      const group = getHourMeterGroup(meter);
      if (group === 'Compressor') comp += hrs;
      else if (group === 'Pump') pump += hrs;
      else if (group === 'Generator') gen += hrs;
    });

    return {
      totalRunHours: total,
      compressorHours: comp,
      pumpHours: pump,
      generatorHours: gen,
      activeCount: meters.length,
    };
  }, [meters, devices, logs, priorReadings]);

  // Map available meters for the ManageEnergyMetersModal format
  const manageMetersList = availableMeters.map((meter) => ({
    ...meter,
    is_in_energy_meters: meter.is_in_system,
  }));

  return (
    <div className="max-w-7xl mx-auto animate-fade-in space-y-5">
      {/* Page header with Month Selector & Manage Meters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-border/40">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary">Hour Meters</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Equipment running hours for <span className="text-text-primary font-semibold">{displayMonth}</span>
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

      {/* Equipment Run-Hours Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 stagger-children">
        <StatCard
          label={tierLabels.hour_compressor || 'Compressors'}
          value={`${stats.compressorHours.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} hrs`}
          accentColor="var(--color-accent)"
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M14.31 8l5.74 9.94M9.69 8h11.48M7.38 12l5.74-9.94M9.69 16L3.95 6.06M14.31 16H2.83M16.62 12l-5.74 9.94" />
            </svg>
          }
        />
        <StatCard
          label={tierLabels.hour_pump || 'Pumps'}
          value={`${stats.pumpHours.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} hrs`}
          accentColor="var(--color-warning)"
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
            </svg>
          }
        />
        <StatCard
          label={tierLabels.hour_generator || 'Generators'}
          value={`${stats.generatorHours.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} hrs`}
          accentColor="var(--color-success)"
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          }
        />
      </div>

      {/* Equipment Hour Meter Tree (Compressor, Pump, Generator) */}
      <div className="animate-fade-in">
        <HourMeterTree
          meters={meters}
          devices={devices}
          logs={logs}
          priorReadings={priorReadings}
        />
      </div>

      {/* Manage Meters Modal */}
      <ManageEnergyMetersModal
        open={manageModalOpen}
        onClose={() => setManageModalOpen(false)}
        availableMeters={manageMetersList}
        onRefresh={() => router.refresh()}
        title="Manage Hour Meters"
        systemName="Hour Meters"
        showExcludeNonEnergy={false}
        onToggle={toggleMeterInHourAction}
      />
    </div>
  );
}

export function HourMetersClient(props: {
  meters: HourMeter[];
  devices: HourMeterDevice[];
  logs: HourReadingLog[];
  priorReadings?: Record<string, HourReadingLog>;
  availableMeters: AvailableMeterForHour[];
  selectedMonth: string;
}) {
  return (
    <ToastProvider>
      <HourMetersContent {...props} />
    </ToastProvider>
  );
}
