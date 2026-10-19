'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { Meter, MeterType, MeterSection, CustomTierLabels } from '@/lib/types';
import { DEFAULT_TIER_LABELS } from '@/lib/types';
import type { HourEquipmentGroup } from '@/types/hour';

export type UtilityDomain = 'energy' | 'gas' | 'hour';

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
    category?: string;
    is_primary_for_total?: boolean;
    include_in_energy_meters?: boolean;
    equipment_group?: HourEquipmentGroup;
    utility_domain?: UtilityDomain;
    reading_mode?: 'checkpoint' | 'split';
    branches?: { id?: string; label: string }[];
  }) => Promise<void>;
  meter?: Meter | null;
  mainMeters: Meter[];
  allMeters?: Meter[];
  sections?: MeterSection[];
  defaultSectionId?: string;
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
  defaultSectionId,
  loading = false,
}: MeterFormProps) {
  // Domain switcher: 'energy' | 'gas' | 'hour'
  const [domain, setDomain] = useState<UtilityDomain>('energy');

  // Shared form fields
  const [name, setName] = useState(meter?.name || '');
  const [location, setLocation] = useState(meter?.location || '');
  const [sectionId, setSectionId] = useState(meter?.section_id || '');
  const [multiplicationFactor, setMultiplicationFactor] = useState('1');

  // Energy fields
  const [energyType, setEnergyType] = useState<MeterType>('incoming');
  const [energyCategory, setEnergyCategory] = useState('General');
  const [energyParentId, setEnergyParentId] = useState('');
  const [energyIsPrimary, setEnergyIsPrimary] = useState(true);
  const [readingMode, setReadingMode] = useState<'checkpoint' | 'split'>('checkpoint');
  const [branches, setBranches] = useState<{ id?: string; label: string }[]>([
    { label: 'Peak' },
    { label: 'Off-Peak' },
  ]);

  // Gas fields
  const [gasType, setGasType] = useState<MeterType>('incoming');
  const [gasCategory, setGasCategory] = useState('Boiler');
  const [gasParentId, setGasParentId] = useState('');
  const [gasIsPrimary, setGasIsPrimary] = useState(true);

  // Hour fields
  const [hourEquipmentGroup, setHourEquipmentGroup] = useState<HourEquipmentGroup>('Compressor');
  const [hourCategory, setHourCategory] = useState('Air Utility');

  // Hierarchy tier customized labels
  const [tierLabels, setTierLabels] = useState<CustomTierLabels>(DEFAULT_TIER_LABELS);

  // Load custom tier names from localStorage on open
  useEffect(() => {
    if (!open) return;
    try {
      const saved = localStorage.getItem('utility_tier_labels');
      if (saved) {
        const parsed = JSON.parse(saved);
        setTierLabels({ ...DEFAULT_TIER_LABELS, ...parsed });
      }
    } catch (e) {}
  }, [open]);

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Detect domain from section or meter
  const detectDomain = (secId?: string | null, targetMeter?: Meter | null): UtilityDomain => {
    if (targetMeter) {
      if ((targetMeter as any).is_in_hour_meters || (targetMeter as any).equipment_group) return 'hour';
      if ((targetMeter as any).is_in_gas_meters) return 'gas';
      const mName = targetMeter.name.toLowerCase();
      if (mName.includes('hour') || mName.includes('hrs')) return 'hour';
      if (
        mName.includes('gas') ||
        mName.includes('rms') ||
        mName.includes('boiler') ||
        mName.includes('heat') ||
        mName.includes('chamber')
      ) return 'gas';
    }
    if (secId) {
      const sec = sections.find((s) => s.id === secId);
      if (sec) {
        const sName = (sec.name || '').toLowerCase();
        const sUnit = (sec.unit || '').toLowerCase();
        if (sName.includes('hour') || sUnit === 'hrs' || sUnit === 'hr' || sUnit.includes('hour')) return 'hour';
        if (
          sName.includes('gas') ||
          sName.includes('rms') ||
          sUnit === 'm³' ||
          sUnit === 'm3' ||
          sUnit.includes('m3') ||
          sUnit.includes('m³')
        ) return 'gas';
      }
    }
    return 'energy';
  };

  // Pre-populate fields on open or change
  useEffect(() => {
    if (!open) return;

    const initialSecId = meter?.section_id || defaultSectionId || (sections[0]?.id ?? '');
    const initialDomain = detectDomain(initialSecId, meter);
    setDomain(initialDomain);

    setName(meter?.name || '');
    setLocation(meter?.location || '');
    setSectionId(initialSecId);
    setMultiplicationFactor(
      meter?.multiplication_factor != null ? String(meter.multiplication_factor) : '1'
    );

    // Initial energy state
    const mType = meter?.type || 'incoming';
    setEnergyType(mType);
    setEnergyCategory((meter as any)?.energy_category || (meter as any)?.category || 'General');
    setEnergyParentId(meter?.parent_meter_id || '');
    setEnergyIsPrimary((meter as any)?.is_primary_for_total ?? (mType === 'incoming' || mType === 'main'));
    const savedMode = ((meter as any)?.reading_mode as 'checkpoint' | 'split') || 'checkpoint';
    setReadingMode(savedMode);
    const savedBranches = ((meter as any)?.energy_branches as { id: string; label: string }[]) || [];
    // Reuse existing devices as branches (keeps their readings); pad to two branches
    const seedBranches: { id?: string; label: string }[] = savedBranches.map((b) => ({ id: b.id, label: b.label }));
    if (seedBranches.length === 0) seedBranches.push({ label: 'Peak' });
    if (seedBranches.length < 2) seedBranches.push({ label: 'Off-Peak' });
    setBranches(seedBranches);

    // Initial gas state
    setGasType(mType);
    setGasCategory((meter as any)?.gas_category || (meter as any)?.category || 'General');
    setGasParentId(meter?.parent_meter_id || '');
    setGasIsPrimary((meter as any)?.is_primary_for_total ?? (mType === 'incoming' || mType === 'main'));

    // Initial hour state
    const rawGroup = (meter as any)?.equipment_group || (meter as any)?.category || '';
    const validGroup: HourEquipmentGroup = ['Compressor', 'Pump', 'Generator', 'Other'].includes(rawGroup)
      ? (rawGroup as HourEquipmentGroup)
      : 'Compressor';
    setHourEquipmentGroup(validGroup);
    setHourCategory((meter as any)?.category || 'Air Utility');

    setErrors({});
  }, [meter, open, sections, defaultSectionId]);

  // When domain changes manually, auto-suggest best matching section
  const handleDomainChange = (nextDomain: UtilityDomain) => {
    setDomain(nextDomain);
    if (nextDomain === 'hour') {
      const hSec = sections.find(
        (s) => s.name.toLowerCase().includes('hour') || s.unit.toLowerCase() === 'hrs' || s.unit.toLowerCase() === 'hr'
      );
      if (hSec) setSectionId(hSec.id);
    } else if (nextDomain === 'gas') {
      const gSec = sections.find(
        (s) => s.name.toLowerCase().includes('gas') || s.name.toLowerCase().includes('rms') || s.unit.toLowerCase() === 'm³' || s.unit.toLowerCase() === 'm3'
      );
      if (gSec) setSectionId(gSec.id);
    } else {
      const eSec = sections.find(
        (s) => !s.name.toLowerCase().includes('gas') && !s.name.toLowerCase().includes('rms') && !s.name.toLowerCase().includes('hour') && s.unit.toLowerCase() !== 'hrs' && s.unit.toLowerCase() !== 'm³' && s.unit.toLowerCase() !== 'm3'
      );
      if (eSec) setSectionId(eSec.id);
    }
  };

// Hierarchy levels: 0 = incoming (root), 1 = outgoing_main (mother), 2 = outgoing_sub (submeter), 3 = outgoing_sub_sub (sub-submeter)
const HIERARCHY_RANK: Record<string, number> = {
  incoming: 0,
  main: 0,
  outgoing_main: 1,
  outgoing: 1,
  outgoing_sub: 2,
  submeter: 2,
  outgoing_sub_sub: 3,
};

const getElectricalTierLabel = (type: string) => {
  if (type === 'incoming' || type === 'main') return tierLabels.incoming || 'Incoming Feeder';
  if (type === 'outgoing_main' || type === 'outgoing') return tierLabels.outgoing_main || 'Mother Panel';
  if (type === 'outgoing_sub_sub') return tierLabels.outgoing_sub_sub || 'Sub-Submeter';
  return tierLabels.outgoing_sub || 'Breaker Submeter';
};

const getGasTierLabel = (type: string) => {
  if (type === 'incoming' || type === 'main') return tierLabels.gas_incoming || 'RMS Incomer';
  if (type === 'outgoing_main' || type === 'outgoing') return tierLabels.gas_outgoing_main || 'Gas Header';
  if (type === 'outgoing_sub_sub') return tierLabels.gas_outgoing_sub_sub || 'Sub-Appliance';
  return tierLabels.gas_outgoing_sub || 'Appliance Sub';
};

function getDescendantIds(meterId: string, allMeters: Meter[]): Set<string> {
  const descendants = new Set<string>();
  const queue = [meterId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const m of allMeters) {
      if (m.parent_meter_id === currentId && !descendants.has(m.id)) {
        descendants.add(m.id);
        queue.push(m.id);
      }
    }
  }
  return descendants;
}

  // Pre-calculate descendant IDs to prevent circular parent references
  const descendantIds = useMemo(() => {
    if (!meter) return new Set<string>();
    return getDescendantIds(meter.id, allMeters);
  }, [meter, allMeters]);


  // Filtered parent meter options per domain:
  // When a section and hierarchy are selected:
  // 1. Only meters belonging to that section (sectionId) appear
  // 2. Only meters strictly ABOVE that hierarchy appear (parentRank < currentRank)
  // 3. Exclude itself and any descendants (prevent circular references)
  const energyParentOptions = useMemo(() => {
    const currentRank = HIERARCHY_RANK[energyType] ?? 99;
    return allMeters.filter((m) => {
      if (meter && m.id === meter.id) return false;
      if (descendantIds.has(m.id)) return false;

      // Must belong to the selected section
      if (sectionId && m.section_id !== sectionId) return false;
      if (!sectionId && m.section_id) return false;

      // Must be strictly above current hierarchy level
      const parentRank = HIERARCHY_RANK[m.type] ?? 99;
      return parentRank < currentRank;
    });
  }, [allMeters, meter, descendantIds, sectionId, energyType]);

  const gasParentOptions = useMemo(() => {
    const currentRank = HIERARCHY_RANK[gasType] ?? 99;
    return allMeters.filter((m) => {
      if (meter && m.id === meter.id) return false;
      if (descendantIds.has(m.id)) return false;

      // Must belong to the selected section
      if (sectionId && m.section_id !== sectionId) return false;
      if (!sectionId && m.section_id) return false;

      // Must be strictly above current hierarchy level
      const parentRank = HIERARCHY_RANK[m.type] ?? 99;
      return parentRank < currentRank;
    });
  }, [allMeters, meter, descendantIds, sectionId, gasType]);

  // Auto-clear parent selection if no longer in filtered options
  useEffect(() => {
    if (energyParentId && !energyParentOptions.some((m) => m.id === energyParentId)) {
      setEnergyParentId('');
    }
  }, [energyParentOptions, energyParentId]);

  useEffect(() => {
    if (gasParentId && !gasParentOptions.some((m) => m.id === gasParentId)) {
      setGasParentId('');
    }
  }, [gasParentOptions, gasParentId]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Meter name is required';
    if (!location.trim()) newErrors.location = 'Location / Plant Area is required';
    const mf = parseFloat(multiplicationFactor);
    if (isNaN(mf) || mf <= 0) {
      newErrors.multiplicationFactor = 'Must be a positive number';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const mf = parseFloat(multiplicationFactor) || 1;

    if (domain === 'hour') {
      await onSubmit({
        name: name.trim(),
        type: 'outgoing_sub', // default valid meter type for database constraint
        location: location.trim(),
        parent_meter_id: null,
        section_id: sectionId || null,
        multiplication_factor: mf,
        category: hourCategory.trim() || hourEquipmentGroup,
        equipment_group: hourEquipmentGroup,
        utility_domain: 'hour',
        include_in_energy_meters: false,
      });
    } else if (domain === 'gas') {
      const hasParent = gasType !== 'incoming' && gasType !== 'main';
      await onSubmit({
        name: name.trim(),
        type: gasType,
        location: location.trim(),
        parent_meter_id: hasParent ? gasParentId || null : null,
        section_id: sectionId || null,
        multiplication_factor: mf,
        category: gasCategory.trim() || 'General',
        is_primary_for_total: gasIsPrimary,
        utility_domain: 'gas',
        include_in_energy_meters: false,
      });
    } else {
      // Energy
      const hasParent = energyType !== 'incoming' && energyType !== 'main';
      await onSubmit({
        name: name.trim(),
        type: energyType,
        location: location.trim(),
        parent_meter_id: hasParent ? energyParentId || null : null,
        section_id: sectionId || null,
        multiplication_factor: mf,
        category: energyCategory.trim() || 'General',
        is_primary_for_total: energyIsPrimary,
        include_in_energy_meters: true, // Electricity meters are always added to the Energy Meter tree
        utility_domain: 'energy',
        reading_mode: readingMode,
        branches: readingMode === 'split' ? branches.map((b) => ({ ...b, label: b.label.trim() })) : undefined,
      });
    }
  };

  const activeSection = sections.find((s) => s.id === sectionId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={meter ? 'Edit Meter' : 'Add New Meter'}
      compact
      maxWidth="540px"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {/* Domain Segmented Switcher */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
            Utility Domain Template
          </label>
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-[var(--radius-md)] bg-bg-surface border border-border">
            <button
              type="button"
              onClick={() => handleDomainChange('energy')}
              className={`flex items-center justify-center py-1.5 px-2 rounded text-xs font-semibold transition-all cursor-pointer ${
                domain === 'energy'
                  ? 'bg-warning/15 text-warning border border-warning/40 shadow-xs'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated'
              }`}
            >
              <span>Electricity</span>
            </button>

            <button
              type="button"
              onClick={() => handleDomainChange('gas')}
              className={`flex items-center justify-center py-1.5 px-2 rounded text-xs font-semibold transition-all cursor-pointer ${
                domain === 'gas'
                  ? 'bg-accent/15 text-accent border border-accent/40 shadow-xs'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated'
              }`}
            >
              <span>Gas Utility</span>
            </button>

            <button
              type="button"
              onClick={() => handleDomainChange('hour')}
              className={`flex items-center justify-center py-1.5 px-2 rounded text-xs font-semibold transition-all cursor-pointer ${
                domain === 'hour'
                  ? 'bg-success/15 text-success border border-success/40 shadow-xs'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated'
              }`}
            >
              <span>Run Hours</span>
            </button>
          </div>
        </div>

        {/* Section & Unit Status Strip */}
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-[var(--radius-sm)] bg-bg-surface-hover/50 border border-border/60 text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-text-muted">Section:</span>
            <span className="font-semibold text-text-primary truncate">
              {activeSection ? activeSection.name : 'Unassigned'}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[10px] text-text-muted uppercase">Unit:</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent/15 text-accent">
              {domain === 'hour' ? 'hrs' : domain === 'gas' ? 'm³' : activeSection?.unit || 'kWh'}
            </span>
          </div>
        </div>

        {/* Core Meter Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Input
            label="Meter Name"
            placeholder={
              domain === 'hour'
                ? 'e.g. Compressor (AC-1)'
                : domain === 'gas'
                ? 'e.g. Boiler Main Gas Line'
                : 'e.g. REB Feeder 01'
            }
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
          />

          <Input
            label="Location / Plant Area"
            placeholder="e.g. Substation A, Building 2"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            error={errors.location}
          />
        </div>

        {sections.length > 0 && (
          <Select
            label="Assigned Section Tab"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            options={sections.map((s) => ({
              value: s.id,
              label: `${s.name} (${s.unit})`,
            }))}
          />
        )}

        {/* ════════════════════════════════════════════════════════
            DOMAIN 1: ELECTRICITY / ENERGY METER TEMPLATE
        ════════════════════════════════════════════════════════ */}
        {domain === 'energy' && (
          <div className="space-y-3 pt-1 border-t border-border/60">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary">Electrical Hierarchy</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {[
                  { value: 'incoming', label: tierLabels.incoming || 'Incoming Feeder' },
                  { value: 'outgoing_main', label: tierLabels.outgoing_main || 'Mother Panel' },
                  { value: 'outgoing_sub', label: tierLabels.outgoing_sub || 'Breaker Submeter' },
                  { value: 'outgoing_sub_sub', label: tierLabels.outgoing_sub_sub || 'Sub-Submeter' },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setEnergyType(item.value as MeterType)}
                    className={`py-1.5 px-2 rounded-[var(--radius-md)] border text-center cursor-pointer transition-all ${
                      energyType === item.value
                        ? 'border-accent bg-accent/10 text-accent font-semibold shadow-xs'
                        : 'border-border bg-bg-surface text-text-secondary hover:border-border-light'
                    }`}
                  >
                    <div className="text-xs font-medium leading-tight">{item.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Input
                label="Multiplication Factor (CT/PT Ratio)"
                type="number"
                step="any"
                min="0.0001"
                placeholder="1.0"
                value={multiplicationFactor}
                onChange={(e) => setMultiplicationFactor(e.target.value)}
                error={errors.multiplicationFactor}
              />

              <Input
                label="Feeder Category"
                placeholder="e.g. REB, Generator, Solar"
                value={energyCategory}
                onChange={(e) => setEnergyCategory(e.target.value)}
              />
            </div>

            {energyType !== 'incoming' && energyType !== 'main' && (
              <Select
                label={
                  energyType === 'outgoing_main'
                    ? `Parent ${tierLabels.incoming || 'Incoming Feeder'} (Optional)`
                    : energyType === 'outgoing_sub_sub'
                    ? `Parent ${tierLabels.outgoing_sub || 'Submeter'} / Feeder`
                    : `Parent ${tierLabels.outgoing_main || 'Mother Panel'} / Feeder`
                }
                placeholder={
                  energyParentOptions.length === 0
                    ? 'No higher meters in this section'
                    : energyType === 'outgoing_main'
                    ? `Select ${tierLabels.incoming || 'Incoming Feeder'} (or leave empty for standalone)...`
                    : 'Select parent electrical meter...'
                }
                options={[
                  ...(energyType === 'outgoing_main' ? [{ value: '', label: `— Standalone ${tierLabels.outgoing_main || 'Mother Panel'} (No Parent) —` }] : []),
                  ...energyParentOptions.map((m) => ({
                    value: m.id,
                    label: `${m.name} [${getElectricalTierLabel(m.type)}]${m.location ? ` • ${m.location}` : ''}`,
                  })),
                ]}
                value={energyParentId}
                onChange={(e) => setEnergyParentId(e.target.value)}
              />
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 px-0.5 py-1">
              <div className="flex items-center gap-2.5">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={energyIsPrimary}
                    onChange={(e) => setEnergyIsPrimary(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4.5 bg-border rounded-full peer peer-checked:bg-accent transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:after:translate-x-3.5" />
                </label>
                <span className="text-xs font-medium text-text-primary">Primary for Total</span>
              </div>
            </div>

            {/* Reading type: single/checkpoint meter, or split into branches (e.g. Peak / Off-Peak) */}
            <div className="flex flex-col gap-1.5 pt-1">
              <label className="text-xs font-medium text-text-secondary">Reading Type</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {([
                  { id: 'checkpoint', title: 'Single / Checkpoints', desc: 'One billing meter (default)' },
                  { id: 'split', title: 'Split (Peak / Off-Peak)', desc: 'Usage = sum of branches' },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setReadingMode(opt.id)}
                    className={`text-left px-3 py-2 rounded-[var(--radius-md)] border transition-colors cursor-pointer ${
                      readingMode === opt.id
                        ? 'border-accent bg-accent/10'
                        : 'border-border hover:bg-bg-surface-hover'
                    }`}
                  >
                    <span className="block text-xs font-semibold text-text-primary">{opt.title}</span>
                    <span className="block text-[10px] text-text-muted">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {readingMode === 'split' && (
              <div className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-border/60 p-2.5">
                <label className="text-xs font-medium text-text-secondary">
                  Branches <span className="text-text-muted font-normal">(readings are entered per branch; totals show the sum)</span>
                </label>
                {branches.map((b, i) => (
                  <div key={b.id || `new-${i}`} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={b.label}
                      onChange={(e) =>
                        setBranches((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                      }
                      placeholder={`Branch ${i + 1} name`}
                      className="flex-1 px-2.5 py-1.5 text-xs rounded-[var(--radius-md)] border border-border bg-bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() =>
                        setBranches((prev) => {
                          const next = [...prev];
                          [next[i - 1], next[i]] = [next[i], next[i - 1]];
                          return next;
                        })
                      }
                      className="px-1.5 py-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-30 cursor-pointer"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={branches.length <= 2}
                      onClick={() => setBranches((prev) => prev.filter((_, j) => j !== i))}
                      className="px-1.5 py-1 text-xs text-danger hover:opacity-80 disabled:opacity-30 cursor-pointer"
                      aria-label="Remove branch"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setBranches((prev) => [...prev, { label: '' }])}
                  className="self-start text-xs font-medium text-accent hover:underline cursor-pointer"
                >
                  + Add branch
                </button>
                {(meter as any)?.reading_mode !== 'split' && (meter as any)?.id && (
                  <p className="text-[10px] text-warning">
                    Switching to Split turns this meter&apos;s existing devices into branches; checkpoint loss is not calculated for split meters.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════
            DOMAIN 2: GAS METER TEMPLATE
        ════════════════════════════════════════════════════════ */}
        {domain === 'gas' && (
          <div className="space-y-3 pt-1 border-t border-border/60">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary">Gas Line Classification</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {[
                  { value: 'incoming', label: tierLabels.gas_incoming || 'RMS Incomer' },
                  { value: 'outgoing_main', label: tierLabels.gas_outgoing_main || 'Gas Header' },
                  { value: 'outgoing_sub', label: tierLabels.gas_outgoing_sub || 'Appliance Sub' },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setGasType(item.value as MeterType)}
                    className={`py-1.5 px-2 rounded-[var(--radius-md)] border text-center cursor-pointer transition-all ${
                      gasType === item.value
                        ? 'border-accent bg-accent/10 text-accent font-semibold shadow-xs'
                        : 'border-border bg-bg-surface text-text-secondary hover:border-border-light'
                    }`}
                  >
                    <div className="text-xs font-medium leading-tight">{item.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Input
                label="Gas Volume Multiplier (M.F)"
                type="number"
                step="any"
                min="0.0001"
                placeholder="1.0"
                value={multiplicationFactor}
                onChange={(e) => setMultiplicationFactor(e.target.value)}
                error={errors.multiplicationFactor}
              />

              <Input
                label="Gas Application / Equipment"
                placeholder="e.g. Boiler, Gas Gen, Furnace"
                value={gasCategory}
                onChange={(e) => setGasCategory(e.target.value)}
              />
            </div>

            {gasType !== 'incoming' && gasType !== 'main' && (
              <Select
                label={
                  gasType === 'outgoing_main'
                    ? `Parent ${tierLabels.gas_incoming || 'RMS Incomer'} (Optional)`
                    : `Parent ${tierLabels.gas_outgoing_main || 'Gas Header'} / Supply Line`
                }
                placeholder={
                  gasParentOptions.length === 0
                    ? 'No higher meters in this section'
                    : gasType === 'outgoing_main'
                    ? `Select ${tierLabels.gas_incoming || 'RMS Incomer'} feeder (or leave empty for standalone)...`
                    : 'Select parent gas line...'
                }
                options={[
                  ...(gasType === 'outgoing_main' ? [{ value: '', label: `— Standalone ${tierLabels.gas_outgoing_main || 'Gas Header'} (No Parent) —` }] : []),
                  ...gasParentOptions.map((m) => ({
                    value: m.id,
                    label: `${m.name} [${getGasTierLabel(m.type)}]${m.location ? ` • ${m.location}` : ''}`,
                  })),
                ]}
                value={gasParentId}
                onChange={(e) => setGasParentId(e.target.value)}
              />
            )}

            <div className="flex items-center gap-2.5 px-0.5 py-1">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={gasIsPrimary}
                  onChange={(e) => setGasIsPrimary(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-8 h-4.5 bg-border rounded-full peer peer-checked:bg-accent transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:after:translate-x-3.5" />
              </label>
              <span className="text-xs font-medium text-text-primary">Primary for Total Gas</span>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════
            DOMAIN 3: EQUIPMENT RUN HOURS TEMPLATE
        ════════════════════════════════════════════════════════ */}
        {domain === 'hour' && (
          <div className="space-y-3 pt-1 border-t border-border/60">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-secondary">
                Equipment Machinery Group
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {[
                  { value: 'Compressor', label: tierLabels.hour_compressor || 'Compressor' },
                  { value: 'Pump', label: tierLabels.hour_pump || 'Pump' },
                  { value: 'Generator', label: tierLabels.hour_generator || 'Generator' },
                  { value: 'Other', label: tierLabels.hour_other || 'Other Machinery' },
                ].map((grp) => (
                  <button
                    key={grp.value}
                    type="button"
                    onClick={() => setHourEquipmentGroup(grp.value as HourEquipmentGroup)}
                    className={`py-1.5 px-2 rounded-[var(--radius-md)] border text-center cursor-pointer transition-all ${
                      hourEquipmentGroup === grp.value
                        ? 'border-success bg-success/15 text-success font-semibold shadow-xs'
                        : 'border-border bg-bg-surface text-text-secondary hover:border-border-light'
                    }`}
                  >
                    <div className="text-xs font-medium leading-tight">{grp.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Input
                label="Hour Multiplier (M.F)"
                type="number"
                step="any"
                min="0.0001"
                placeholder="1.0"
                value={multiplicationFactor}
                onChange={(e) => setMultiplicationFactor(e.target.value)}
                error={errors.multiplicationFactor}
              />

              <Input
                label="Machinery Sub-system / Purpose"
                placeholder="e.g. Compressed Air, Water Supply"
                value={hourCategory}
                onChange={(e) => setHourCategory(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Modal Footer Actions */}
        <div className="flex gap-2 pt-2 border-t border-border mt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} fullWidth>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={loading} fullWidth>
            {meter ? 'Update Meter' : 'Save Meter'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
