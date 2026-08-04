'use client';

import React, { useMemo, useState } from 'react';
import {
  Sigma,
  Minus,
  Plus,
  X,
  ChevronDown,
  Zap,
  GitBranch,
  Save,
  RotateCcw,
} from 'lucide-react';
import type { Meter, Unit } from '@/lib/types';

/* ────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────── */

export type AllocationMode = 'direct' | 'calculated_remainder';

export interface DirectAssignmentRow {
  meterId: string;
  sharePercent: number;
}

export interface UnitAllocationRule {
  unitId: string;
  mode: AllocationMode;
  /** Direct Assignment */
  directAssignments: DirectAssignmentRow[];
  /** Calculated Remainder */
  baseSourceMeterId: string | null;
  deductionMeterIds: string[];
  remainderSharePercent: number;
}

interface MeterAllocationRuleBuilderProps {
  units: Unit[];
  meters: Meter[];
  /** Existing rules keyed by unit id. Units without an entry fall back to a blank Direct Assignment rule. */
  initialRules?: Record<string, UnitAllocationRule>;
  /** Fired on every local edit, useful for unsaved-changes indicators upstream. */
  onChange?: (rules: Record<string, UnitAllocationRule>) => void;
  /** Fired when the operator commits the configuration (e.g. persist via unitActions.ts). */
  onSave?: (rules: Record<string, UnitAllocationRule>) => void | Promise<void>;
  className?: string;
}

/* ────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────── */

function blankRule(unitId: string): UnitAllocationRule {
  return {
    unitId,
    mode: 'direct',
    directAssignments: [],
    baseSourceMeterId: null,
    deductionMeterIds: [],
    remainderSharePercent: 100,
  };
}

