'use client';

import React, { useState, useEffect, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { useSyncedMonth } from '@/context/MonthContext';
import { useTierLabels } from '@/lib/useTierLabels';
import type { EnergyMeter, EnergyMeterDevice, EnergyReadingLog } from '@/types/energy';
import type { AvailableMeter } from '@/lib/energyQueries';
import type { GasMeter, GasMeterDevice, GasReadingLog } from '@/types/gas';
import type { AvailableMeterForGas } from '@/lib/gasQueries';
import type { HourMeter, HourMeterDevice, HourReadingLog } from '@/types/hour';
import type { AvailableMeterForHour } from '@/lib/hourQueries';

import { EnergyMeterTree, getMeterReadingData } from '@/components/energy/EnergyMeterTree';
import { GenericMeterTree, getMeterReadingData as getGenericMeterReadingData } from '@/components/meters/GenericMeterTree';
import { HourMeterTree, getHourMeterReadingData } from '@/components/meters/HourMeterTree';
import { getHourMeterGroup } from '@/components/meters/EditHourMeterModal';
import { ManageEnergyMetersModal } from '@/components/energy/ManageEnergyMetersModal';

import { toggleMeterInGasAction } from '@/lib/gasActions';
import { toggleMeterInHourAction } from '@/lib/hourActions';

import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ToastProvider } from '@/components/ui/Toast';

export interface ConsumptionClientProps {
  selectedMonth: string;
  initialTab?: string;
  energy: {
    meters: EnergyMeter[];
    devices: EnergyMeterDevice[];
    logs: EnergyReadingLog[];
    priorReadings?: Record<string, EnergyReadingLog>;
    availableMeters: AvailableMeter[];
  };
  gas: {
    meters: GasMeter[];
    devices: GasMeterDevice[];
    logs: GasReadingLog[];
    priorReadings?: Record<string, GasReadingLog>;
    availableMeters: AvailableMeterForGas[];
  };
  hour: {
    meters: HourMeter[];
    devices: HourMeterDevice[];
    logs: HourReadingLog[];
    priorReadings?: Record<string, HourReadingLog>;
    availableMeters: AvailableMeterForHour[];
  };
}

