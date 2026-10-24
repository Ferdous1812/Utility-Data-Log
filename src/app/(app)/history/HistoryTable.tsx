'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { updateReadingAction, deleteReadingAction } from '@/lib/actions';
import { updateBranchReading, deleteBranchReading } from '@/lib/energyActions';
import { format } from 'date-fns';
import { HistoryFilters } from './HistoryFilters';
import type { Reading, Meter, Profile, UserRole, MeterSection } from '@/lib/types';
import { useTierLabels, getMeterTierLabel, getSectionDomain, getHourGroupKey } from '@/lib/useTierLabels';

type HistoryReading = Reading & { meter: Meter; profile: Profile };

// Reading values are always shown right-aligned with exactly two decimal places (xxxx.xx)
function formatReadingValue(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface HistoryTableProps {
  readings: HistoryReading[];
  userRole: UserRole;
  sections: MeterSection[];
  meters: Meter[];
  currentMeterIds: string[];
  currentFrom?: string;
  currentTo?: string;
  initialTab?: string;
}

const UNCATEGORIZED_SECTION: MeterSection = {
  id: '__uncategorized__',
  name: 'Other Meters',
  icon: '',
  color: '#64748B',
  unit: '',
  sort_order: Number.MAX_SAFE_INTEGER,
  created_at: '',
};

export function HistoryTable({
  readings,
  userRole,
  sections,
  meters,
  currentMeterIds,
  currentFrom,
  currentTo,
  initialTab,
}: HistoryTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const tierLabels = useTierLabels();

  const [editingReading, setEditingReading] = useState<Reading | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editDate, setEditDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isAdmin = userRole === 'admin';

  const handleOpenEdit = (reading: Reading) => {
    setEditingReading(reading);
    setEditValue(String(reading.reading_value));
    setEditDate(reading.reading_date);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingReading) return;

    const val = parseFloat(editValue);
    if (isNaN(val) || val < 0) {
      addToast('error', 'Invalid reading value.');
      return;
    }

    setSubmitting(true);
    const updatePayload = { reading_value: val, reading_date: editDate };
    const res = (editingReading as any)._branch
      ? await updateBranchReading(editingReading.id, updatePayload)
      : await updateReadingAction(editingReading.id, updatePayload);

    if (res.success) {
      addToast('success', res.message);
      setEditingReading(null);
      router.refresh();
    } else {
      addToast('error', res.message);
    }
    setSubmitting(false);
  };

  const handleDelete = async (reading: Reading) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete this reading (${reading.reading_value} kWh on ${reading.reading_date})? Usage for adjacent dates will be automatically updated.`
    );
    if (!confirmed) return;

    const res = (reading as any)._branch
      ? await deleteBranchReading(reading.id)
      : await deleteReadingAction(reading.id);
    if (res.success) {
      addToast('success', res.message);
      router.refresh();
    } else {
      addToast('error', res.message);
    }
  };

  // ─── Group readings by meter section, one table per section ───
  const sectionGroups = useMemo(() => {
    const orderedSections = [...sections].sort((a, b) => a.sort_order - b.sort_order);
    const byId = new Map<string, HistoryReading[]>();

    for (const reading of readings) {
      const key = reading.meter?.section_id || UNCATEGORIZED_SECTION.id;
      if (!byId.has(key)) byId.set(key, []);
      byId.get(key)!.push(reading);
    }

    const groups = orderedSections
      .filter((section) => meters.some((m) => m.section_id === section.id))
      .map((section) => ({
        section,
        readings: byId.get(section.id) || [],
      }));

    const uncategorized = byId.get(UNCATEGORIZED_SECTION.id) || [];
    if (meters.some((m) => !m.section_id)) {
      groups.push({ section: UNCATEGORIZED_SECTION, readings: uncategorized });
    }

    return groups;
  }, [readings, sections, meters]);

  const urlTab = searchParams.get('tab');

  const [activeTab, setActiveTab] = useState<string>(() => {
    if (urlTab) return urlTab;
    if (initialTab) return initialTab;
    return '';
  });

  useEffect(() => {
    if (urlTab && urlTab !== activeTab) {
      setActiveTab(urlTab);
    }
  }, [urlTab, activeTab]);

  useEffect(() => {
    if (sectionGroups.length > 0) {
      if (!activeTab || !sectionGroups.some((g) => g.section.id === activeTab)) {
        setActiveTab(sectionGroups[0].section.id);
      }
    }
  }, [sectionGroups, activeTab]);

  const activeTabId = activeTab || sectionGroups[0]?.section.id || '';

  const handleTabChange = (newTabId: string) => {
    setActiveTab(newTabId);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', newTabId);

    // Keep only meters that belong to the new tab, drop others
    const currentMeters = params.get('meters')?.split(',').filter(Boolean) || [];
    if (currentMeters.length > 0) {
      const newTabMeterIds = new Set(
        meters
          .filter((m) => (newTabId === '__uncategorized__' ? !m.section_id : m.section_id === newTabId))
          .map((m) => m.id)
      );
      const remainingMeters = currentMeters.filter((id) => newTabMeterIds.has(id));
      if (remainingMeters.length > 0) {
        params.set('meters', remainingMeters.join(','));
      } else {
        params.delete('meters');
      }
    }

    router.push(`/history?${params.toString()}`);
  };

  const tabs = useMemo(() => {
    return sectionGroups.map(({ section, readings }) => ({
      id: section.id,
      label: section.name,
      badge: readings.length,
    }));
  }, [sectionGroups]);

  const currentGroup = useMemo(() => {
    return sectionGroups.find((g) => g.section.id === activeTabId) || sectionGroups[0];
  }, [sectionGroups, activeTabId]);

  return (
    <div className="space-y-3">
      {tabs.length > 1 && (
        <Tabs
          tabs={tabs}
          activeTab={activeTabId}
          onChange={handleTabChange}
        />
      )}

      {/* Section-Scoped Filters Toolbar — meter filter contains only meters of the active tab */}
      <HistoryFilters
        meters={meters}
        sections={sections}
        activeSectionId={activeTabId}
        currentMeterIds={currentMeterIds}
        currentFrom={currentFrom}
        currentTo={currentTo}
      />

      {currentGroup && (
        <div key={currentGroup.section.id} className="border border-border/80 rounded-[var(--radius-md)] bg-bg-elevated shadow-xs overflow-hidden">
          {currentGroup.readings.length === 0 ? (
            <div className="py-8 text-center text-text-muted">
              <p className="text-xs font-semibold text-text-primary">No readings found for this section</p>
              <p className="text-[11px] text-text-muted mt-0.5">Try clearing meter filters or adjusting your date range</p>
            </div>
          ) : (
            <SectionTable
              readings={currentGroup.readings}
              isAdmin={isAdmin}
              onEdit={handleOpenEdit}
              onDelete={handleDelete}
              tierLabels={tierLabels}
              section={currentGroup.section}
            />
          )}
        </div>
      )}

      {/* Edit Reading Modal — shared across all section tables */}
      <Modal
        open={!!editingReading}
        onClose={() => setEditingReading(null)}
        title="Edit Log Reading"
        compact
      >
        <form onSubmit={handleSaveEdit} className="flex flex-col gap-3">
          <div className="bg-bg-elevated p-2.5 rounded-[var(--radius-sm)] border border-border">
            <span className="text-[10px] text-text-muted uppercase font-semibold tracking-wider block">Meter</span>
            <span className="text-xs font-bold text-text-primary">
              {editingReading?.meter?.name}
            </span>
          </div>

          <Input
            label="Reading Value (kWh)"
            type="number"
            step="0.01"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            required
          />

          <Input
            label="Reading Date"
            type="date"
            value={editDate}
            onChange={(e) => setEditDate(e.target.value)}
            required
          />

          <div className="flex gap-2 mt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditingReading(null)}
              fullWidth
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={submitting} fullWidth>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ─── Single section's table — header row and first column both freeze ───

interface SectionTableProps {
  readings: HistoryReading[];
  isAdmin: boolean;
  onEdit: (reading: Reading) => void;
  onDelete: (reading: Reading) => void;
  tierLabels: import('@/lib/types').CustomTierLabels;
  section: MeterSection;
}

function SectionTable({ readings, isAdmin, onEdit, onDelete, tierLabels, section }: SectionTableProps) {
  const domain = getSectionDomain(section);
  return (
    <div className="overflow-x-auto max-h-[calc(100vh-230px)] relative">
      <table className="w-full text-xs border-collapse table-fixed min-w-[760px]">
        <colgroup>
          <col className="w-[90px]" />
          <col className="w-[170px] sm:w-[210px]" />
          <col className="w-[95px]" />
          <col className="w-[95px]" />
          <col className="w-[100px]" />
          <col className="w-[110px]" />
          <col className="w-[125px]" />
          {isAdmin && <col className="w-[65px]" />}
        </colgroup>
        <thead className="sticky top-0 z-20 bg-table-header text-[10px] font-bold uppercase tracking-wider text-white border-b border-border select-none">
          <tr>
            <th className="px-2 py-1.5 text-center whitespace-nowrap text-white">Date</th>
            <th className="sticky left-0 z-30 bg-table-header px-2.5 py-1.5 text-left text-white">Meter</th>
            <th className="px-2 py-1.5 text-right whitespace-nowrap text-white">Previous</th>
            <th className="px-2 py-1.5 text-right whitespace-nowrap text-white">Current</th>
            <th className="px-2 py-1.5 text-right whitespace-nowrap text-white">Difference</th>
            <th className="px-2 py-1.5 text-left whitespace-nowrap text-white">Logged By</th>
            <th className="px-2 py-1.5 text-left whitespace-nowrap text-white">Timestamp</th>
            {isAdmin && <th className="px-2 py-1.5 text-right whitespace-nowrap text-white">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {readings.map((reading, idx) => {
            const nextOlder = readings.slice(idx + 1).find((r) => r.meter_id === reading.meter_id);
            const prevValue =
              reading.is_reset
                ? null
                : reading.usage != null
                ? Number(reading.reading_value) - Number(reading.usage)
                : nextOlder
                ? Number(nextOlder.reading_value)
                : null;

            return (
              <tr
                key={reading.id}
                className="hover:bg-bg-surface-hover/70 transition-colors"
              >
                <td className="px-2 py-1.5 text-center text-text-muted text-xs whitespace-nowrap">
                  {format(new Date(reading.reading_date), 'dd MMM yyyy')}
                </td>
                <td className="sticky left-0 z-10 bg-inherit px-2.5 py-1.5 text-xs border-r border-border/30">
                  <span className="font-semibold text-text-primary truncate block leading-tight" title={reading.meter?.name}>
                    {reading.meter?.name || '—'}
                  </span>
                  <span className={`text-[10px] font-medium leading-tight block mt-0.5 ${
                    domain === 'hour'
                      ? getHourGroupKey(reading.meter) === 'Compressor'
                        ? 'text-accent'
                        : getHourGroupKey(reading.meter) === 'Pump'
                        ? 'text-warning'
                        : getHourGroupKey(reading.meter) === 'Generator'
                        ? 'text-success'
                        : 'text-text-muted'
                      : reading.meter?.type === 'incoming' || reading.meter?.type === 'main'
                      ? 'text-warning'
                      : reading.meter?.type === 'outgoing_main' || reading.meter?.type === 'outgoing'
                      ? 'text-accent'
                      : reading.meter?.type === 'outgoing_sub_sub'
                      ? 'text-danger'
                      : 'text-success'
                  }`}>
                    {getMeterTierLabel(reading.meter, domain, tierLabels)}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right text-text-secondary tabular-nums text-xs">
                  {reading.is_reset ? (
                    <span className="text-warning text-[11px] font-semibold">0.00</span>
                  ) : prevValue != null ? (
                    formatReadingValue(prevValue)
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-2 py-1.5 text-right font-semibold text-text-primary tabular-nums text-xs">
                  {formatReadingValue(Number(reading.reading_value))}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-xs font-semibold">
                  {reading.is_reset ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-warning bg-warning/15 px-1.5 py-0.5 rounded-[var(--radius-sm)] border border-warning/30">
                      First reading
                    </span>
                  ) : reading.usage != null ? (
                    <span className="font-bold text-accent">
                      {formatReadingValue(Number(reading.usage))}
                    </span>
                  ) : (
                    <span className="text-text-muted text-xs">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-text-secondary text-xs truncate max-w-[120px]">
                  {reading.profile?.full_name || '—'}
                </td>
                <td className="px-2 py-1.5 text-text-muted text-[11px] whitespace-nowrap">
                  {format(new Date(reading.created_at), 'dd MMM yyyy, HH:mm')}
                </td>
                {isAdmin && (
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onEdit(reading)}
                        title="Edit reading"
                        aria-label="Edit reading"
                        className="w-5.5 h-5.5 inline-flex items-center justify-center rounded-[var(--radius-sm)]
                          text-text-muted hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(reading)}
                        title="Delete reading"
                        aria-label="Delete reading"
                        className="w-5.5 h-5.5 inline-flex items-center justify-center rounded-[var(--radius-sm)]
                          text-text-muted hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
