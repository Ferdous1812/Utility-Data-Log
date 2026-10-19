'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { updateHourMeterQuickAction } from '@/lib/hourActions';
import type { HourMeter, HourEquipmentGroup } from '@/types/hour';
import { useTierLabels } from '@/lib/useTierLabels';

export function getHourMeterGroup(meter: HourMeter): HourEquipmentGroup {
  if (meter.equipment_group) return meter.equipment_group;

  const cat = (meter.category || '').toLowerCase();
  const name = (meter.name || '').toLowerCase();

  // 1. Direct category match
  if (cat === 'compressor' || cat.includes('compressor') || cat.includes('comp')) return 'Compressor';
  if (cat === 'pump' || cat.includes('pump')) return 'Pump';
  if (cat === 'generator' || cat.includes('generator') || cat.includes('dg') || cat.includes('genset')) return 'Generator';
  if (cat === 'other') return 'Other';

  // 2. Name keywords match
  if (name.includes('compressor') || name.includes('comp') || name.includes('atlas') || name.includes('screw')) return 'Compressor';
  if (name.includes('pump') || name.includes('booster') || name.includes('submersible') || name.includes('water')) return 'Pump';
  if (name.includes('generator') || name.includes('gen') || name.includes('dg') || name.includes('gas eng') || name.includes('caterpillar') || name.includes('cummins') || name.includes('jenbacher')) return 'Generator';

  // 3. Fallback
  return 'Other';
}

interface EditHourMeterModalProps {
  open: boolean;
  onClose: () => void;
  meter: HourMeter | null;
  onSuccess?: (updated: { id: string; name: string; equipment_group: HourEquipmentGroup }) => void;
}

export function EditHourMeterModal({
  open,
  onClose,
  meter,
  onSuccess,
}: EditHourMeterModalProps) {
  const { addToast } = useToast();
  const tierLabels = useTierLabels();
  const [name, setName] = useState('');
  const [group, setGroup] = useState<HourEquipmentGroup>('Compressor');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const groups: { value: HourEquipmentGroup; label: string; description: string }[] = [
    { value: 'Compressor', label: tierLabels.hour_compressor || 'Compressor', description: 'Air & process compressors' },
    { value: 'Pump', label: tierLabels.hour_pump || 'Pump', description: 'Water & utility pumps' },
    { value: 'Generator', label: tierLabels.hour_generator || 'Generator', description: 'Gas & diesel generators' },
    { value: 'Other', label: tierLabels.hour_other || 'Other Machinery', description: 'Auxiliary & miscellaneous' },
  ];

  useEffect(() => {
    if (meter) {
      setName(meter.name);
      setGroup(getHourMeterGroup(meter));
      setError('');
    }
  }, [meter, open]);

  if (!meter) return null;

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
      const res = await updateHourMeterQuickAction(meter.id, {
        name: trimmed,
        equipment_group: group,
      });

      if (!res.success) {
        setError(res.message);
        addToast('error', res.message);
        setLoading(false);
        return;
      }

      addToast('success', `Updated "${trimmed}" (${group})!`);
      onSuccess?.({
        id: meter.id,
        name: trimmed,
        equipment_group: group,
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
      title="Edit Hour Meter"
      maxWidth="460px"
      compact
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Meter name input */}
        <Input
          label="Meter Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError('');
          }}
          placeholder="e.g. Air Compressor 01, Cooling Pump 02"
          required
          autoFocus
        />

        {/* Equipment Group Selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-text-secondary">
            Equipment Group
          </label>
          <div className="grid grid-cols-2 gap-2">
            {groups.map((g) => {
              const selected = group === g.value;
              return (
                <button
                  type="button"
                  key={g.value}
                  onClick={() => setGroup(g.value)}
                  className={`
                    flex items-center gap-2.5 p-2.5 rounded-[var(--radius-sm)] border text-left transition-all cursor-pointer
                    ${
                      selected
                        ? 'border-accent bg-accent/10 text-text-primary shadow-xs'
                        : 'border-border/70 bg-bg-surface hover:bg-bg-surface-hover text-text-secondary'
                    }
                  `}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold">{g.label}</div>
                    <div className="text-[10px] text-text-muted truncate">{g.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
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