function ConsumptionContent({
  selectedMonth,
  initialTab,
  energy,
  gas,
  hour,
}: ConsumptionClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const tierLabels = useTierLabels();

  const [activeTab, setActiveTab] = useState<'energy' | 'gas' | 'hour'>(() => {
    if (initialTab === 'gas' || initialTab === 'hour' || initialTab === 'energy') {
      return initialTab;
    }
    return 'energy';
  });

  const { selectedMonth: contextMonth, setSelectedMonth, hasAppliedFilter } = useSyncedMonth();

  // If a universal month filter has been applied in context and this page rendered with a different month, sync it
  useEffect(() => {
    if (hasAppliedFilter && contextMonth && selectedMonth !== contextMonth) {
      startTransition(() => {
        router.replace(`/consumption?month=${contextMonth}&tab=${activeTab}`);
      });
    }
  }, [hasAppliedFilter, contextMonth, selectedMonth, activeTab, router]);

  // Clean ?month= from the URL bar so that refreshing or reopening starts with defaults
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('month')) {
        url.searchParams.delete('month');
        window.history.replaceState(null, '', url.pathname + (url.search || ''));
      }
    }
  }, [selectedMonth]);

  // Month navigation logic
  const [y, m] = selectedMonth.split('-');
  const monthDate = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  const displayMonth = format(monthDate, 'MMMM yyyy');

  const handleMonthChange = (newMonth: string) => {
    if (!newMonth || !newMonth.includes('-')) return;
    setSelectedMonth(newMonth);
    startTransition(() => {
      router.push(`/consumption?month=${newMonth}&tab=${activeTab}`);
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

  const handleTabChange = (newTab: 'energy' | 'gas' | 'hour') => {
    setActiveTab(newTab);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', newTab);
      window.history.replaceState(null, '', url.pathname + (url.search || ''));
    }
  };

  // ─── Energy Stats Calculation ──────────────────────────────
  const energyStats = useMemo(() => {
    let totalIncoming = 0;
    let totalOutgoingMain = 0;
    let totalOutgoingSub = 0;
    let totalOutgoingSubSub = 0;

    const incomingMeters = energy.meters.filter(
      (m) => m.section === 'incoming' && m.is_active !== false
    );
    const hasPrimaryIncoming = incomingMeters.some((m) => m.is_primary_for_total === true);

    energy.meters.forEach((meter) => {
      if (meter.is_active === false) return;
      const data = getMeterReadingData(meter, energy.devices, energy.logs, energy.priorReadings);
      const consumption = data.consumption || 0;

      if (meter.section === 'incoming') {
        if (!hasPrimaryIncoming || meter.is_primary_for_total) {
          totalIncoming += consumption;
        }
      } else if (meter.section === 'outgoing_main') {
        totalOutgoingMain += consumption;
      } else if (meter.section === 'outgoing_sub') {
        totalOutgoingSub += consumption;
      } else if (meter.section === 'outgoing_sub_sub') {
        totalOutgoingSubSub += consumption;
      }
    });

    const systemLoss = totalIncoming - totalOutgoingMain;
    const systemLossPercent = totalIncoming > 0 ? (systemLoss / totalIncoming) * 100 : 0;
    const activeMetersCount = energy.meters.filter((m) => m.is_active !== false).length;

    return {
      totalIncoming,
      totalOutgoingMain,
      totalOutgoingSub,
      totalOutgoingSubSub,
      systemLoss,
      systemLossPercent,
      totalMeters: activeMetersCount,
    };
  }, [energy]);

  // ─── Gas Stats Calculation ─────────────────────────────────
  const gasStats = useMemo(() => {
    let totalIncoming = 0;
    let totalOutgoingMain = 0;
    let totalOutgoingSub = 0;

    const incomingMeters = gas.meters.filter(
      (m) => m.section === 'incoming' && m.is_active !== false
    );
    const hasPrimaryIncoming = incomingMeters.some((m) => m.is_primary_for_total === true);

    gas.meters.forEach((meter) => {
      if (meter.is_active === false) return;
      const data = getGenericMeterReadingData(meter, gas.devices, gas.logs, gas.priorReadings);
      const consumption = data.consumption || 0;

      if (meter.section === 'incoming') {
        if (!hasPrimaryIncoming || meter.is_primary_for_total) {
          totalIncoming += consumption;
        }
      } else if (meter.section === 'outgoing_main') {
        totalOutgoingMain += consumption;
      } else if (meter.section === 'outgoing_sub' || meter.section === 'outgoing_sub_sub') {
        totalOutgoingSub += consumption;
      }
    });

    return {
      totalIncoming,
      totalOutgoingMain,
      totalOutgoingSub,
      activeCount: gas.meters.filter((m) => m.is_active !== false).length,
    };
  }, [gas]);

  // ─── Hour Stats Calculation ────────────────────────────────
  const hourStats = useMemo(() => {
    let total = 0;
    let comp = 0;
    let pump = 0;
    let gen = 0;

    hour.meters.forEach((meter) => {
      const data = getHourMeterReadingData(meter, hour.devices, hour.logs, hour.priorReadings);
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
      activeCount: hour.meters.filter((m) => m.is_active !== false).length,
    };
  }, [hour]);

  // Manage modal available meters mappings
  const hasNonEnergyMeters = energy.availableMeters.some(
    (m) =>
      m.is_in_energy_meters &&
      (m.section_name.toLowerCase().includes('gas') ||
        m.section_name.toLowerCase().includes('hour') ||
        m.section_unit === 'm³' ||
        m.section_unit === 'hrs')
  );

  const gasManageMetersList = useMemo(
    () =>
      gas.availableMeters.map((m) => ({
        ...m,
        is_in_energy_meters: m.is_in_system ?? (m as any).is_in_energy_meters,
      })),
    [gas.availableMeters]
  );

  const hourManageMetersList = useMemo(
    () =>
      hour.availableMeters.map((meter) => ({
        ...meter,
        is_in_energy_meters: meter.is_in_system,
      })),
    [hour.availableMeters]
  );

  // Tabs list
  const tabs: TabItem[] = [
    {
      id: 'energy',
      label: 'Energy Meters',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      ),
      badge: energyStats.totalMeters,
    },
    {
      id: 'gas',
      label: 'Gas Meters',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3z" />
        </svg>
      ),
      badge: gasStats.activeCount,
    },
    {
      id: 'hour',
      label: 'Hour Meters',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
      badge: hourStats.activeCount,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-5 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-border/40">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary">Consumption</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Factory meter hierarchy & consumption logs for{' '}
            <span className="text-accent font-semibold">{displayMonth}</span>
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
            {activeTab === 'energy'
              ? 'Manage Energy Meters'
              : activeTab === 'gas'
                ? 'Manage Gas Meters'
                : 'Manage Hour Meters'}
            {activeTab === 'energy' && hasNonEnergyMeters && (
              <span
                className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-warning rounded-full border-2 border-bg-primary"
                title="Gas/Hour meters detected"
              />
            )}
          </Button>

          {isPending && (
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin ml-1" />
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={(id) => handleTabChange(id as 'energy' | 'gas' | 'hour')}
        className="mb-1"
      />

      {/* ─── Energy Meter Tab ─── */}
      {activeTab === 'energy' && (
        <div className="space-y-4 animate-fade-in">
          <div>
            <div className="mb-3">
              <h2 className="text-base sm:text-lg font-semibold text-text-primary">Energy Meters</h2>
              <p className="text-xs text-text-muted">
                Electricity consumption (kWh) · hierarchy tree & power distribution for {displayMonth}
              </p>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 stagger-children mb-4">
              <StatCard
                label="Total Incoming"
                value={`${energyStats.totalIncoming.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`}
                accentColor="var(--color-warning)"
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                }
              />
              <StatCard
                label="Outgoing Main"
                value={`${energyStats.totalOutgoingMain.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`}
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
                value={`${Math.abs(energyStats.systemLoss).toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`}
                accentColor={
                  energyStats.systemLossPercent > 5
                    ? 'var(--color-danger)'
                    : energyStats.systemLossPercent > 2
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
                  value: energyStats.systemLossPercent,
                  label: 'of incoming',
                }}
              />
              <StatCard
                label="Active Meters"
                value={energyStats.totalMeters}
                accentColor="var(--color-success)"
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  </svg>
                }
              />
            </div>

            {/* Energy Meter Hierarchy Tree */}
            <EnergyMeterTree
              meters={energy.meters}
              devices={energy.devices}
              logs={energy.logs}
              priorReadings={energy.priorReadings}
            />
          </div>
        </div>
      )}

      {/* ─── Gas Meter Tab ─── */}
      {activeTab === 'gas' && (
        <div className="space-y-4 animate-fade-in">
          <div>
            <div className="mb-3">
              <h2 className="text-base sm:text-lg font-semibold text-text-primary">Gas Meters</h2>
              <p className="text-xs text-text-muted">
                RMS incomers, headers & appliances · natural gas volume (m³) for {displayMonth}
              </p>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 stagger-children mb-4">
              <StatCard
                label="Total RMS Incomer"
                value={`${gasStats.totalIncoming.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m³`}
                accentColor="var(--color-warning)"
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3z" />
                  </svg>
                }
              />
              <StatCard
                label="Total Consumption In Headers"
                value={`${gasStats.totalOutgoingMain.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m³`}
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
                value={`${gasStats.totalOutgoingSub.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m³`}
                accentColor="var(--color-success)"
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                  </svg>
                }
              />
            </div>

            {/* Gas Meter Hierarchy Tree */}
            <GenericMeterTree
              meters={gas.meters}
              devices={gas.devices}
              logs={gas.logs}
              priorReadings={gas.priorReadings}
              config={{
                unitLabel: 'm³',
                unitSymbol: 'm³',
                pageTitle: 'Gas Meters',
                consumptionLabel: 'Volume',
              }}
            />
          </div>
        </div>
      )}

      {/* ─── Hour Meter Tab ─── */}
      {activeTab === 'hour' && (
        <div className="space-y-4 animate-fade-in">
          <div>
            <div className="mb-3">
              <h2 className="text-base sm:text-lg font-semibold text-text-primary">Hour Meters</h2>
              <p className="text-xs text-text-muted">
                Equipment running hours grouped by machinery group for {displayMonth}
              </p>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 stagger-children mb-4">
              <StatCard
                label={tierLabels.hour_compressor || 'Compressors'}
                value={`${hourStats.compressorHours.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} hrs`}
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
                value={`${hourStats.pumpHours.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} hrs`}
                accentColor="var(--color-warning)"
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
                  </svg>
                }
              />
              <StatCard
                label={tierLabels.hour_generator || 'Generators'}
                value={`${hourStats.generatorHours.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} hrs`}
                accentColor="var(--color-success)"
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                }
              />
            </div>

            {/* Hour Meter Tree */}
            <HourMeterTree
              meters={hour.meters}
              devices={hour.devices}
              logs={hour.logs}
              priorReadings={hour.priorReadings}
            />
          </div>
        </div>
      )}

      {/* ─── Manage Modals ─── */}
      {activeTab === 'energy' && (
        <ManageEnergyMetersModal
          open={manageModalOpen}
          onClose={() => setManageModalOpen(false)}
          availableMeters={energy.availableMeters}
          onRefresh={() => router.refresh()}
          title="Manage Energy Meters"
          systemName="Energy Meters"
        />
      )}

      {activeTab === 'gas' && (
        <ManageEnergyMetersModal
          open={manageModalOpen}
          onClose={() => setManageModalOpen(false)}
          availableMeters={gasManageMetersList}
          onRefresh={() => router.refresh()}
          title="Manage Gas Meters"
          systemName="Gas Meters"
          showExcludeNonEnergy={false}
          onToggle={toggleMeterInGasAction}
        />
      )}

      {activeTab === 'hour' && (
        <ManageEnergyMetersModal
          open={manageModalOpen}
          onClose={() => setManageModalOpen(false)}
          availableMeters={hourManageMetersList}
          onRefresh={() => router.refresh()}
          title="Manage Hour Meters"
          systemName="Hour Meters"
          showExcludeNonEnergy={false}
          onToggle={toggleMeterInHourAction}
        />
      )}
    </div>
  );
}

export function ConsumptionClient(props: ConsumptionClientProps) {
  return (
    <ToastProvider>
      <ConsumptionContent {...props} />
    </ToastProvider>
  );
}