/** Derives a terse, formula-friendly token from a meter name, e.g. "Main Incoming 01" -> "MAIN_INCOMING_01" */
function meterCode(meter: Meter | undefined): string {
  if (!meter) return 'UNKNOWN';
  return meter.name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function meterById(meters: Meter[], id: string | null): Meter | undefined {
  if (!id) return undefined;
  return meters.find((m) => m.id === id);
}

/* ────────────────────────────────────────────────────────────
   Root component
   ──────────────────────────────────────────────────────────── */

export function MeterAllocationRuleBuilder({
  units,
  meters,
  initialRules,
  onChange,
  onSave,
  className = '',
}: MeterAllocationRuleBuilderProps) {
  const [rules, setRules] = useState<Record<string, UnitAllocationRule>>(() => {
    const seed: Record<string, UnitAllocationRule> = {};
    for (const unit of units) {
      seed[unit.id] = initialRules?.[unit.id] ?? blankRule(unit.id);
    }
    return seed;
  });
  const [savingUnitId, setSavingUnitId] = useState<string | null>(null);
  const [dirtyUnitIds, setDirtyUnitIds] = useState<Set<string>>(new Set());

  function updateRule(unitId: string, next: UnitAllocationRule) {
    setRules((prev) => {
      const updated = { ...prev, [unitId]: next };
      onChange?.(updated);
      return updated;
    });
    setDirtyUnitIds((prev) => new Set(prev).add(unitId));
  }

  async function handleSaveUnit(unitId: string) {
    setSavingUnitId(unitId);
    try {
      await onSave?.(rules);
      setDirtyUnitIds((prev) => {
        const next = new Set(prev);
        next.delete(unitId);
        return next;
      });
    } finally {
      setSavingUnitId(null);
    }
  }

  function handleResetUnit(unitId: string) {
    updateRule(unitId, initialRules?.[unitId] ?? blankRule(unitId));
    setDirtyUnitIds((prev) => {
      const next = new Set(prev);
      next.delete(unitId);
      return next;
    });
  }

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {units.map((unit) => (
        <UnitAllocationCard
          key={unit.id}
          unit={unit}
          meters={meters}
          rule={rules[unit.id] ?? blankRule(unit.id)}
          isDirty={dirtyUnitIds.has(unit.id)}
          isSaving={savingUnitId === unit.id}
          onChange={(next) => updateRule(unit.id, next)}
          onSave={() => handleSaveUnit(unit.id)}
          onReset={() => handleResetUnit(unit.id)}
        />
      ))}

      {units.length === 0 && (
        <div className="border border-dashed border-border rounded-[var(--radius-lg)] px-5 py-8 text-center">
          <p className="text-sm text-text-muted">No units configured yet.</p>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Unit setup card
   ──────────────────────────────────────────────────────────── */

interface UnitAllocationCardProps {
  unit: Unit;
  meters: Meter[];
  rule: UnitAllocationRule;
  isDirty: boolean;
  isSaving: boolean;
  onChange: (rule: UnitAllocationRule) => void;
  onSave: () => void;
  onReset: () => void;
}

function UnitAllocationCard({
  unit,
  meters,
  rule,
  isDirty,
  isSaving,
  onChange,
  onSave,
  onReset,
}: UnitAllocationCardProps) {
  const directTotal = rule.directAssignments.reduce((sum, row) => sum + (row.sharePercent || 0), 0);

  return (
    <div className="bg-bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-bg-elevated">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] bg-accent/12 text-accent flex-shrink-0">
            <GitBranch size={14} strokeWidth={2.25} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{unit.name}</p>
            <p className="text-[11px] text-text-muted font-mono truncate">UNIT_{unit.id.slice(0, 8).toUpperCase()}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isDirty && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-warning">
              <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse-glow" />
              Unsaved
            </span>
          )}
          <button
            type="button"
            onClick={onReset}
            disabled={!isDirty || isSaving}
            title="Discard changes"
            className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!isDirty || isSaving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-semibold bg-accent text-white hover:bg-accent-dim transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Save size={12} />
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Card body */}
      <div className="p-4 flex flex-col gap-4">
        {/* Allocation Mode toggle */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Allocation Mode
          </span>
          <div className="inline-flex w-full sm:w-auto rounded-[var(--radius-md)] border border-border bg-bg-primary p-1 gap-1">
            <ModeButton
              active={rule.mode === 'direct'}
              icon={<Zap size={13} strokeWidth={2.25} />}
              label="Direct Assignment"
              onClick={() => onChange({ ...rule, mode: 'direct' })}
            />
            <ModeButton
              active={rule.mode === 'calculated_remainder'}
              icon={<Sigma size={13} strokeWidth={2.25} />}
              label="Calculated Remainder"
              onClick={() => onChange({ ...rule, mode: 'calculated_remainder' })}
            />
          </div>
        </div>

        {rule.mode === 'direct' ? (
          <DirectAssignmentPanel
            meters={meters}
            rows={rule.directAssignments}
            onChangeRows={(rows) => onChange({ ...rule, directAssignments: rows })}
          />
        ) : (
          <CalculatedRemainderPanel
            meters={meters}
            rule={rule}
            onChangeRule={(patch) => onChange({ ...rule, ...patch })}
          />
        )}

        {rule.mode === 'direct' && (
          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border/70">
            <span className="uppercase tracking-wider text-text-muted font-semibold">Total Share Assigned</span>
            <span
              className={`font-mono font-semibold tabular-nums ${
                directTotal === 100
                  ? 'text-success'
                  : directTotal > 100
                  ? 'text-danger'
                  : 'text-warning'
              }`}
            >
              {directTotal.toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5
        px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-semibold
        transition-all duration-150 cursor-pointer whitespace-nowrap
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
   Direct Assignment panel
   ──────────────────────────────────────────────────────────── */

function DirectAssignmentPanel({
  meters,
  rows,
  onChangeRows,
}: {
  meters: Meter[];
  rows: DirectAssignmentRow[];
  onChangeRows: (rows: DirectAssignmentRow[]) => void;
}) {
  const [pendingMeterId, setPendingMeterId] = useState('');
  const assignedIds = new Set(rows.map((r) => r.meterId));
  const availableMeters = meters.filter((m) => !assignedIds.has(m.id));

  function addRow() {
    if (!pendingMeterId) return;
    onChangeRows([...rows, { meterId: pendingMeterId, sharePercent: 100 }]);
    setPendingMeterId('');
  }

  function updateShare(meterId: string, sharePercent: number) {
    onChangeRows(
      rows.map((r) => (r.meterId === meterId ? { ...r, sharePercent: clampPercent(sharePercent) } : r))
    );
  }

  function removeRow(meterId: string) {
    onChangeRows(rows.filter((r) => r.meterId !== meterId));
  }

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        Assigned Meters
      </span>

      <div className="border border-border rounded-[var(--radius-md)] overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-table-header border-b border-table-header-border">
              <th className="text-left px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Meter
              </th>
              <th className="text-left px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Location
              </th>
              <th className="text-right px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-28">
                Share %
              </th>
              <th className="w-9" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const meter = meterById(meters, row.meterId);
              return (
                <tr key={row.meterId} className="border-b border-border last:border-b-0 hover:bg-bg-surface-hover">
                  <td className="px-3 py-1.5 text-sm text-text-primary truncate max-w-[180px]">
                    {meter?.name ?? 'Unknown meter'}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-text-secondary truncate max-w-[140px]">
                    {meter?.location ?? '—'}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={row.sharePercent}
                        onChange={(e) => updateShare(row.meterId, Number(e.target.value))}
                        className="w-16 bg-bg-primary border border-border rounded-[var(--radius-sm)] text-right text-sm tabular-nums text-text-primary px-2 py-1 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                      />
                      <span className="text-xs text-text-muted">%</span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(row.meterId)}
                      title="Remove meter"
                      className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)] text-text-muted hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-3 text-center text-xs text-text-muted">
                  No meters assigned yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add meter row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <select
            value={pendingMeterId}
            onChange={(e) => setPendingMeterId(e.target.value)}
            className="w-full appearance-none bg-bg-primary border border-border rounded-[var(--radius-sm)] text-sm text-text-primary pl-3 pr-8 py-1.5 cursor-pointer focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={availableMeters.length === 0}
          >
            <option value="">
              {availableMeters.length === 0 ? 'All meters assigned' : 'Select a meter to add…'}
            </option>
            {availableMeters.map((m) => (
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
          onClick={addRow}
          disabled={!pendingMeterId}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-semibold border border-border text-text-primary hover:bg-bg-surface-hover hover:border-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex-shrink-0"
        >
          <Plus size={12} />
          Add
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Calculated Remainder panel
   ──────────────────────────────────────────────────────────── */

function CalculatedRemainderPanel({
  meters,
  rule,
  onChangeRule,
}: {
  meters: Meter[];
  rule: UnitAllocationRule;
  onChangeRule: (patch: Partial<UnitAllocationRule>) => void;
}) {
  const [pendingDeductionId, setPendingDeductionId] = useState('');

  const deductionCandidates = meters.filter(
    (m) => m.id !== rule.baseSourceMeterId && !rule.deductionMeterIds.includes(m.id)
  );

  function addDeduction() {
    if (!pendingDeductionId) return;
    onChangeRule({ deductionMeterIds: [...rule.deductionMeterIds, pendingDeductionId] });
    setPendingDeductionId('');
  }

  function removeDeduction(meterId: string) {
    onChangeRule({ deductionMeterIds: rule.deductionMeterIds.filter((id) => id !== meterId) });
  }

  const baseMeter = meterById(meters, rule.baseSourceMeterId);
  const deductionMeters = rule.deductionMeterIds.map((id) => meterById(meters, id)).filter(Boolean) as Meter[];

  const formulaPreview = useMemo(() => {
    const baseToken = baseMeter ? meterCode(baseMeter) : 'BASE_SOURCE';
    const share = Number.isFinite(rule.remainderSharePercent) ? rule.remainderSharePercent : 0;

    if (deductionMeters.length === 0) {
      return `Formula: ${baseToken} * ${share}%`;
    }

    const sumToken = `SUM(${deductionMeters.map((m) => meterCode(m)).join(', ')})`;
    return `Formula: ( ${baseToken} - ${sumToken} ) * ${share}%`;
  }, [baseMeter, deductionMeters, rule.remainderSharePercent]);

  return (
    <div className="border border-border rounded-[var(--radius-md)] bg-bg-elevated p-3.5 flex flex-col gap-3.5">
      {/* Base Source */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`base-source-${rule.unitId}`}
          className="text-[11px] font-semibold uppercase tracking-wider text-text-muted"
        >
          Base Source
        </label>
        <div className="relative">
          <select
            id={`base-source-${rule.unitId}`}
            value={rule.baseSourceMeterId ?? ''}
            onChange={(e) =>
              onChangeRule({
                baseSourceMeterId: e.target.value || null,
                deductionMeterIds: rule.deductionMeterIds.filter((id) => id !== e.target.value),
              })
            }
            className="w-full appearance-none bg-bg-surface border border-border rounded-[var(--radius-sm)] text-sm text-text-primary pl-3 pr-8 py-1.5 cursor-pointer focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          >
            <option value="" disabled>
              Select the Main / Base meter…
            </option>
            {meters.map((m) => (
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
              disabled={!rule.baseSourceMeterId || deductionCandidates.length === 0}
              className="w-full appearance-none bg-bg-surface border border-border rounded-[var(--radius-sm)] text-sm text-text-primary pl-3 pr-8 py-1.5 cursor-pointer focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">
                {!rule.baseSourceMeterId ? 'Select a Base Source first…' : 'Select a meter to deduct…'}
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
      </div>

      {/* Remainder Share % */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`remainder-share-${rule.unitId}`}
          className="text-[11px] font-semibold uppercase tracking-wider text-text-muted"
        >
          Remainder Share %
        </label>
        <div className="relative w-28">
          <input
            id={`remainder-share-${rule.unitId}`}
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={rule.remainderSharePercent}
            onChange={(e) => onChangeRule({ remainderSharePercent: clampPercent(Number(e.target.value)) })}
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

/* ────────────────────────────────────────────────────────────
   Utils
   ──────────────────────────────────────────────────────────── */

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export default MeterAllocationRuleBuilder;
