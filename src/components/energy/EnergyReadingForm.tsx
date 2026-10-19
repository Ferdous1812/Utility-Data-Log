'use client';

import React, { useState } from 'react';
import type { EnergyMeter, EnergyMeterDevice, EnergyReadingLog } from '@/types/energy';
import { ENERGY_SECTION_META } from '@/types/energy';
import { logEnergyReading } from '@/lib/energyActions';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface ReadingEntry {
  device_id: string;
  value: string;
}

export function EnergyReadingForm({
  meters,
  devices,
  latestReadings,
  selectedMonth,
  onSuccess,
}: {
  meters: EnergyMeter[];
  devices: EnergyMeterDevice[];
  latestReadings: Record<string, EnergyReadingLog>;
  selectedMonth?: string;
  onSuccess?: () => void;
}) {
  const { addToast } = useToast();
  const [readingDate, setReadingDate] = useState(() => {
    const today = new Date().toISOString().split('T')[0];
    if (selectedMonth && !today.startsWith(selectedMonth)) {
      return `${selectedMonth}-01`;
    }
    return today;
  });

  React.useEffect(() => {
    if (selectedMonth) {
      const today = new Date().toISOString().split('T')[0];
      if (today.startsWith(selectedMonth)) {
        setReadingDate(today);
      } else {
        setReadingDate(`${selectedMonth}-01`);
      }
    }
  }, [selectedMonth]);

  const [entries, setEntries] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [selectedSection, setSelectedSection] = useState<string>('incoming');

  const sectionMeters = meters.filter((m) => m.section === selectedSection && m.is_active);

  function handleValueChange(deviceId: string, value: string) {
    setEntries((prev) => ({ ...prev, [deviceId]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    const toSubmit = Object.entries(entries)
      .filter(([, val]) => val.trim() !== '' && !isNaN(Number(val)))
      .map(([deviceId, val]) => ({
        device_id: deviceId,
        reading_value: Number(val),
        reading_date: readingDate,
      }));

    if (toSubmit.length === 0) {
      addToast('warning', 'No valid readings to submit.');
      setSubmitting(false);
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const entry of toSubmit) {
      const result = await logEnergyReading(entry);
      if (result.success) {
        successCount++;
      } else {
        failCount++;
        addToast('error', result.message);
      }
    }

    if (successCount > 0) {
      addToast('success', `${successCount} reading(s) logged successfully!`);
      setEntries({});
      onSuccess?.();
    }
    if (failCount > 0 && successCount > 0) {
      addToast('warning', `${failCount} reading(s) failed.`);
    }

    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-2.5">
        <Input
          label="Reading Date"
          type="date"
          value={readingDate}
          onChange={(e) => setReadingDate(e.target.value)}
          className="max-w-[170px]"
        />

        {/* Section tabs */}
        <div className="flex gap-1 bg-bg-elevated border border-border rounded-[var(--radius-md)] p-0.5">
          {(['incoming', 'outgoing_main', 'outgoing_sub', 'outgoing_sub_sub'] as const).map(
            (sec) => {
              const meta = ENERGY_SECTION_META[sec];
              const isActive = selectedSection === sec;
              return (
                <button
                  key={sec}
                  type="button"
                  onClick={() => setSelectedSection(sec)}
                  className={`
                    px-2.5 py-1 text-xs font-medium rounded-[var(--radius-sm)] transition-all cursor-pointer
                    ${isActive
                      ? 'bg-accent/15 text-accent font-semibold'
                      : 'text-text-muted hover:text-text-secondary hover:bg-bg-surface-hover'
                    }
                  `}
                >
                  {meta.label.replace(' Meters', '')}
                </button>
              );
            }
          )}
        </div>
      </div>

      {/* Reading inputs grid */}
      {sectionMeters.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-xs text-text-muted">No meters in this section.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {sectionMeters.map((meter) => {
            const meterDevices = devices
              .filter((d) => d.meter_id === meter.id)
              .sort((a, b) => a.sort_order - b.sort_order);

            if (meterDevices.length === 0) return null;

            return (
              <div
                key={meter.id}
                className="border border-border rounded-[var(--radius-md)] bg-bg-surface overflow-hidden"
              >
                {/* Meter header */}
                <div className="px-3 py-1.5 bg-bg-elevated border-b border-border flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-text-primary">{meter.name}</h4>
                  <span className="text-[10px] text-text-muted font-medium">{meter.category}</span>
                </div>

                {/* Device reading inputs */}
                <div className="p-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {meterDevices.map((device) => {
                      const latest = latestReadings[device.id];
                      const currentVal = entries[device.id] || '';

                      return (
                        <div key={device.id} className="flex flex-col gap-1">
                          <label className="text-[11px] font-medium text-text-secondary flex items-center gap-1.5">
                            {device.checkpoint_label}
                            {device.is_billing_primary && meter.reading_mode !== 'split' && (
                              <span className="text-[8px] font-bold uppercase tracking-wider text-accent bg-accent/10 px-1 py-0.2 rounded">
                                Billing
                              </span>
                            )}
                          </label>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            placeholder={
                              latest
                                ? `Prev: ${Number(latest.reading_value).toLocaleString()}`
                                : 'Enter reading'
                            }
                            value={currentVal}
                            onChange={(e) => handleValueChange(device.id, e.target.value)}
                            className="
                              w-full bg-bg-surface border border-border rounded-[var(--radius-sm)]
                              text-text-primary placeholder:text-text-muted tabular-nums
                              py-1.5 px-2.5 text-xs h-7.5
                              focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                              transition-all duration-200
                            "
                          />
                          {latest && (
                            <span className="text-[9px] text-text-muted">
                              Last: {Number(latest.reading_value).toLocaleString()} on{' '}
                              {latest.reading_date}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Submit */}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          loading={submitting}
          disabled={Object.values(entries).every((v) => v.trim() === '')}
        >
          Log Readings
        </Button>
      </div>
    </form>
  );
}
