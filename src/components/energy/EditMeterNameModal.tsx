'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { updateEnergyMeterQuickAction } from '@/lib/energyActions';
import type { EnergyMeter } from '@/types/energy';
import { ENERGY_SECTION_META } from '@/types/energy';

interface EditMeterNameModalProps {
  open: boolean;
  onClose: () => void;
  meter: EnergyMeter | null;
  onSuccess?: (updatedMeter: { id: string; name: string; is_primary_for_total: boolean }) => void;
  onUpdate?: (id: string, payload: { name: string; is_primary_for_total?: boolean }) => Promise<{ success: boolean; message: string }>;
}

export function EditMeterNameModal({
  open,
  onClose,
  meter,
  onSuccess,
  onUpdate,
}: EditMeterNameModalProps) {
  const { addToast } = useToast();
  const [name, setName] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (meter) {
      setName(meter.name);
      setIsPrimary(meter.is_primary_for_total);
      setError('');
    }
  }, [meter, open]);

  if (!meter) return null;

  const sectionMeta = ENERGY_SECTION_META[meter.section];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Meter name cannot be empty.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const updateFn = onUpdate || updateEnergyMeterQuickAction;
      const res = await updateFn(meter.id, {
        name: trimmed,
        is_primary_for_total: isPrimary,
      });

      if (!res.success) {
        setError(res.message);
        addToast('error', res.message);
        setLoading(false);
        return;
      }

      addToast('success', res.message);
      onSuccess?.({
        id: meter.id,
        name: trimmed,
        is_primary_for_total: isPrimary,
      });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update meter.';
      setError(msg);
      addToast('error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Meter"
      maxWidth="440px"
      compact
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Section info header */}
        <div className="flex items-center justify-between text-xs p-2.5 rounded-[var(--radius-sm)] bg-bg-surface-hover/70 border border-border/60">
          <span className="text-text-muted">Section:</span>
          <span className="font-semibold text-text-primary">
            {sectionMeta ? sectionMeta.label : meter.section}
          </span>
        </div>

        {/* Meter name input */}
        <Input
          label="Meter Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError('');
          }}
          placeholder="e.g. Incomer 1, LT Panel"
          required
          autoFocus
        />

        {/* Primary meter toggle */}
        <div className="flex flex-col gap-1.5 p-3 rounded-[var(--radius-sm)] bg-bg-surface border border-border/80">
          <label className="flex items-center justify-between cursor-pointer select-none">
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ring-2 transition-colors ${
                  isPrimary
                    ? 'bg-success ring-success/25'
                    : 'bg-danger ring-danger/25'
                }`}
              />
              <span className="text-xs font-medium text-text-primary">
                Primary Meter Status
              </span>
            </div>
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              className="w-4 h-4 accent-accent rounded cursor-pointer"
            />
          </label>
          <p className="text-[11px] text-text-muted pl-4.5">
            {isPrimary ? (
              <span className="text-success font-medium">
                Primary: Counted in total incoming / outgoing consumption.
              </span>
            ) : (
              <span className="text-danger font-medium">
                Non-Primary: Checkpoint or sub-monitoring only (excluded from total).
              </span>
            )}
          </p>
        </div>

        {error && (
          <div className="p-2.5 rounded-[var(--radius-sm)] bg-danger/10 border border-danger/30 text-xs text-danger font-medium">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={loading}
            disabled={loading || !name.trim()}
          >
            Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
