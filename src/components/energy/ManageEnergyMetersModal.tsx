'use client';

import React, { useState, useMemo } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { toggleMeterInEnergyAction, excludeNonEnergyMetersAction } from '@/lib/energyActions';
import type { AvailableMeter } from '@/lib/energyQueries';

interface ManageEnergyMetersModalProps {
  open: boolean;
  onClose: () => void;
  availableMeters: AvailableMeter[];
  onRefresh?: () => void;
  title?: string;
  systemName?: string;
  showExcludeNonEnergy?: boolean;
  onToggle?: (meterId: string, nextState: boolean) => Promise<{ success: boolean; message: string }>;
}

export function ManageEnergyMetersModal({
  open,
  onClose,
  availableMeters: initialMeters,
  onRefresh,
  title = 'Manage Energy Meters',
  systemName = 'Energy Meters',
  showExcludeNonEnergy = true,
  onToggle,
}: ManageEnergyMetersModalProps) {
  const { addToast } = useToast();
  const [meters, setMeters] = useState<AvailableMeter[]>(initialMeters);
  const [search, setSearch] = useState('');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [excludingAll, setExcludingAll] = useState(false);

  React.useEffect(() => {
    setMeters(initialMeters);
  }, [initialMeters]);

  // Distinct sections for filter tabs
  const sections = useMemo(() => {
    const set = new Set<string>();
    meters.forEach((m) => {
      if (m.section_name) set.add(m.section_name);
    });
    return Array.from(set);
  }, [meters]);

  const filteredMeters = useMemo(() => {
    return meters.filter((m) => {
      const matchesSearch =
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.location.toLowerCase().includes(search.toLowerCase());
      const matchesSection =
        sectionFilter === 'all' || m.section_name === sectionFilter;
      return matchesSearch && matchesSection;
    });
  }, [meters, search, sectionFilter]);

  const includedCount = useMemo(
    () => meters.filter((m) => m.is_in_energy_meters).length,
    [meters]
  );

  const nonEnergyCount = useMemo(() => {
    return meters.filter(
      (m) =>
        m.is_in_energy_meters &&
        (m.section_name.toLowerCase().includes('gas') ||
          m.section_name.toLowerCase().includes('hour') ||
          m.section_unit === 'm³' ||
          m.section_unit === 'hrs')
    ).length;
  }, [meters]);

  const handleToggle = async (meter: AvailableMeter) => {
    const nextState = !meter.is_in_energy_meters;
    setLoadingIds((prev) => new Set(prev).add(meter.id));

    // Optimistic update
    setMeters((prev) =>
      prev.map((m) => (m.id === meter.id ? { ...m, is_in_energy_meters: nextState } : m))
    );

    const toggleFn = onToggle || toggleMeterInEnergyAction;
    const result = await toggleFn(meter.id, nextState);
    if (result.success) {
      addToast('success', result.message);
      onRefresh?.();
    } else {
      // Revert on error
      setMeters((prev) =>
        prev.map((m) => (m.id === meter.id ? { ...m, is_in_energy_meters: !nextState } : m))
      );
      addToast('error', result.message);
    }

    setLoadingIds((prev) => {
      const next = new Set(prev);
      next.delete(meter.id);
      return next;
    });
  };

  const handleExcludeNonEnergy = async () => {
    setExcludingAll(true);
    const result = await excludeNonEnergyMetersAction();
    if (result.success) {
      addToast('success', result.message);
      setMeters((prev) =>
        prev.map((m) => {
          const isNonEnergy =
            m.section_name.toLowerCase().includes('gas') ||
            m.section_name.toLowerCase().includes('hour') ||
            m.section_unit === 'm³' ||
            m.section_unit === 'hrs';
          return isNonEnergy ? { ...m, is_in_energy_meters: false } : m;
        })
      );
      onRefresh?.();
    } else {
      addToast('error', result.message);
    }
    setExcludingAll(false);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      compact
      maxWidth="600px"
    >
      <div className="flex flex-col gap-3">
        {/* Info header & count */}
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>
            <strong className="text-text-primary font-semibold">{includedCount}</strong> of{' '}
            {meters.length} meters included in {systemName}
          </span>

          {showExcludeNonEnergy && nonEnergyCount > 0 && (
            <button
              onClick={handleExcludeNonEnergy}
              disabled={excludingAll}
              className="text-[11px] font-medium text-danger hover:underline cursor-pointer disabled:opacity-50"
            >
              {excludingAll ? 'Cleaning...' : `Exclude ${nonEnergyCount} Gas/Hour meter(s)`}
            </button>
          )}
        </div>

        {/* Search & section filters */}
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <input
            type="text"
            placeholder="Search by name or area..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-bg-surface border border-border rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />

          <div className="flex items-center gap-1 overflow-x-auto py-0.5">
            <button
              onClick={() => setSectionFilter('all')}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-all cursor-pointer whitespace-nowrap ${
                sectionFilter === 'all'
                  ? 'bg-accent/15 text-accent font-semibold'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-surface-hover'
              }`}
            >
              All
            </button>
            {sections.map((sec) => (
              <button
                key={sec}
                onClick={() => setSectionFilter(sec)}
                className={`px-2 py-1 text-[11px] font-medium rounded transition-all cursor-pointer whitespace-nowrap ${
                  sectionFilter === sec
                    ? 'bg-accent/15 text-accent font-semibold'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-surface-hover'
                }`}
              >
                {sec}
              </button>
            ))}
          </div>
        </div>

        {/* Meter List */}
        <div className="border border-border rounded-[var(--radius-md)] divide-y divide-border max-h-[50vh] overflow-y-auto">
          {filteredMeters.length === 0 ? (
            <div className="text-center py-8 text-xs text-text-muted">
              No meters match your search.
            </div>
          ) : (
            filteredMeters.map((meter) => {
              const isLoading = loadingIds.has(meter.id);
              const isNonEnergy =
                meter.section_name.toLowerCase().includes('gas') ||
                meter.section_name.toLowerCase().includes('hour');

              return (
                <div
                  key={meter.id}
                  className={`flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                    meter.is_in_energy_meters ? 'bg-bg-surface' : 'bg-bg-primary/40 opacity-70'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-text-primary truncate">
                        {meter.name}
                      </span>
                      {isNonEnergy && (
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-warning bg-warning/10 px-1 py-0.2 rounded">
                          {meter.section_name}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-text-muted truncate mt-0.5">
                      {meter.location || 'No location set'} • {meter.section_name} ({meter.type})
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={meter.is_in_energy_meters}
                        onChange={() => handleToggle(meter)}
                        disabled={isLoading}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4.5 bg-border rounded-full peer peer-checked:bg-accent transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:after:translate-x-3.5 disabled:opacity-50" />
                    </label>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center pt-2 border-t border-border mt-1">
          <span className="text-[11px] text-text-muted">
            Changes take effect immediately on this dashboard.
          </span>
          <Button type="button" variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
