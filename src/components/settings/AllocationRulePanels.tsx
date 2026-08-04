'use client';

import React, { useMemo, useState } from 'react';
import { Sigma, Minus, Plus, X, ChevronDown, Zap } from 'lucide-react';
import type { AllocationMode, Meter } from '@/lib/types';
import { buildRemainderFormula } from '@/lib/allocationFormula';

/* ────────────────────────────────────────────────────────────
   Allocation Mode toggle
   ──────────────────────────────────────────────────────────── */

interface AllocationModeToggleProps {
  mode: AllocationMode;
  onChange: (mode: AllocationMode) => void;
  disabled?: boolean;
}

export function AllocationModeToggle({ mode, onChange, disabled = false }: AllocationModeToggleProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        Allocation Mode
      </span>
      <div className="inline-flex w-full sm:w-auto rounded-[var(--radius-md)] border border-border bg-bg-primary p-1 gap-1">
        <ModeButton
          active={mode === 'direct'}
          icon={<Zap size={13} strokeWidth={2.25} />}
          label="Direct Assignment"
          disabled={disabled}
          onClick={() => onChange('direct')}
        />
        <ModeButton
          active={mode === 'calculated_remainder'}
          icon={<Sigma size={13} strokeWidth={2.25} />}
          label="Calculated Remainder"
          disabled={disabled}
          onClick={() => onChange('calculated_remainder')}
        />
      </div>
    </div>
  );
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
  disabled,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`
        flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5
        px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-semibold
        transition-all duration-150 cursor-pointer whitespace-nowrap
        disabled:opacity-50 disabled:cursor-not-allowed
        ${
          active
            ? 'bg-accent text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.15)]'
            : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover'
        }
      `}
    >
      {icon}
      {label}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────
   Calculated Remainder panel
   ──────────────────────────────────────────────────────────── */

export interface RemainderRuleValue {
  baseSourceMeterId: string | null;
  deductionMeterIds: string[];
  remainderSharePercent: number;
}

interface CalculatedRemainderPanelProps {
  unitId: string;
  /** Candidate "Main Meter" sources — typically root (parentless) meters. */
  baseSourceOptions: Meter[];
  /** Candidate meters that can be subtracted from the base source — typically its descendants. */
  deductionCandidates: Meter[];
  /** Full meter list, used to resolve names/codes for already-selected ids. */
  allMeters: Meter[];
  value: RemainderRuleValue;
  onChange: (patch: Partial<RemainderRuleValue>) => void;
}

