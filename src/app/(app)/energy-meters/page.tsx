import { format, subDays } from 'date-fns';
import {
  getEnergyMeters,
  getEnergyMeterDevices,
  getEnergyReadingLogs,
  getLatestReadingsPerDevice,
  getAvailableMetersForEnergy,
} from '@/lib/energyQueries';
import { EnergyMetersClient } from './EnergyMetersClient';

export default async function EnergyMetersPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const currentMonthStr = format(new Date(), 'yyyy-MM');
  const targetMonth = month && month.includes('-') ? month : currentMonthStr;

  const [y, m] = targetMonth.split('-');
  const monthDate = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  const priorCutoff = format(subDays(monthDate, 1), 'yyyy-MM-dd');

  const [meters, devices, logs, priorReadings, availableMeters] = await Promise.all([
    getEnergyMeters(),
    getEnergyMeterDevices(),
    getEnergyReadingLogs({ month: targetMonth }),
    getLatestReadingsPerDevice(priorCutoff),
    getAvailableMetersForEnergy(),
  ]);

  return (
    <EnergyMetersClient
      meters={meters}
      devices={devices}
      logs={logs}
      priorReadings={priorReadings}
      availableMeters={availableMeters}
      selectedMonth={targetMonth}
    />
  );
}
