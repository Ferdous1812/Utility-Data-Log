'use client';

import React, { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { Meter, MeterType, MeterSection } from '@/lib/types';

interface MeterFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    type: MeterType;
    location: string;
    parent_meter_id?: string | null;
    section_id?: string | null;
    multiplication_factor: number;
  }) => Promise<void>;
  meter?: Meter | null;
  mainMeters: Meter[];
  allMeters?: Meter[];
  sections?: MeterSection[];
  loading?: boolean;
}

export function MeterForm({
  open,
  onClose,
  onSubmit,
  meter,
  mainMeters,
  allMeters = [],
  sections = [],
  loading = false,
}: MeterFormProps) {
  const [name, setName] = useState(meter?.name || '');
  const [type, setType] = useState<MeterType>(
    meter?.type || 'incoming'
  );
  const [location, setLocation] = useState(meter?.location || '');
  const [sectionId, setSectionId] = useState(meter?.section_id || '');
  const [parentMeterId, setParentMeterId] = useState(meter?.parent_meter_id || '');
  const [multiplicationFactor, setMultiplicationFactor] = useState(
    meter?.multiplication_factor != null ? String(meter.multiplication_factor) : '1'
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Meter name is required';
    if (!location.trim()) newErrors.location = 'Location is required';
    const mf = parseFloat(multiplicationFactor);
    if (isNaN(mf) || mf <= 0) {
      newErrors.multiplicationFactor = 'Multiplication Factor (M.F) must be a positive number';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const isSub = type === 'outgoing_sub' || type === 'submeter' || type === 'outgoing_sub_sub';
    await onSubmit({
      name: name.trim(),
      type,
      location: location.trim(),
      parent_meter_id: isSub ? parentMeterId || null : null,
      section_id: sectionId || null,
      multiplication_factor: parseFloat(multiplicationFactor) || 1,
    });
  };

  React.useEffect(() => {
    setName(meter?.name || '');
    setType(meter?.type || 'incoming');
    setLocation(meter?.location || '');
    setSectionId(meter?.section_id || (sections.length > 0 ? sections[0].id : ''));
    setParentMeterId(meter?.parent_meter_id || '');
    setMultiplicationFactor(
      meter?.multiplication_factor != null ? String(meter.multiplication_factor) : '1'
    );
    setErrors({});
  }, [meter, open, sections]);

  // Filter out current meter from parent options to avoid self-reference
  // For outgoing_sub_sub, show outgoing_sub meters as potential parents
  const parentOptions = type === 'outgoing_sub_sub'
    ? allMeters.filter((m) => (m.type === 'outgoing_sub' || m.type === 'submeter') && (!meter || m.id !== meter.id))
    : mainMeters.filter((m) => !meter || m.id !== meter.id);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={meter ? 'Edit Meter' : 'Add New Meter'}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Meter Name"
          placeholder="e.g., Main Substation Transformer 01"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          large
        />

        {sections.length > 0 && (
          <Select
            label="Section / Category"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            options={sections.map((s) => ({
              value: s.id,
              label: `${s.icon} ${s.name}`,
            }))}
            large
          />
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Meter Classification</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label
              className={`
                flex items-center justify-center gap-1.5 py-3 px-3 rounded-[var(--radius-md)] border cursor-pointer transition-all text-center
                ${type === 'incoming' || type === 'main'
                  ? 'border-warning bg-warning/10 text-warning'
                  : 'border-border bg-bg-surface text-text-secondary hover:border-border-light'
                }
              `}
            >
              <input
                type="radio"
                name="type"
                value="incoming"
                checked={type === 'incoming' || type === 'main'}
                onChange={() => setType('incoming')}
                className="sr-only"
              />
              <span className="font-medium text-xs">⚡ Incoming</span>
            </label>

            <label
              className={`
                flex items-center justify-center gap-1.5 py-3 px-3 rounded-[var(--radius-md)] border cursor-pointer transition-all text-center
                ${type === 'outgoing_main' || type === 'outgoing'
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border bg-bg-surface text-text-secondary hover:border-border-light'
                }
              `}
            >
              <input
                type="radio"
                name="type"
                value="outgoing_main"
                checked={type === 'outgoing_main' || type === 'outgoing'}
                onChange={() => setType('outgoing_main')}
                className="sr-only"
              />
              <span className="font-medium text-xs">⚡ Outgoing (Main)</span>
            </label>

            <label
              className={`
                flex items-center justify-center gap-1.5 py-3 px-3 rounded-[var(--radius-md)] border cursor-pointer transition-all text-center
                ${type === 'outgoing_sub' || type === 'submeter'
                  ? 'border-success bg-success/10 text-success'
                  : 'border-border bg-bg-surface text-text-secondary hover:border-border-light'
                }
              `}
            >
              <input
                type="radio"
                name="type"
                value="outgoing_sub"
                checked={type === 'outgoing_sub' || type === 'submeter'}
                onChange={() => setType('outgoing_sub')}
                className="sr-only"
              />
              <span className="font-medium text-xs">📊 Outgoing (Sub)</span>
            </label>

            <label
              className={`
                flex items-center justify-center gap-1.5 py-3 px-3 rounded-[var(--radius-md)] border cursor-pointer transition-all text-center
                ${type === 'outgoing_sub_sub'
                  ? 'border-danger bg-danger/10 text-danger'
                  : 'border-border bg-bg-surface text-text-secondary hover:border-border-light'
                }
              `}
            >
              <input
                type="radio"
                name="type"
                value="outgoing_sub_sub"
                checked={type === 'outgoing_sub_sub'}
                onChange={() => setType('outgoing_sub_sub')}
                className="sr-only"
              />
              <span className="font-medium text-xs">📊 Sub of Sub</span>
            </label>
          </div>
        </div>

        <Input
          label="Location / Plant Area"
          placeholder="e.g., Substation A, Building 2, Line 4"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          error={errors.location}
          large
        />

        <Input
          label="Multiplication Factor (M.F)"
          type="number"
          step="any"
          min="0.0001"
          placeholder="1"
          value={multiplicationFactor}
          onChange={(e) => setMultiplicationFactor(e.target.value)}
          error={errors.multiplicationFactor}
          helper="Default value is 1. Used to calculate actual consumption (Difference × M.F)."
          large
        />

        {(type === 'outgoing_sub' || type === 'submeter' || type === 'outgoing_sub_sub') && (
          <Select
            label={type === 'outgoing_sub_sub' ? 'Parent Sub Meter' : 'Parent Main Meter (Optional)'}
            placeholder={type === 'outgoing_sub_sub' ? 'Select parent sub meter...' : 'Select parent main feeder panel...'}
            options={parentOptions.map((m) => ({
              value: m.id,
              label: `${m.name} — ${m.location}`,
            }))}
            value={parentMeterId}
            onChange={(e) => setParentMeterId(e.target.value)}
            error={errors.parent}
            large
          />
        )}

        <div className="flex gap-3 mt-2">
          <Button type="button" variant="ghost" onClick={onClose} fullWidth>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={loading} fullWidth>
            {meter ? 'Update Meter' : 'Add Meter'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
