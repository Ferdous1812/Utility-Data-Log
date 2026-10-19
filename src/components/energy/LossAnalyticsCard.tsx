'use client';

import React from 'react';
import type {
  EnergyMeter,
  EnergyMeterDevice,
  EnergyReadingLog,
  CheckpointLoss,
} from '@/types/energy';
import {
  calculateAllCheckpointLosses,
  calculateSystemLoss,
  totalIncomingEnergy,
  totalOutgoingMainEnergy,
} from '@/lib/calculations/energy';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

// ─── System-level Loss Summary Card ────────────────────────

export function SystemLossCard({
  meters,
  devices,
  logs,
}: {
  meters: EnergyMeter[];
  devices: EnergyMeterDevice[];
  logs: EnergyReadingLog[];
}) {
  const incoming = totalIncomingEnergy(meters, devices, logs);
  const outgoing = totalOutgoingMainEnergy(meters, devices, logs);
  const { lossKwh, lossPercent } = calculateSystemLoss(meters, devices, logs);

  return (
    <Card className="relative overflow-hidden !p-0">
      {/* Top accent stripe */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{
          background: lossPercent > 5
            ? 'var(--color-danger)'
            : lossPercent > 2
              ? 'var(--color-warning)'
              : 'var(--color-success)',
        }}
      />

      <div className="p-5 pt-[22px]">
        <div className="flex items-start justify-between mb-4">
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-text-secondary">
              System Balance / Busbar Loss
            </span>
            <p className="text-2xl font-semibold text-text-primary tabular-nums mt-1">
              {Math.abs(lossKwh).toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh
            </p>
          </div>
          <div
            className={`
              flex items-center justify-center w-11 h-11 rounded-[var(--radius-md)]
              ${lossPercent > 5 ? 'bg-danger/12' : lossPercent > 2 ? 'bg-warning/12' : 'bg-success/12'}
            `}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={
                lossPercent > 5 ? 'text-danger' : lossPercent > 2 ? 'text-warning' : 'text-success'
              }
            >
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
        </div>

        {/* Breakdown bar */}
        <div className="flex items-center gap-3 text-xs mb-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-warning" />
            <span className="text-text-secondary">
              Incoming: {incoming.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-accent" />
            <span className="text-text-secondary">
              Outgoing: {outgoing.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh
            </span>
          </div>
        </div>

        {/* Visual bar */}
        <div className="w-full h-2 bg-border rounded-full overflow-hidden">
          <div className="h-full flex">
            {incoming > 0 && (
              <>
                <div
                  className="h-full bg-accent transition-all duration-500"
                  style={{ width: `${Math.min((outgoing / incoming) * 100, 100)}%` }}
                />
                <div
                  className={`h-full transition-all duration-500 ${
                    lossPercent > 5 ? 'bg-danger' : lossPercent > 2 ? 'bg-warning' : 'bg-success'
                  }`}
                  style={{ width: `${Math.min(Math.abs(lossPercent), 100)}%` }}
                />
              </>
            )}
          </div>
        </div>

        {/* Loss percentage */}
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-text-muted">Difference</span>
          <Badge
            variant={lossPercent > 5 ? 'danger' : lossPercent > 2 ? 'warning' : 'success'}
          >
            {lossKwh >= 0 ? 'Loss' : 'Gain'}: {Math.abs(lossPercent).toFixed(1)}%
          </Badge>
        </div>
      </div>
    </Card>
  );
}

// ─── Per-Meter Loss Analytics Card ──────────────────────────

export function MeterLossCard({
  meter,
  devices,
  logs,
}: {
  meter: EnergyMeter;
  devices: EnergyMeterDevice[];
  logs: EnergyReadingLog[];
}) {
  // Split meters (Peak / Off-Peak) have parallel branches – no checkpoint loss
  const losses = meter.reading_mode === 'split' ? [] : calculateAllCheckpointLosses(meter.id, devices, logs);

  if (losses.length === 0) return null;

  const totalLoss = losses.reduce((sum, l) => sum + l.loss_kwh, 0);
  const avgPercent =
    losses.length > 0
      ? losses.reduce((sum, l) => sum + l.loss_percent, 0) / losses.length
      : 0;

  return (
    <Card>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-sm font-semibold text-text-primary">{meter.name}</h4>
          <p className="text-xs text-text-muted">{meter.category} · Checkpoint Analysis</p>
        </div>
        <Badge variant={avgPercent > 5 ? 'danger' : avgPercent > 2 ? 'warning' : 'success'}>
          Avg {Math.abs(avgPercent).toFixed(1)}%
        </Badge>
      </div>

      {/* Loss chain visualization */}
      <div className="flex flex-col gap-2">
        {losses.map((loss, idx) => (
          <LossRow key={idx} loss={loss} />
        ))}
      </div>

      {/* Total */}
      <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
        <span className="text-xs font-semibold text-text-secondary">Total Chain Loss</span>
        <span className="text-sm font-semibold text-text-primary tabular-nums">
          {Math.abs(totalLoss).toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh
        </span>
      </div>
    </Card>
  );
}

// ─── Loss Row ───────────────────────────────────────────────

function LossRow({ loss }: { loss: CheckpointLoss }) {
  const isNegative = loss.loss_kwh < 0;
  const color = isNegative
    ? 'text-success'
    : loss.loss_percent > 5
      ? 'text-danger'
      : loss.loss_percent > 2
        ? 'text-warning'
        : 'text-success';

  return (
    <div className="flex items-center gap-2 p-2.5 rounded-[var(--radius-sm)] bg-bg-elevated border border-border">
      {/* Upstream */}
      <div className="flex-1 min-w-0">
        <span className="text-xs text-text-muted truncate block">{loss.upstream_label}</span>
        <span className="text-sm font-medium text-text-primary tabular-nums">
          {loss.upstream_reading.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        </span>
      </div>

      {/* Arrow + loss */}
      <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-text-muted"
        >
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
        <span className={`text-[10px] font-bold ${color} tabular-nums`}>
          {isNegative ? '+' : '-'}
          {Math.abs(loss.loss_kwh).toLocaleString(undefined, { maximumFractionDigits: 1 })}
        </span>
      </div>

      {/* Downstream */}
      <div className="flex-1 min-w-0 text-right">
        <span className="text-xs text-text-muted truncate block">{loss.downstream_label}</span>
        <span className="text-sm font-medium text-text-primary tabular-nums">
          {loss.downstream_reading.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        </span>
      </div>

      {/* Percent badge */}
      <Badge
        variant={isNegative ? 'success' : loss.loss_percent > 5 ? 'danger' : 'warning'}
        className="flex-shrink-0 tabular-nums"
      >
        {Math.abs(loss.loss_percent).toFixed(1)}%
      </Badge>
    </div>
  );
}

// ─── Combined Loss Analytics Panel ──────────────────────────

export function LossAnalyticsCard({
  meters,
  devices,
  logs,
}: {
  meters: EnergyMeter[];
  devices: EnergyMeterDevice[];
  logs: EnergyReadingLog[];
}) {
  // Only show meters with multiple checkpoints
  const metersWithLoss = meters.filter((m) => {
    const devCount = devices.filter((d) => d.meter_id === m.id).length;
    return devCount >= 2;
  });

  return (
    <div className="flex flex-col gap-4">
      {/* System-level card */}
      <SystemLossCard meters={meters} devices={devices} logs={logs} />

      {/* Per-meter cards */}
      {metersWithLoss.length > 0 && (
        <>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Per-Meter Checkpoint Analysis
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {metersWithLoss.map((meter) => (
              <MeterLossCard key={meter.id} meter={meter} devices={devices} logs={logs} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
