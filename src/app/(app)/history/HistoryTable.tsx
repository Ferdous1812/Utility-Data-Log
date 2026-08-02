'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { updateReadingAction, deleteReadingAction } from '@/lib/actions';
import { format } from 'date-fns';
import type { Reading, Meter, Profile, UserRole } from '@/lib/types';

interface HistoryTableProps {
  readings: (Reading & { meter: Meter; profile: Profile })[];
  userRole: UserRole;
}

export function HistoryTable({ readings, userRole }: HistoryTableProps) {
  const router = useRouter();
  const { addToast } = useToast();

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
    const res = await updateReadingAction(editingReading.id, {
      reading_value: val,
      reading_date: editDate,
    });

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

    const res = await deleteReadingAction(reading.id);
    if (res.success) {
      addToast('success', res.message);
      router.refresh();
    } else {
      addToast('error', res.message);
    }
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="sticky top-0 z-10 bg-bg-elevated">
              <th className="px-3 py-2 text-left font-bold text-[11px] uppercase tracking-wider text-text-secondary border-b-2 border-border whitespace-nowrap">Date</th>
              <th className="px-3 py-2 text-left font-bold text-[11px] uppercase tracking-wider text-text-secondary border-b-2 border-border">Meter</th>
              <th className="px-3 py-2 text-left font-bold text-[11px] uppercase tracking-wider text-text-secondary border-b-2 border-border">Type</th>
              <th className="px-3 py-2 text-right font-bold text-[11px] uppercase tracking-wider text-text-secondary border-b-2 border-border">Previous</th>
              <th className="px-3 py-2 text-right font-bold text-[11px] uppercase tracking-wider text-text-secondary border-b-2 border-border">Current</th>
              <th className="px-3 py-2 text-right font-bold text-[11px] uppercase tracking-wider text-text-secondary border-b-2 border-border">Consumed</th>
              <th className="px-3 py-2 text-left font-bold text-[11px] uppercase tracking-wider text-text-secondary border-b-2 border-border whitespace-nowrap">Logged By</th>
              <th className="px-3 py-2 text-left font-bold text-[11px] uppercase tracking-wider text-text-secondary border-b-2 border-border whitespace-nowrap">Timestamp</th>
              {isAdmin && (
                <th className="px-3 py-2 text-right font-bold text-[11px] uppercase tracking-wider text-text-secondary border-b-2 border-border whitespace-nowrap">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {readings.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 9 : 8} className="px-4 py-16 text-center text-text-muted">
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="mx-auto mb-3 opacity-40"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <p className="text-sm">No readings found</p>
                  <p className="text-xs mt-1">Try adjusting your filters or log a new reading</p>
                </td>
              </tr>
            ) : (
              readings.map((reading, idx) => {
                const prevValue =
                  reading.usage != null
                    ? Number(reading.reading_value) - Number(reading.usage)
                    : null;

                return (
                  <tr
                    key={reading.id}
                    className={`border-b border-border transition-colors hover:bg-bg-surface-hover ${
                      idx % 2 === 0 ? 'bg-bg-surface' : 'bg-bg-primary'
                    }`}
                  >
                    <td className="px-3 py-2 font-medium text-text-primary whitespace-nowrap">
                      {format(new Date(reading.reading_date), 'dd MMM yyyy')}
                    </td>
                    <td className="px-3 py-2 font-medium text-text-primary">
                      {reading.meter?.name || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          reading.meter?.type === 'incoming' || reading.meter?.type === 'main'
                            ? 'warning'
                            : reading.meter?.type === 'outgoing_main' || reading.meter?.type === 'outgoing'
                            ? 'accent'
                            : 'success'
                        }
                      >
                        {reading.meter?.type === 'incoming' || reading.meter?.type === 'main'
                          ? '⚡ Incoming'
                          : reading.meter?.type === 'outgoing_main' || reading.meter?.type === 'outgoing'
                          ? '⚡ Outgoing (Main)'
                          : '📊 Outgoing (Sub)'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right text-text-secondary tabular-nums">
                      {prevValue != null ? `${prevValue.toLocaleString()} kWh` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-text-primary tabular-nums">
                      {Number(reading.reading_value).toLocaleString()} kWh
                    </td>
                    <td className="px-3 py-2 text-right">
                      {reading.usage != null ? (
                        <span className="font-bold text-accent tabular-nums">
                          {Number(reading.usage).toLocaleString()} kWh
                        </span>
                      ) : (
                        <span className="text-text-muted text-xs">First reading</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                      {reading.profile?.full_name || '—'}
                    </td>
                    <td className="px-3 py-2 text-text-muted text-xs whitespace-nowrap">
                      {format(new Date(reading.created_at), 'dd MMM yyyy, HH:mm')}
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(reading)}
                            title="Edit reading"
                            aria-label="Edit reading"
                            className="w-7 h-7 inline-flex items-center justify-center rounded-[var(--radius-sm)]
                              text-text-muted hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(reading)}
                            title="Delete reading"
                            aria-label="Delete reading"
                            className="w-7 h-7 inline-flex items-center justify-center rounded-[var(--radius-sm)]
                              text-text-muted hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Edit Reading Modal */}
      <Modal
        open={!!editingReading}
        onClose={() => setEditingReading(null)}
        title="Edit Log Reading"
      >
        <form onSubmit={handleSaveEdit} className="flex flex-col gap-4">
          <div className="bg-bg-elevated p-3 rounded-[var(--radius-md)] border border-border">
            <span className="text-xs text-text-muted block">Meter</span>
            <span className="text-sm font-semibold text-text-primary">
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
            large
          />

          <Input
            label="Reading Date"
            type="date"
            value={editDate}
            onChange={(e) => setEditDate(e.target.value)}
            required
            large
          />

          <div className="flex gap-3 mt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditingReading(null)}
              fullWidth
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={submitting} fullWidth>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
