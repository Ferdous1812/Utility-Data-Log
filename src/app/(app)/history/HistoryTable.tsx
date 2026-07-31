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
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-elevated border-b border-border">
              <th className="px-4 py-3 text-left font-semibold text-text-secondary">Date</th>
              <th className="px-4 py-3 text-left font-semibold text-text-secondary">Meter</th>
              <th className="px-4 py-3 text-left font-semibold text-text-secondary">Type</th>
              <th className="px-4 py-3 text-right font-semibold text-text-secondary">Previous</th>
              <th className="px-4 py-3 text-right font-semibold text-text-secondary">Current</th>
              <th className="px-4 py-3 text-right font-semibold text-text-secondary">Consumed</th>
              <th className="px-4 py-3 text-left font-semibold text-text-secondary">Logged By</th>
              <th className="px-4 py-3 text-left font-semibold text-text-secondary">Timestamp</th>
              {isAdmin && (
                <th className="px-4 py-3 text-right font-semibold text-text-secondary">Admin Actions</th>
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
                    className={`border-b border-border/50 transition-colors hover:bg-bg-surface-hover ${
                      idx % 2 === 0 ? 'bg-bg-surface' : 'bg-bg-primary/50'
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-text-primary whitespace-nowrap">
                      {format(new Date(reading.reading_date), 'dd MMM yyyy')}
                    </td>
                    <td className="px-4 py-3 font-medium text-text-primary">
                      {reading.meter?.name || '—'}
                    </td>
                    <td className="px-4 py-3">
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
                    <td className="px-4 py-3 text-right text-text-secondary tabular-nums">
                      {prevValue != null ? `${prevValue.toLocaleString()} kWh` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-text-primary tabular-nums">
                      {Number(reading.reading_value).toLocaleString()} kWh
                    </td>
                    <td className="px-4 py-3 text-right">
                      {reading.usage != null ? (
                        <span className="font-bold text-accent tabular-nums">
                          {Number(reading.usage).toLocaleString()} kWh
                        </span>
                      ) : (
                        <span className="text-text-muted text-xs">First reading</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                      {reading.profile?.full_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs whitespace-nowrap">
                      {format(new Date(reading.created_at), 'dd MMM yyyy, HH:mm')}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenEdit(reading)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(reading)}
                            className="text-danger hover:text-danger"
                          >
                            Delete
                          </Button>
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