export function CalculatedRemainderPanel({
  unitId,
  baseSourceOptions,
  deductionCandidates,
  allMeters,
  value,
  onChange,
}: CalculatedRemainderPanelProps) {
  const [pendingDeductionId, setPendingDeductionId] = useState('');

  const baseMeter = allMeters.find((m) => m.id === value.baseSourceMeterId);
  const deductionMeters = value.deductionMeterIds
    .map((id) => allMeters.find((m) => m.id === id))
    .filter((m): m is Meter => !!m);

  function addDeduction() {
    if (!pendingDeductionId) return;
    onChange({ deductionMeterIds: [...value.deductionMeterIds, pendingDeductionId] });
    setPendingDeductionId('');
  }

  function removeDeduction(meterId: string) {
    onChange({ deductionMeterIds: value.deductionMeterIds.filter((id) => id !== meterId) });
  }

  const formulaPreview = useMemo(
    () => buildRemainderFormula(baseMeter, deductionMeters, value.remainderSharePercent),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseMeter?.id, deductionMeters.map((m) => m.id).join(','), value.remainderSharePercent]
  );

  return (
    <div className="border border-border rounded-[var(--radius-md)] bg-bg-elevated p-3.5 flex flex-col gap-3.5">
      {/* Base Source */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`base-source-${unitId}`}
          className="text-[11px] font-semibold uppercase tracking-wider text-text-muted"
        >
          Base Source
        </label>
        <div className="relative">
          <select
            id={`base-source-${unitId}`}
            value={value.baseSourceMeterId ?? ''}
            onChange={(e) =>
              onChange({
                baseSourceMeterId: e.target.value || null,
                // Changing the base source invalidates deductions from the old tree.
                deductionMeterIds: [],
              })
            }
            className="w-full appearance-none bg-bg-surface border border-border rounded-[var(--radius-sm)] text-sm text-text-primary pl-3 pr-8 py-1.5 cursor-pointer focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          >
            <option value="" disabled>
              Select the Main / Base meter…
            </option>
            {baseSourceOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={13}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted"
          />
        </div>
        {baseSourceOptions.length === 0 && (
          <p className="text-[11px] text-warning">No root-level (parentless) meters available to use as a Base Source.</p>
        )}
      </div>

      {/* Deductions */}
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          <Minus size={11} strokeWidth={2.5} />
          Deductions
        </label>

        <div className="flex flex-wrap gap-1.5 min-h-[26px]">
          {deductionMeters.map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium bg-danger/10 text-danger border border-danger/20"
            >
              {m.name}
              <button
                type="button"
                onClick={() => removeDeduction(m.id)}
                title={`Remove ${m.name}`}
                className="flex items-center justify-center w-4 h-4 rounded-full hover:bg-danger/20 transition-colors cursor-pointer"
              >
                <X size={10} strokeWidth={2.5} />
              </button>
            </span>
          ))}
          {deductionMeters.length === 0 && (
            <span className="text-xs text-text-muted italic py-1">No deductions applied</span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-0.5">
          <div className="relative flex-1">
            <select
              value={pendingDeductionId}
              onChange={(e) => setPendingDeductionId(e.target.value)}
              disabled={!value.baseSourceMeterId || deductionCandidates.length === 0}
              className="w-full appearance-none bg-bg-surface border border-border rounded-[var(--radius-sm)] text-sm text-text-primary pl-3 pr-8 py-1.5 cursor-pointer focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">
                {!value.baseSourceMeterId
                  ? 'Select a Base Source first…'
                  : deductionCandidates.length === 0
                  ? 'No eligible submeters left'
                  : 'Select a meter to deduct…'}
              </option>
              {deductionCandidates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={13}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted"
            />
          </div>
          <button
            type="button"
            onClick={addDeduction}
            disabled={!pendingDeductionId}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-semibold border border-border text-text-primary hover:bg-bg-surface-hover hover:border-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex-shrink-0"
          >
            <Plus size={12} />
            Add
          </button>
        </div>
        <p className="text-[11px] text-text-muted">
          Only meters nested under the selected Base Source can be deducted.
        </p>
      </div>

      {/* Remainder Share % */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`remainder-share-${unitId}`}
          className="text-[11px] font-semibold uppercase tracking-wider text-text-muted"
        >
          Remainder Share %
        </label>
        <div className="relative w-28">
          <input
            id={`remainder-share-${unitId}`}
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={value.remainderSharePercent}
            onChange={(e) => onChange({ remainderSharePercent: clampPercent(Number(e.target.value)) })}
            className="w-full bg-bg-surface border border-border rounded-[var(--radius-sm)] text-sm tabular-nums text-text-primary pl-3 pr-7 py-1.5 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-text-muted pointer-events-none">
            %
          </span>
        </div>
      </div>

      {/* Formula preview */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-sm)] bg-accent/[0.06] border border-accent/20">
        <Sigma size={13} strokeWidth={2.25} className="text-accent flex-shrink-0 mt-[1px]" />
        <code className="text-xs font-mono text-accent leading-relaxed break-all">{formulaPreview}</code>
      </div>
    </div>
  );
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Small unit-card badge used in the Major Units list to show the active mode at a glance. */
export function AllocationModeBadge({ mode }: { mode: AllocationMode }) {
  if (mode === 'calculated_remainder') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[10px] font-semibold uppercase tracking-wider bg-accent/12 text-accent">
        <Sigma size={9} strokeWidth={2.5} />
        Remainder
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[10px] font-semibold uppercase tracking-wider bg-border/60 text-text-secondary">
      <Zap size={9} strokeWidth={2.5} />
      Direct
    </span>
  );
}
